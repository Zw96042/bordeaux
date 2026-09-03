import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FixedGeometryCorpus } from "../src/electron/benchmark/fixedGeometry";
import { getPlanner } from "../src/shared/planners";
import { optimizeFixedGeometryFinal } from "../src/shared/planners/fixedGeometryFinal";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import { createDemoProject } from "../src/shared/project/defaults";

const corpusDirectory = join(dirname(fileURLToPath(import.meta.url)), "../benchmarks/planner-corpus/v1");
const corpus = FixedGeometryCorpus.loadV1(corpusDirectory);
const project = decodeProjectFile(readFileSync(join(corpusDirectory, "corpus.bordeaux.json"), "utf8")).project;

describe("fixed-geometry final optimization", () => {
  it("returns a valid improvement or honest equivalent for every frozen swerve case", () => {
    for (const fixture of corpus.cases) {
      const path = project.paths.find((candidate) => candidate.id === fixture.pathId)!;
      const input = { path, robot: project.robot, samplesPerSegment: 56 };
      const interactive = getPlanner("profiledSpline").generate(input);
      const final = optimizeFixedGeometryFinal(input);
      const validation = corpus.validate(fixture.id, final);

      expect(validation.valid, `${fixture.id}: ${validation.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
      expect(final.totalTimeS).toBeLessThanOrEqual(interactive.totalTimeS + 0.0001);
      expect(final.optimization).toMatchObject({
        status: expect.stringMatching(/^(optimal|feasible|equivalent)$/),
        constraintViolations: 0,
      });
      expect(final.samples[0].x).toBeCloseTo(interactive.samples[0].x, 5);
      expect(final.samples[0].y).toBeCloseTo(interactive.samples[0].y, 5);
      expect(final.samples[0].headingRad).toBeCloseTo(interactive.samples[0].headingRad, 5);
      expect(final.samples[0].velocityMps).toBeCloseTo(interactive.samples[0].velocityMps, 5);
      expect(final.samples.at(-1)!.x).toBeCloseTo(interactive.samples.at(-1)!.x, 5);
      expect(final.samples.at(-1)!.y).toBeCloseTo(interactive.samples.at(-1)!.y, 5);
      expect(final.samples.at(-1)!.headingRad).toBeCloseTo(interactive.samples.at(-1)!.headingRad, 5);
      expect(final.samples.at(-1)!.velocityMps).toBeCloseTo(interactive.samples.at(-1)!.velocityMps, 5);
    }
  });

  it("keeps the interactive result and records why an invalid optimization was rejected", () => {
    const demo = createDemoProject();
    demo.paths[0].constraints.maxJerk = 4;
    const input = { path: demo.paths[0], robot: demo.robot };
    const interactive = getPlanner("profiledSpline").generate(input);

    const final = optimizeFixedGeometryFinal(input);

    expect(final.samples).toEqual(interactive.samples);
    expect(final.optimization).toMatchObject({
      plannerUsed: "profiledSpline",
      status: "internal-error",
      fallback: true,
      fallbackReason: expect.stringContaining("translational jerk"),
    });
      maxAngAccel: 120,
      maxAngDecel: 120,
    };
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 8, y: 2, theta: 180, thetaOn: true },
    ]);
    path.ranges = [{
      anchor: "param",
      f0: 0.05,
      f1: 0.95,
      maxVel: 4,
      maxAccel: 5,
      maxDecel: 5,
      maxAngVel: 60,
      maxAngAccel: 120,
      rotationPriority: "translation",
    }];

    const result = getPlanner("optimizedTrajectory").generate({ path, robot: demo.robot, samplesPerSegment: 56 });
    expect(result.optimization).toMatchObject({
      status: expect.stringMatching(/^(optimal|feasible|equivalent)$/),
      constraintViolations: 0,
      fallback: false,
    });
    expect(result.samples[0].velocityMps).toBe(1);
    expect(result.samples.at(-1)!.velocityMps).toBe(1);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ severity: "error" }));
  });
});
