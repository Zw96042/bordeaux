import { describe, expect, it, vi } from "vitest";
import { processRoutinePreviewJob } from "../src/renderer/assets/path-preview-worker";
import { RoutinePreview } from "../src/renderer/assets/routine-preview";
import { PathPreview } from "../src/renderer/assets/path-preview";
import { AUTO } from "../src/renderer/lib/routineModel";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { getPlanner } from "../src/shared/planners";
import { validateProject } from "../src/shared/validation";
import { loadRendererExport } from "./helpers/loadRendererExport";

function routinePreview() {
  return loadRendererExport(new URL("../src/renderer/assets/routine-preview.js", import.meta.url), "RoutinePreview", {
    context: {
      AUTO: { walk(nodes, visit) { nodes.forEach(visit); } },
      PathPreview: { directPreviewWork: () => 250 },
    },
  });
}

function uniquePathFixture(pathCount = 100) {
  const project = createDemoProject();
  const waypoints = buildWaypoints(Array.from({ length: 100 }, (_, index) => ({ x: 1 + index * 0.1, y: 4 })));
  project.paths = Array.from({ length: pathCount }, (_, index) => ({
    ...structuredClone(project.paths[0]),
    id: `path_${index}`,
    name: `Path ${index}`,
    headingMode: "tangent",
    targets: [],
    ranges: [],
    waypoints: structuredClone(waypoints),
  }));
  project.editor = { ...project.editor, activePathId: project.paths[0].id };
  const routine = project.routines[0];
  routine.nodes = project.paths.map((path, index) => ({ id: `node_${index}`, type: "path", ref: path.id }));
  return { project, routine };
}

