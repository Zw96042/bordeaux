import { describe, expect, it } from "vitest";
import { generateRouteCandidates } from "../src/shared/agent/routeCandidates";
import { createDemoProject } from "../src/shared/project/defaults";

describe("agent route candidates", () => {
  it("generates a bounded set and ranks only planner-scored paths", () => {
    const project = createDemoProject();
    const candidates = generateRouteCandidates(project, {
      intent: "Cross the field efficiently",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "compare",
      maximumCandidates: 3,
      minimumClearanceM: 0.05,
    });
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.analysis.sampleCount > 0)).toBe(true);
    expect(candidates.some((candidate) => candidate.valid)).toBe(true);
    expect(candidates[0].metrics.totalTimeS).toBeGreaterThan(0);
    expect(candidates[0].path.targets).toEqual([]);
    expect(candidates.filter((candidate) => candidate.traversal.startsWith("trench-")).every((candidate) => candidate.analysis.findings.every((finding) => !finding.id.startsWith("geometry:trench-height-unverified")))).toBe(true);
    expect(candidates.find((candidate) => candidate.traversal === "direct")?.valid).toBe(true);
  });

  it("rejects raw coordinates outside the field instead of clamping them", () => {
    const project = createDemoProject();
    expect(() => generateRouteCandidates(project, {
      intent: "Do not rewrite my coordinate",
      alliance: "blue",
      start: { x: -1, y: 1 },
      goals: [{ x: 3, y: 1 }],
    })).toThrow(/never silently clamped/);
  });

  it("certifies a requested trench only when the footprint and height fit", () => {
    const project = createDemoProject();
    const candidates = generateRouteCandidates(project, {
      intent: "Go under the trench",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "trench",
      robotHeightM: 0.5,
      maximumCandidates: 2,
    });
    expect(candidates.some((candidate) => candidate.valid)).toBe(true);
    project.robot.heightM = 0.7;
    expect(() => generateRouteCandidates(project, {
      intent: "Too tall",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "trench",
      robotHeightM: 0.7,
    })).not.toThrow();
    expect(generateRouteCandidates(project, {
      intent: "Too tall",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "trench",
      robotHeightM: 0.5,
    }).every((candidate) => !candidate.valid)).toBe(true);
  });

  it("fits a long narrow rectangle through a portal using its oriented footprint", () => {
    const project = createDemoProject();
    project.robot.l = 1.2;
    project.robot.w = 0.6;
    project.robot.heightM = 0.5;
    const candidates = generateRouteCandidates(project, {
      intent: "Drive the long robot straight under the trench",
      alliance: "blue",
      start: { x: 1.5, y: 0.64, headingDeg: 0 },
      goals: [{ x: 7, y: 0.64, headingDeg: 0 }],
      traversal: "trench",
      maximumCandidates: 2,
    });
    expect(candidates.some((candidate) => candidate.valid), candidates.map((candidate) => candidate.rejectionReason).join("; ")).toBe(true);
  });

  it("requires an actual typed crossing and adds a speed range for every BUMP route", () => {
    const project = createDemoProject();
    const missing = generateRouteCandidates(project, { intent: "Use trench without crossing", alliance: "blue", start: { x: 1, y: 1 }, goals: [{ x: 3, y: 1 }], traversal: "trench", robotHeightM: 0.5 });
    expect(missing.every((candidate) => !candidate.valid && candidate.rejectionReason?.includes("does not cross"))).toBe(true);
    const direct = generateRouteCandidates(project, { intent: "Cross the bump directly", alliance: "blue", start: { x: 1.5, y: 2.59 }, goals: [{ x: 7, y: 2.59 }], traversal: "compare", maximumCandidates: 5 });
    const bumpRoutes = direct.filter((candidate) => candidate.valid && (candidate.traversal.startsWith("bump-") || candidate.traversal === "direct"));
    expect(bumpRoutes.length).toBeGreaterThan(0);
    expect(bumpRoutes.every((candidate) => candidate.path.ranges.some((range) => range.name?.startsWith("BUMP traversal") && range.maxVel <= 2))).toBe(true);
    expect(bumpRoutes.every((candidate) => candidate.path.ranges.filter((range) => range.name?.startsWith("BUMP traversal")).length === 1)).toBe(true);
    expect(bumpRoutes.every((candidate) => candidate.path.ranges.filter((range) => range.name?.startsWith("BUMP traversal")).every((range) => range.anchor === "wp"))).toBe(true);
  });

  it("uses tangent-derived mechanism heading and configured speed only on FUEL collection spans", () => {
    const project = createDemoProject();
    project.robot.planning = {
      intake: { name: "Front intake", centerM: { x: project.robot.l / 2, y: 0 }, directionDeg: 0, captureWidthM: 0.7, maxCollectSpeedMps: 2.3 },
    };
    const candidate = generateRouteCandidates(project, {
      intent: "Collect the center FUEL in a straight lane",
      alliance: "red",
      start: { x: 6, y: 2.5 },
      goals: [{ x: 11, y: 2.5 }],
      collectFuel: { maxHeadingErrorDeg: 5 },
      maximumCandidates: 1,
    })[0];
    expect(candidate.valid, candidate.rejectionReason).toBe(true);
    expect(candidate.path.driveBackward).toBe(false);
    expect(candidate.path.waypoints[0].segmentHeadingMode).toBe("tangent");
    expect(candidate.path.ranges).toEqual([expect.objectContaining({ name: "FUEL collection", anchor: "wp", w0: 0, w1: 0, maxVel: 2.3 })]);
    expect(candidate.path.ranges[0].t0).toBeGreaterThan(0);
    expect(candidate.path.ranges[0].t1).toBeLessThan(1);
    const moving = candidate.analysis.rawSamples.slice(1, -1);
    moving.forEach((sample, index) => {
      const before = candidate.analysis.rawSamples[index];
      const after = candidate.analysis.rawSamples[index + 2];
      const tangent = Math.atan2(after.y - before.y, after.x - before.x);
      expect(Math.abs(Math.atan2(Math.sin(sample.headingRad - tangent), Math.cos(sample.headingRad - tangent)))).toBeLessThan(1e-3);
    });
  });

  it("counts unique intake coverage instead of rewarding a retraced lane twice", () => {
    const project = createDemoProject();
    project.robot.planning = {
      intake: { name: "Centered intake", centerM: { x: 0, y: 0 }, directionDeg: 0, captureWidthM: 0.7, maxCollectSpeedMps: 2 },
    };
    const outbound = generateRouteCandidates(project, {
      intent: "Collect one straight lane",
      alliance: "red",
      start: { x: 6, y: 2.5 },
      goals: [{ x: 10, y: 2.5 }],
      collectFuel: {},
      maximumCandidates: 1,
    })[0];
    const retraced = generateRouteCandidates(project, {
      intent: "Collect and retrace the same lane",
      alliance: "red",
      start: { x: 6, y: 2.5 },
      goals: [{ x: 10, y: 2.5 }, { x: 6, y: 2.5 }],
      collectFuel: { allowCrosswiseHeading: true },
      maximumCandidates: 1,
    })[0];
    expect(retraced.metrics.estimatedCollectionAreaM2).toBeLessThan((outbound.metrics.estimatedCollectionAreaM2 ?? 0) * 1.5);
  });

  it("keeps a curved collection swoosh, BUMP return, and shooting approach within heading limits", () => {
    const project = createDemoProject();
    project.robot.planning = {
      intake: { name: "Front intake", centerM: { x: 0.42, y: 0 }, directionDeg: 0, captureWidthM: 0.7, maxCollectSpeedMps: 2 },
      shooter: { directionDeg: 0, requiresTargetFacing: true, preferredRangeM: 2 },
    };
    const candidate = generateRouteCandidates(project, {
      intent: "Collect through a shallow swoosh, return over the BUMP, then face the HUB",
      alliance: "red",
      start: { term: "red left trench" },
      steps: [
        { kind: "swoosh", at: { term: "far side of the initial neutral FUEL band" }, traversal: "trench-table", turn: "counterclockwise", radiusM: 0.55, collectFuel: {} },
        { kind: "travel", to: { x: 3.35, y: 2.3 }, traversal: "bump-table", collectFuel: {} },
        { kind: "travel", to: { x: 3, y: 3 } },
      ],
      finishFacing: { mechanism: "shooter", target: { term: "red HUB" } },
      minimumClearanceM: 0,
      maximumCandidates: 1,
    })[0];
    expect(candidate.valid, [candidate.rejectionReason, ...candidate.analysis.findings.map((finding) => `${finding.message} @ ${finding.sample?.segmentIndex}:${finding.sample?.fraction}`)].join("; ")).toBe(true);
    const bumpRanges = candidate.path.ranges.filter((range) => range.name?.includes("BUMP traversal"));
    expect(bumpRanges).toHaveLength(1);
    expect(candidate.path.targets.length).toBeLessThan(150);
    const collectionRanges = candidate.path.ranges.filter((range) => range.name?.includes("FUEL collection"));
    expect(candidate.metrics.totalTimeS, JSON.stringify(candidate.path.ranges)).toBeLessThan(20);
    expect(Math.min(...collectionRanges.map((range) => range.maxVel))).toBeGreaterThan(0.5);
    expect(collectionRanges).toHaveLength(1);
    expect(collectionRanges[0]).toMatchObject({ anchor: "wp", maxVel: 2 });
    expect(bumpRanges[0]).toMatchObject({ anchor: "wp", maxVel: 2 });
    const headingRanges = candidate.path.ranges.filter((range) => range.name?.startsWith("Heading transition")).sort((left, right) => left.f0 - right.f0);
    expect(headingRanges).toEqual([]);
    expect(candidate.path.waypoints.at(-1)?.turnInPlace).toBeUndefined();
    expect(candidate.path.waypoints.slice(6, -1).every((waypoint) => waypoint.segmentHeadingMode === "targets")).toBe(true);
  });
