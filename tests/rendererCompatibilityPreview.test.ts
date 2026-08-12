import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PM } from "../src/shared/math/pm";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { getPlanner } from "../src/shared/planners";
// @ts-expect-error The renderer worker is shipped as an untyped JavaScript module.
import { processPathPreviewJob, processRoutinePreviewJob } from "../src/renderer/assets/path-preview-worker";
import { loadRendererExport } from "./helpers/loadRendererExport";

interface Point {
  x: number;
  y: number;
  s: number;
  f?: number;
  heading?: number;
  plannedHeading?: number;
  curv?: number;
}

function rendererMath() {
  return loadRendererExport<{
    derivePath(path: unknown, robot: unknown, perSegment: number, plannerId: string): {
      sample: { pts: Array<Point & { s: number }>; length: number };
      prof: { totalTime: number };
      metrics: { v: number[]; accel: number[]; omega: number[]; curv: number[] };
      markers?: Array<{ timeS: number; fraction: number }>;
      playback?: {
        pts: Point[];
        prof: { t: number[]; v: number[]; totalTime: number };
        metrics: { accel: number[]; omega: number[]; curv: number[] };
      };
    };
    poseAtTime(time: number, points: Point[], profile: unknown, anchors: unknown, mode: string, reverse: boolean): { heading: number } | null;
  }>(new URL("../src/renderer/lib/pathMath.js", import.meta.url), "PM", { context: { console } });
}

function rendererPreview(path: unknown, robot: unknown, plannerId: string) {
  const result = processPathPreviewJob({ id: 1, quality: "final", path, robot, plannerId, perSegment: 56 });
  if (result.error) throw new Error(result.error.message);
  return result.value as ReturnType<ReturnType<typeof rendererMath>["derivePath"]>;
}

function expectPlannerPreviewParity(path: any, robot: any, plannerId: "profiledSpline" | "optimizedTrajectory", name: string) {
  const expected = getPlanner(plannerId).generate({ path, robot, samplesPerSegment: 56 });
  const actual = rendererPreview(path, robot, plannerId) as any;
  const playback = actual.playback;
  expect(actual.planner, name).toBe(expected.planner);
  expect(actual.totalDistance, name).toBe(expected.totalDistanceM);
  expect(actual.prof.totalTime, name).toBe(expected.totalTimeS);
  expect(playback?.rev, name).toBe(false);
  expect(playback?.pts, name).toEqual(expected.samples.map((sample) => ({
    x: sample.x,
    y: sample.y,
    s: sample.s,
    f: sample.f,
    heading: sample.headingRad - (path.driveBackward ? Math.PI : 0),
    plannedHeading: sample.headingRad,
    curv: sample.curvatureInvM,
  })));
  expect(playback?.prof, name).toMatchObject({
    t: expected.samples.map((sample) => sample.t),
    v: expected.samples.map((sample) => sample.velocityMps),
    totalTime: expected.totalTimeS,
  });
  expect(playback?.metrics, name).toMatchObject({
    accel: expected.samples.map((sample) => sample.accelerationMps2),
    omega: expected.samples.map((sample) => sample.angularVelocityRadps),
    curv: expected.samples.map((sample) => sample.curvatureInvM),
  });
  expect(actual.markers, name).toEqual(expected.markers);
  return expected;
}

function rendererPathLinks() {
  return loadRendererExport<{
    reconcile(project: any): any;
    sync(project: any, changedId: string, before: any): any;
  }>(new URL("../src/renderer/lib/pathLinks.js", import.meta.url), "PathLinks");
}