describe("routine preview worker", () => {
  it("sends only paths referenced by the active routine", () => {
    const referenced = { id: "path_a" };
    const unrelated = { id: "path_b", payload: "large" };
    const routine = { nodes: [{ id: "decision", type: "decision", then: [{ id: "node_a", type: "path", ref: referenced.id }], else: [{ id: "node_b", type: "path", ref: unrelated.id }] }] };

    expect(routinePreview().referencedPaths(routine, [unrelated, referenced], { decision: "then" })).toEqual([referenced]);
  });

  it.each(["authored-first", "generated-first"])("keeps same-ID generated previews separate from authored paths (%s)", (order) => {
    const project = createDemoProject();
    const authored = project.paths[0];
    const generated = structuredClone(authored);
    generated.name = "Generated preview";
    generated.waypoints.forEach((waypoint) => { waypoint.y += 2; waypoint.prevC.y += 2; waypoint.nextC.y += 2; });
    const pathNode = { id: "authored", type: "path", ref: authored.id };
    const generateNode = { id: "generated", type: "function", cat: "generate", funcRef: "GeneratePath", preview: generated };
    const routine = { id: "routine", name: "Collision", nodes: order === "authored-first" ? [pathNode, generateNode] : [generateNode, pathNode] };

    const paths = routinePreview().referencedPaths(routine, project.paths, {});
    const run = AUTO.buildRun(routine, paths, project.robot, {}, project.plannerId);

    expect(paths).toEqual([authored]);
    expect(run.segs.find((segment) => segment.nodeId === pathNode.id)?.doc).toBe(authored);
    expect(run.segs.find((segment) => segment.nodeId === generateNode.id)?.doc).toBe(generated);
  });

  it("counts unique path and routine assembly work before direct fallback", () => {
    const path = { id: "path_a" };
    const routine = { nodes: Array.from({ length: 100 }, (_, index) => ({ id: `node_${index}`, type: "path", ref: path.id })) };

    expect(routinePreview().directRoutineWork(routine, [path])).toBe(1 + 100 * 16 + 250);
  });

  it("rejects a huge repeated routine even when it references one cheap path", () => {
    const path = { id: "path_a" };
    const routine = { nodes: Array.from({ length: 100_000 }, (_, index) => ({ id: `node_${index}`, type: "path", ref: path.id })) };

    expect(routinePreview().directRoutineWork(routine, [path])).toBeGreaterThan(100_000);
  });

  it("rejects aggregate unique-path work before routine derivation", () => {
    const { project, routine } = uniquePathFixture();
    expect(validateProject(project).ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(project))).toBeGreaterThan(1024 * 1024);
    const admission = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot, {});
    expect(admission).toMatchObject({
      allowed: false,
      estimate: { work: 1_110_500, outputSamples: 554_500, renderedSamples: 554_500, outputSteps: 100 },
      error: { name: "RangeError" },
    });

    const buildRun = vi.fn();
    expect(processRoutinePreviewJob({ id: 19, routine, paths: project.paths }, buildRun)).toMatchObject({
      id: 19,
      error: { name: "RangeError", message: expect.stringMatching(/too large to preview safely/) },
    });
    expect(buildRun).not.toHaveBeenCalled();
  });

  it("admits ordinary repeated paths but bounds per-occurrence rendering", () => {
    const { project } = uniquePathFixture(1);
    const repeated = (count) => ({ nodes: Array.from({ length: count }, (_, index) => ({ id: `node_${index}`, type: "path", ref: project.paths[0].id })) });

    expect(RoutinePreview.workerRoutineAdmission(repeated(20), project.paths, project.robot)).toMatchObject({
      allowed: true,
      estimate: { outputSamples: 5_545, renderedSamples: 110_900, outputSteps: 20 },
      error: null,
    });
    expect(RoutinePreview.workerRoutineAdmission(repeated(22), project.paths, project.robot)).toMatchObject({
      allowed: false,
      estimate: { outputSamples: 5_545, renderedSamples: 121_990, outputSteps: 22 },
      error: { name: "RangeError" },
    });
  });

  it("bounds stationary planner samples before worker allocation", () => {
    const project = createDemoProject();
    const routine = project.routines[0];
    routine.nodes = [{ id: "path_node", type: "path", ref: project.paths[0].id }];
    project.paths[0].waypoints.at(-1).stop = true;
    project.paths[0].waypoints.at(-1).wait = 2_400;
    expect(validateProject(project).ok).toBe(true);

    expect(RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).toMatchObject({
      allowed: false,
      estimate: { outputSamples: 240_057 },
      error: { name: "RangeError" },
    });

    project.paths[0].waypoints.at(-1).wait = 30;
    const admitted = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot);
    expect(admitted.allowed).toBe(true);
    expect(PathPreview.directWorkIsSafe(admitted.estimate.work)).toBe(false);
  });

  it("admits a small translation-priority path only to the worker", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints[0].theta = 0;
    path.waypoints[1].theta = 180;
    path.ranges = [{
      anchor: "param", f0: 0, f1: 1,
      maxVel: path.constraints.maxVel, maxAccel: path.constraints.maxAccel, maxDecel: path.constraints.maxDecel,
      maxAngVel: 180, maxAngAccel: 360, rotationPriority: "translation",
    }];
    const routine = project.routines[0];
    routine.nodes = [{ id: "path_node", type: "path", ref: path.id }];
    expect(validateProject(project).ok).toBe(true);

    const admission = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot);
    const result = getPlanner("profiledSpline").generate({
      path,
      robot: project.robot,
      samplesPerSegment: 56,
    });
    expect(admission.allowed).toBe(true);
    expect(admission.estimate.outputSamples).toBe(22_457);
    expect(result.samples.length).toBeLessThanOrEqual(admission.estimate.outputSamples);
    expect(RoutinePreview.directRoutineWork(routine, project.paths)).toBe(Infinity);
    expect(PathPreview.directWorkIsSafe(RoutinePreview.directRoutineWork(routine, project.paths))).toBe(false);
  });

  it("rejects cumulative translation-priority heading work before derivation", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints(Array.from({ length: 900 }, (_, index) => ({
      x: 1 + index * 0.0001,
      y: 4,
      theta: index * 170,
      thetaOn: true,
      segType: "line",
      stop: index === 899,
    })));
    path.ranges = [{
      anchor: "param", f0: 0, f1: 1,
      maxVel: path.constraints.maxVel, maxAccel: path.constraints.maxAccel, maxDecel: path.constraints.maxDecel,
      maxAngVel: 180, maxAngAccel: 360, rotationPriority: "translation",
    }];
    const routine = project.routines[0];
    routine.nodes = [{ id: "path_node", type: "path", ref: path.id }];
    expect(validateProject(project).ok).toBe(true);

    const admission = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot);
    expect(admission).toMatchObject({
      allowed: false,
      estimate: { outputSamples: expect.any(Number) },
      error: { name: "RangeError" },
    });
    expect(admission.estimate.outputSamples).toBe(Infinity);
  });

  it("rejects malformed embedded previews without throwing during render admission", () => {
    const project = createDemoProject();
    const routine = project.routines[0];
    routine.nodes = [{ id: "generate", type: "function", cat: "generate", funcRef: "GeneratePath", preview: {} }];
    expect(validateProject(project).ok).toBe(true);

    expect(() => RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).not.toThrow();
    expect(RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).toMatchObject({
      allowed: false,
      estimate: null,
      error: { name: "RangeError", message: expect.stringMatching(/cannot be derived safely/) },
    });
  });

  it("admits bounded turns and jiggles while accounting for their samples", () => {
    const project = createDemoProject();
    const routine = project.routines[0];
    routine.nodes = [{ id: "path_node", type: "path", ref: project.paths[0].id }];
    const endpoint = project.paths[0].waypoints.at(-1);
    project.robot.maxSpeed = 0.5;
    project.paths[0].constraints = {
      ...project.paths[0].constraints,
      maxVel: 0.5,
      maxAccel: 0.5,
      maxDecel: 0.5,
      maxAngVel: 90,
      maxAngAccel: 180,
      maxAngDecel: 180,
      maxAngJerk: 360,
    };
    endpoint.stop = true;
    endpoint.turnInPlace = { headingDeg: 180, direction: "shortest" };
    endpoint.jiggle = { distanceM: 0.25, strokes: 4, startDeg: 0, stepDeg: 90, strokeTimeS: 0.08 };
    expect(validateProject(project).ok).toBe(true);

    const admission = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot);
    const result = getPlanner("profiledSpline").generate({
      path: project.paths[0],
      robot: project.robot,
      samplesPerSegment: 56,
    });
    expect(admission.allowed).toBe(true);
    expect(admission.estimate.outputSamples).toBeGreaterThan(57);
    expect(admission.estimate.outputSamples).toBeLessThan(5_000);
    expect(result.samples.length).toBeLessThanOrEqual(admission.estimate.outputSamples);
  });

  it("rejects stationary actions outside the coarse safety floors", () => {
    const build = () => {
      const project = createDemoProject();
      const routine = project.routines[0];
      routine.nodes = [{ id: "path_node", type: "path", ref: project.paths[0].id }];
      const endpoint = project.paths[0].waypoints.at(-1);
      endpoint.stop = true;
      endpoint.turnInPlace = { headingDeg: 359, direction: "clockwise" };
      return { project, routine };
    };
    const lowDeceleration = build();
    lowDeceleration.project.paths[0].constraints.maxAngDecel = 0.0008;
    const lowJerk = build();
    lowJerk.project.paths[0].constraints.maxAngJerk = 0.000005;
    const lowPhysicalLimits = build();
    lowPhysicalLimits.project.robot.driveModel = {
      motorId: "slow",
      motorFreeRpm: 1,
      motorMaxTorqueNm: 1,
      motorCount: 4,
      gearRatio: 10,
      wheelDiameterM: 0.1,
      massKg: 50,
      moiKgM2: 10,
      wheelbaseM: 0.5,
      trackwidthM: 0.5,
      wheelFrictionCoefficient: 1,
    };

    [lowDeceleration, lowJerk, lowPhysicalLimits].forEach(({ project, routine }) => {
      expect(validateProject(project).ok).toBe(true);
      expect(RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).toMatchObject({
        allowed: false,
        estimate: { outputSamples: Infinity },
        error: { name: "RangeError", message: expect.stringMatching(/too large to preview safely/) },
      });
    });
  });

  it("returns a routine run without changing worker response contracts", () => {
    const buildRun = () => ({ steps: [{ node: { id: "path" }, t0: 0, t1: 2 }], segs: [], total: 2 });

    expect(processRoutinePreviewJob({ id: 17 }, buildRun)).toMatchObject({
      id: 17,
      value: { total: 2 },
      durationMs: expect.any(Number),
    });
  });

  it("serializes worker failures", () => {
    const result = processRoutinePreviewJob({ id: 18 }, () => { throw new Error("bad routine"); });

    expect(result).toMatchObject({ id: 18, error: { name: "Error", message: "bad routine" } });
  });
});
