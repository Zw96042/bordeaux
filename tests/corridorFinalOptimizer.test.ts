import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CorridorCorpus } from "../src/electron/benchmark/corridor";
import { observeRobotFieldPortalSequence } from "../src/shared/agent/fieldClearance";
import { REBUILT_2026_FIELD, officialToAppPoint } from "../src/shared/field/rebuilt2026";
import { robotFootprintRadius } from "../src/shared/agent/robotFootprint";
import { optimizeCorridorFinal } from "../src/shared/planners/corridorFinal";
import { optimizeFixedGeometryFinal } from "../src/shared/planners/fixedGeometryFinal";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import type { TrajectorySample } from "../src/shared/types";

const directory = join(dirname(fileURLToPath(import.meta.url)), "../benchmarks/planner-corpus/v1");
const corpus = CorridorCorpus.loadV1(directory);
const project = decodeProjectFile(readFileSync(join(directory, "corpus.bordeaux.json"), "utf8")).project;

function events(ids: readonly string[], totalTimeS: number) {
  return ids.map((id, index) => ({ id, timeS: totalTimeS * (index + 1) / (ids.length + 1) }));
}

describe("corridor final optimization", () => {
  it("returns only neutral-valid candidates without mutating the authored corpus paths", () => {
    let changedGeometry = 0;
    for (const fixture of corpus.cases) {
      const path = project.paths.find((candidate) => candidate.id === fixture.pathId)!;
      const authored = structuredClone(path);
      const input = { path, robot: project.robot, samplesPerSegment: 56 };
      const baseline = optimizeFixedGeometryFinal(input);
      const result = optimizeCorridorFinal(input, {
        corridorM: fixture.centerlineToFootprintBoundaryM - robotFootprintRadius(project.robot),
        budgetTier: "stress",
        budgetMs: 15_000,
      });
      const validation = corpus.validate(fixture.id, {
        ...result,
        events: events(fixture.eventOrder, result.totalTimeS),
      });

      expect(validation.valid, `${fixture.id}: ${validation.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
      expect(result.totalTimeS).toBeLessThanOrEqual(baseline.totalTimeS + 0.0001);
      expect(path).toEqual(authored);
      expect(observeRobotFieldPortalSequence(project.robot, result.samples).visits.map((visit) => visit.id))
        .toEqual(observeRobotFieldPortalSequence(project.robot, baseline.samples).visits.map((visit) => visit.id));
      expect(result.optimization).toMatchObject({
        optimizationClass: "corridor",
        budgetTier: "stress",
        budgetMs: 15_000,
        constraintViolations: 0,
      });
      if (result.optimizedPath) changedGeometry += 1;
    }
    expect(changedGeometry).toBeGreaterThan(0);
  });

  it("distinguishes alternate typed portals even when endpoints stay on the same sides", () => {
    const barrier = REBUILT_2026_FIELD.crossingBarriers.find((item) => item.allianceOwner === "blue")!;
    const barrierX = officialToAppPoint({ x: barrier.x, y: 0 }).x;
    const samplesThrough = (portalId: string): TrajectorySample[] => {
      const portal = barrier.portals.find((item) => item.id === portalId)!;
      const y = officialToAppPoint(portal.point).y;
      return [barrierX + 0.8, barrierX - 0.8].map((x, index) => ({
        i: index, t: index, s: index * 1.6, f: index, x, y,
        headingRad: 0, velocityMps: 1.6, accelerationMps2: 0, angularVelocityRadps: 0, curvatureInvM: 0,
      }));
    };

    expect(observeRobotFieldPortalSequence(project.robot, samplesThrough("blue-trench-table"))).toMatchObject({
      valid: true,
      visits: [{ id: "blue-trench-table" }],
    });
    expect(observeRobotFieldPortalSequence(project.robot, samplesThrough("blue-bump-table"))).toMatchObject({
      valid: true,
      visits: [{ id: "blue-bump-table" }],
    });
  });

  it("returns the untouched baseline with an explicit common-budget reason on timeout", () => {
    const fixture = corpus.cases[0];
    const path = project.paths.find((candidate) => candidate.id === fixture.pathId)!;
    const authored = structuredClone(path);
    let clockReads = 0;

    const result = optimizeCorridorFinal({ path, robot: project.robot, samplesPerSegment: 56 }, {
      corridorM: 0.2,
      budgetTier: "common",
      budgetMs: 5_000,
      now: () => clockReads++ === 0 ? 0 : 5_001,
    });

    expect(path).toEqual(authored);
    expect(result.optimizedPath).toBeUndefined();
    expect(result.optimization).toMatchObject({
      optimizationClass: "corridor",
      status: "cancelled",
      budgetTier: "common",
      budgetMs: 5_000,
      evaluations: 0,
      fallback: true,
      fallbackReason: "Corridor optimization reached the common solve budget (5000 ms).",
    });
      expect(result.optimization?.status).not.toBe("optimal");
      expect(result.optimization!.validatedCandidates! + result.optimization!.rejectedCandidates!)
        .toBe(result.optimization?.evaluations);
      previousTime = result.totalTimeS;
    }
  }, 30_000);

  it("reports bounded candidate rejection evidence separately from result quality", () => {
    const fixture = corpus.cases[1];
    const path = project.paths.find((candidate) => candidate.id === fixture.pathId)!;
    const result = optimizeCorridorFinal({ path, robot: project.robot, samplesPerSegment: 56 }, {
      maximumEvaluations: 4,
      gates: [{ bounds: { xMin: -100, xMax: -99, yMin: -100, yMax: -99 } }],
    });
    expect(result.optimization).toMatchObject({
      status: "equivalent", termination: "work-budget", fallback: false,
      validatedCandidates: 0, rejectedCandidates: 4,
    });
    expect(result.optimization?.rejectionReasons).toContainEqual({ reason: "Missed a required gate", count: 4 });
  });

  it("is deterministic at a fixed evaluation ceiling", () => {
    const fixture = corpus.cases[1];
    const path = project.paths.find((candidate) => candidate.id === fixture.pathId)!;
    const input = { path, robot: project.robot, samplesPerSegment: 56 };
    const options = {
      corridorM: fixture.centerlineToFootprintBoundaryM - robotFootprintRadius(project.robot),
      gates: fixture.gates,
      budgetTier: "stress" as const,
      budgetMs: 15_000,
      maximumEvaluations: 24,
    };

    const first = optimizeCorridorFinal(input, options);
    const second = optimizeCorridorFinal(input, options);

    expect(second.optimizedPath).toEqual(first.optimizedPath);
    expect(second.samples).toEqual(first.samples);
    expect(second.optimization?.evaluations).toBe(first.optimization?.evaluations);
  }, 30_000);
});