describe("renderer application", () => {
  it("derives finite previews with each maintained planner", () => {
    const project = createDemoProject();
    for (const planner of ["profiledSpline", "optimizedTrajectory"]) {
      const preview = rendererPreview(project.paths[0], project.robot, planner);
      expect(preview.sample.pts.length).toBeGreaterThan(2);
      expect(preview.sample.pts.every((point) => Number.isFinite(point.x + point.y + point.s))).toBe(true);
      expect(preview.sample.length).toBeGreaterThan(0);
      expect(preview.prof.totalTime).toBeGreaterThan(0);
    }
  });

  it.each([2, 56])("keeps shared and renderer clothoid endpoints exact at density %s", (samplesPerSegment) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, segType: "clothoid" },
      { x: 5, y: 5, segType: "clothoid" },
      { x: 10, y: 2, segType: "clothoid" },
      { x: 12, y: 6, segType: "line" },
    ]);
    const shared = PM.sample(path.waypoints, samplesPerSegment).pts;
    const renderer = rendererMath().derivePath(path, project.robot, samplesPerSegment, "profiledSpline").sample.pts;

    path.waypoints.forEach((waypoint, index) => {
      expect(shared[index * samplesPerSegment]).toMatchObject({ x: waypoint.x, y: waypoint.y });
      expect(renderer[index * samplesPerSegment]).toMatchObject({ x: waypoint.x, y: waypoint.y });
    });
  });

  it("uses shared optimized timing, velocities, playback, and marker times", () => {
    const project = createDemoProject();
    project.plannerId = "optimizedTrajectory";
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints = {
      ...path.constraints,
      maxVel: 4.2,
      maxAccel: 2,
      maxDecel: 2,
      maxAngVel: 180,
      maxAngAccel: 720,
      maxAngDecel: 720,
    };
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, theta: 0, thetaOn: true },
      { x: 4, y: 5, theta: 90, thetaOn: true },
      { x: 9, y: 2, theta: 180, thetaOn: true },
      { x: 15, y: 6, theta: 270, thetaOn: true },
    ]);
    path.markers = [{ id: "score", f: 0.63, name: "Score" }];
    const shared = getPlanner("optimizedTrajectory").generate({ path, robot: project.robot, samplesPerSegment: 56 });
    const preview = rendererPreview(path, project.robot, "optimizedTrajectory");
    expect(Math.abs(shared.totalTimeS - getPlanner("profiledSpline").generate({ path, robot: project.robot }).totalTimeS)).toBeGreaterThan(0.1);
    expect(preview.prof.totalTime).toBe(shared.totalTimeS);
    expect(preview.playback?.pts).toEqual(shared.samples.map((sample) => ({
      x: sample.x,
      y: sample.y,
      s: sample.s,
      f: sample.f,
      heading: sample.headingRad,
      plannedHeading: sample.headingRad,
      curv: sample.curvatureInvM,
    })));
    expect(preview.playback?.prof).toMatchObject({
      t: shared.samples.map((sample) => sample.t),
      v: shared.samples.map((sample) => sample.velocityMps),
      totalTime: shared.totalTimeS,
    });
    expect(preview.playback?.metrics).toMatchObject({
      accel: shared.samples.map((sample) => sample.accelerationMps2),
      omega: shared.samples.map((sample) => sample.angularVelocityRadps),
      curv: shared.samples.map((sample) => sample.curvatureInvM),
    });
    expect(preview.markers).toEqual(shared.markers);

    for (const [name, mutate] of [
      ["reverse", (candidate: typeof path) => { candidate.driveBackward = true; }],
      ["range", (candidate: typeof path) => { candidate.ranges = [{ anchor: "param", f0: 0.2, f1: 0.8, maxVel: 1.1, maxAccel: 0.8, maxDecel: 0.7, maxAngVel: 180, maxAngAccel: 720 }]; }],
      ["angular", (candidate: typeof path) => { candidate.constraints.maxAngVel = 30; candidate.constraints.maxAngAccel = 30; candidate.constraints.maxAngDecel = 20; }],
      ["wait", (candidate: typeof path) => { candidate.waypoints[1].stop = true; candidate.waypoints[1].wait = 1; }],
      ["turn", (candidate: typeof path) => { candidate.waypoints.at(-1)!.stop = true; candidate.waypoints.at(-1)!.turnInPlace = { headingDeg: 45, direction: "shortest" }; }],
      ["jiggle", (candidate: typeof path) => { candidate.waypoints.at(-1)!.stop = true; candidate.waypoints.at(-1)!.jiggle = { distanceM: 0.2, strokes: 2, startDeg: 0, stepDeg: 90, strokeTimeS: 0.4 }; }],
      ["translation priority", (candidate: typeof path) => { candidate.ranges = [{ anchor: "param", f0: 0.2, f1: 0.8, maxVel: 4.2, maxAccel: 2, maxDecel: 2, maxAngVel: 180, maxAngAccel: 720, rotationPriority: "translation" }]; }],
    ] as const) {
      const candidate = structuredClone(path);
      mutate(candidate);
      const expected = getPlanner("optimizedTrajectory").generate({ path: candidate, robot: project.robot, samplesPerSegment: 56 });
      const actual = rendererPreview(candidate, project.robot, "optimizedTrajectory");
      expect(actual.prof.totalTime, name).toBe(expected.totalTimeS);
      expect(actual.playback?.pts, name).toEqual(expected.samples.map((sample) => ({
        x: sample.x,
        y: sample.y,
        s: sample.s,
        f: sample.f,
        heading: sample.headingRad - (candidate.driveBackward ? Math.PI : 0),
        plannedHeading: sample.headingRad,
        curv: sample.curvatureInvM,
      })));
      expect(actual.playback?.prof.t, name).toEqual(expected.samples.map((sample) => sample.t));
      expect(actual.playback?.prof.v, name).toEqual(expected.samples.map((sample) => sample.velocityMps));
      expect(actual.playback?.metrics.accel, name).toEqual(expected.samples.map((sample) => sample.accelerationMps2));
      expect(actual.playback?.metrics.omega, name).toEqual(expected.samples.map((sample) => sample.angularVelocityRadps));
      expect(actual.playback?.metrics.curv, name).toEqual(expected.samples.map((sample) => sample.curvatureInvM));
      expect(actual.markers, name).toEqual(expected.markers);
    }
  });

  it.each(["profiledSpline", "optimizedTrajectory"] as const)("matches shared %s output with a physical drive model", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 0.6, y: 3.1, theta: -139, thetaOn: true },
      { x: 3.2667, y: 5, theta: -121, thetaOn: true },
      { x: 5.9333, y: 6.35, theta: -79, thetaOn: true },
      { x: 8.6, y: 5.25, theta: 122, thetaOn: true },
      { x: 11.2667, y: 5.24, theta: 179, thetaOn: true },
      { x: 13.9333, y: 1.72, theta: -89, thetaOn: true },
      { x: 16.6, y: 4.5, theta: 173, thetaOn: true },
    ]);
    path.waypoints[0].stop = true;
    path.waypoints.at(-1)!.stop = true;
    path.constraints = {
      ...path.constraints,
      maxVel: 2.727,
      maxAccel: 8.218,
      maxDecel: 7.549,
      maxAngVel: 531,
      maxAngAccel: 929,
      maxAngDecel: 157,
    };
    project.robot.driveModel = {
      motorId: "custom",
      motorFreeRpm: 6000,
      motorMaxTorqueNm: 3,
      motorCount: 4,
      gearRatio: 6,
      wheelDiameterM: 0.1,
      massKg: 55,
      moiKgM2: 5,
      wheelbaseM: 0.6,
      trackwidthM: 0.55,
      wheelFrictionCoefficient: 1.1,
    };

    const expected = expectPlannerPreviewParity(path, project.robot, plannerId, "physical drive model");
    if (plannerId === "optimizedTrajectory") {
      expect(expected.totalTimeS).toBe(5.5556);
      expect(expected.samples[166].velocityMps).toBe(3.8555);
    }
  });

  it.each([
    ["profiledSpline", "swerve"],
    ["profiledSpline", "tank"],
    ["optimizedTrajectory", "swerve"],
    ["optimizedTrajectory", "tank"],
  ] as const)("uses shared physical headings for reverse %s %s playback poses", (plannerId, drive) => {
    const project = createDemoProject();
    project.robot.drive = drive;
    const path = project.paths[0];
    path.driveBackward = true;
    const expected = getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 56 });
    const preview = rendererPreview(path, project.robot, plannerId) as any;
    const sample = expected.samples[Math.floor(expected.samples.length / 2)];
    const pose = rendererMath().poseAtTime(
      sample.t,
      preview.playback.pts,
      preview.playback.prof,
      preview.playback.anchors,
      preview.mode,
      preview.playback.rev,
    );
    const headingError = Math.atan2(
      Math.sin((pose?.heading ?? NaN) - sample.headingRad),
      Math.cos((pose?.heading ?? NaN) - sample.headingRad),
    );

    expect(preview.playback.rev).toBe(false);
    expect(headingError).toBeCloseTo(0, 12);
  });

  it.each(["profiledSpline", "optimizedTrajectory"] as const)("matches shared %s output with ranges, wait, and turn", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, theta: 0, thetaOn: true },
      { x: 4, y: 5, theta: 90, thetaOn: true },
      { x: 9, y: 2, theta: 180, thetaOn: true },
      { x: 15, y: 6, theta: 270, thetaOn: true },
    ]);
    path.waypoints[1].stop = true;
    path.waypoints[1].wait = 0.37;
    path.waypoints.at(-1)!.stop = true;
    path.waypoints.at(-1)!.wait = 0.23;
    path.waypoints.at(-1)!.turnInPlace = { headingDeg: 45, direction: "shortest" };
    path.ranges = [
      { anchor: "param", f0: 0.08, f1: 0.46, maxVel: 1.4, maxAccel: 1.1, maxDecel: 0.9, maxAngVel: 110, maxAngAccel: 180 },
      { anchor: "wp", f0: 0, f1: 1, w0: 1, t0: 0.25, w1: 2, t1: 0.8, maxVel: 1.8, maxAccel: 1.4, maxDecel: 1.2, maxAngVel: 140, maxAngAccel: 220 },
    ];
    path.markers = [
      { id: "before", f: 0.3, name: "Before" },
      { id: "after", anchor: "dist", d: 8, f: 0.7, name: "After" },
    ];

    expectPlannerPreviewParity(path, project.robot, plannerId, "compound range/wait/turn");
  });

  it("uses the authoritative planner adapter for optimized routine paths", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    project.routines[0].nodes = [{ id: "path_node", type: "path", ref: path.id }];

    const result = processRoutinePreviewJob({
      id: 2,
      routine: project.routines[0],
      paths: project.paths,
      robot: project.robot,
      outcomes: {},
      plannerId: "optimizedTrajectory",
    });
    if (result.error) throw new Error(result.error.message);
    const direct = rendererPreview(path, project.robot, "optimizedTrajectory") as any;
    expect(result.value.segs[0].deriv.playback).toEqual(direct.playback);
  });

  it("reports optimized planner fallback instead of publishing profiled motion", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([{ x: 1, y: 1 }]);

    const result = processPathPreviewJob({
      id: 3,
      quality: "final",
      path,
      robot: project.robot,
      plannerId: "optimizedTrajectory",
      perSegment: 56,
    });
    expect(result.value).toBeUndefined();
    expect(result.error?.message).toMatch(/enough samples|did not produce/);
  });

  it("keeps routine assembly independent from either planner engine", () => {
    const worker = fs.readFileSync(new URL("../src/renderer/assets/path-preview-worker.js", import.meta.url), "utf8");
    const routineRun = fs.readFileSync(new URL("../src/renderer/lib/routineRun.js", import.meta.url), "utf8");
    expect(worker).toContain('from "../lib/routineRun"');
    expect(worker).not.toContain("routineModel");
    expect(routineRun).not.toContain("pathMath");
    expect(routineRun).not.toContain("shared/math");
  });

  it("loads React through the typed renderer module entry without compatibility globals", () => {
    const html = fs.readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
    const main = fs.readFileSync(new URL("../src/renderer/main.tsx", import.meta.url), "utf8");
    expect(html).toContain('<script type="module" src="/main.tsx"></script>');
    expect(html).not.toContain("react.production.min.js");
    expect(main).toContain('from "react"');
    expect(main).toContain('from "react-dom/client"');
    expect(main).toContain('from "./app/App"');
    expect(main).not.toContain("window.React");
    expect(fs.existsSync(new URL("../src/renderer/legacy", import.meta.url))).toBe(false);
  });

  it("presents only maintained planners and Java export", () => {
    const panels = fs.readFileSync(new URL("../src/renderer/components/Panels.jsx", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(panels).toContain("{ v: 'profiledSpline', label: 'Profiled' }");
    expect(panels).toContain("{ v: 'optimizedTrajectory', label: 'Optimized' }");
    expect(app).toContain("exportJava");
    expect(panels).not.toMatch(/LabVIEW|labview|\.bdx/);
    expect(app).toContain("normalizeProjectData(raw)");
  });

  it("uses canonical shared project state without local compatibility mirrors", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain('normalizeProject as normalizeProjectData');
    expect(app).not.toMatch(/project\.routine(?!s)/);
    expect(app).not.toMatch(/\.\.\.project,\s*routine[,}]/);
    expect(app).toContain("const plannerId = project.plannerId");
    expect(app).not.toContain("setPlannerId");
  });

  it("persists and restores the selected path and Java project bookmark", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain("javaProjectBookmarkId: result.bookmarkId");
    expect(app).toContain("activePathId }" );
    expect(app).toContain("const requestedPathId = next.editor && next.editor.activePathId");
    expect(app).toContain("openRecentJavaProject(next.editor.javaProjectBookmarkId, javaGeneration)");
    expect(app).toContain("javaRestoreGeneration.current !== generation");
    expect(app).toContain("window.bordeauxAPI.autosaveProject");
  });

  it("keeps linked path endpoints synchronized in both directions", () => {
    const links = rendererPathLinks();
    const project = createDemoProject();
    const source = structuredClone(project.paths[0]);
    const target = structuredClone(source);
    source.id = "path_source";
    target.id = "path_target";
    target.waypoints[0].x = 8;
    target.waypoints[0].prevC.x += 3;
    target.waypoints[0].nextC.x += 3;
    const linked = { ...project, paths: [source, target], pathLinks: [{ id: "link_1", fromPathId: source.id, toPathId: target.id }] };

    const reconciled = links.reconcile(linked);
    expect(reconciled.paths[1].waypoints[0]).toMatchObject({
      x: source.waypoints.at(-1)!.x,
      y: source.waypoints.at(-1)!.y,
      theta: source.waypoints.at(-1)!.theta,
      thetaOn: source.waypoints.at(-1)!.thetaOn,
    });
    expect(reconciled.paths[1].waypoints[0].stop).toBe(target.waypoints[0].stop);

    const beforeSource = structuredClone(reconciled.paths[0]);
    const movedSource = structuredClone(beforeSource);
    movedSource.waypoints.at(-1)!.x += 1;
    const forward = links.sync({ ...reconciled, paths: [movedSource, reconciled.paths[1]] }, movedSource.id, beforeSource);
    expect(forward.paths[1].waypoints[0].x).toBe(movedSource.waypoints.at(-1)!.x);

    const beforeTarget = structuredClone(forward.paths[1]);
    const movedTarget = structuredClone(beforeTarget);
    movedTarget.waypoints[0].y += 1;
    const reverse = links.sync({ ...forward, paths: [forward.paths[0], movedTarget] }, movedTarget.id, beforeTarget);
    expect(reverse.paths[0].waypoints.at(-1)!.y).toBe(movedTarget.waypoints[0].y);
  });

  it("contains planner failures", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain("derivation.error && h('div'");
    expect(app).toContain("class AppErrorBoundary");
  });

  it("wires field gestures through the shared coalesced drag controller", () => {
    const field = fs.readFileSync(new URL("../src/renderer/components/FieldView.jsx", import.meta.url), "utf8");
    expect(field).toContain("PointerDrag.useController");
    expect(field).toContain("coalesce: true");
  });

  it("keeps animation-frame playback below the root editor render", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(app).toContain("function createPlaybackStore()");
    expect(app).toContain("useSyncExternalStore");
    expect(app).not.toContain("const [playTime, setPlayTime]");
    expect(app).not.toContain("const [routineTime, setRoutineTime]");
  });

  it("offers clustered tool aliases and preserves the established shortcuts", () => {
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../src/renderer/components/Panels.jsx", import.meta.url), "utf8");
    expect(app).toContain("'1': 'select', '2': 'waypoint', '3': 'rotation', '4': 'marker', '5': 'range'");
    expect(app).toContain("v: 'select', w: 'waypoint', r: 'rotation', m: 'marker', c: 'range'");
    expect(panels).toContain("alternateKey: 'V'");
    expect(panels).toContain("alternateKey: 'C'");
  });

  it("keeps the path fixed when flipping the field background", () => {
    const field = fs.readFileSync(new URL("../src/renderer/components/FieldView.jsx", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../src/renderer/app/App.jsx", import.meta.url), "utf8");
    expect(field).toContain("transform: flip ? `rotate(180 ${FIELD_CX} ${FIELD_CY})` : undefined");
    expect(field).toContain("const W2P = useCallback((p) => ({ x: wx(p.x), y: wy(p.y) }), []);");
    expect(field).not.toContain("FIELD_W - p.x");
    expect(field).not.toContain("FIELD_H - p.y");
    expect(field.match(/\bflip\b/g)).toHaveLength(2);
    expect(app).not.toContain("const flip = alliance === 'red' ? -1 : 1");
    expect(app).toContain("allianceView: 'blue'");
    expect(app).not.toContain("allianceView: alliance");
  });

  it("keeps dormant Chap assets out of the application shell", () => {
    const html = fs.readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../src/renderer/components/Panels.jsx", import.meta.url), "utf8");
    expect(html).not.toContain("wrlp-chap-bird-original.svg");
    expect(html).not.toContain("boot-splash");
    expect(panels).not.toContain("brand-mark");
    expect(panels).toContain("'Bordeaux'");
  });
});
