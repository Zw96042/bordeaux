import { describe, expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { PM } from "../src/shared/math/pm";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { TrajectoryPlannerId } from "../src/shared/types";
import { validateProject } from "../src/shared/validation";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import { buildLabviewBdx } from "../src/shared/export/labviewBdx";
import { parseLabviewBdx } from "../src/shared/export/labviewBdxReader";
import { applyRotationPriority } from "../src/shared/planners/rotationPriority";
import {
  headingTransitionGoals,
  headingTransitionWindows,
  smoothHeadingTransitions,
} from "../src/shared/planners/headingTransitions";
import type { PlannerResult } from "../src/shared/types";

const PLANNERS: TrajectoryPlannerId[] = ["profiledSpline", "optimizedTrajectory", "labviewBezier", "labviewClothoid"];

function interiorTurnProject() {
  const project = createDemoProject();
  const path = project.paths[0];
  path.headingMode = "tangent";
  path.waypoints = buildWaypoints([
    { x: 2, y: 2, theta: 0, thetaOn: true, segType: "line" },
    {
      x: 4,
      y: 2,
      theta: 90,
      thetaOn: true,
      stop: true,
      wait: 0.12,
      segType: "line",
      segmentHeadingMode: "manual",
      turnInPlace: { headingDeg: 90, direction: "counterclockwise" },
    },
    { x: 6, y: 2, theta: 90, thetaOn: true },
  ]);
  return project;
}

describe("motion features", () => {
  it("acquires the first real target monotonically when Targets becomes active", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({ s: index * 0.25 }));
    const waypoints = buildWaypoints([
      { x: 6, y: 5, theta: 0, segmentHeadingMode: "tangent" },
      {
        x: 3, y: 5, theta: 0, segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.75 },
      },
      { x: 0, y: 5, theta: 0 },
    ]);
    const raw = points.map((point) => {
      if (point.s <= 3) return Math.PI;
      if (point.s <= 4.5) return (-45 * (point.s / 4.5)) * Math.PI / 180;
      return (-45 + 45 * ((point.s - 4.5) / 1.5)) * Math.PI / 180;
    });
    const goals = headingTransitionGoals(
      ["tangent", "targets"],
      [false, false],
      [0, 12, 24],
      points,
      {
        manual: [{ f: 0, heading: 0 }, { f: 1, heading: 0 }],
        targets: [{ f: 0, heading: 0 }, { f: 0.75, heading: -Math.PI / 4 }, { f: 1, heading: 0 }],
      },
    );
    for (const placement of ["before", "split", "after"] as const) {
      waypoints[1].headingTransition!.placement = placement;
      const headings = smoothHeadingTransitions(raw, ["tangent", "targets"], [false, false], [0, 12, 24], points, waypoints, goals);
      const throughTarget = headings.slice(9, 19);
      for (let index = 1; index < throughTarget.length; index += 1) {
        expect(throughTarget[index]).toBeGreaterThanOrEqual(throughTarget[index - 1] - 1e-10);
      }
      expect(throughTarget.at(-1)).toBeCloseTo(7 * Math.PI / 4, 8);
    }
  });

  it("honors a target on the mode boundary and protects it from a later blend", () => {
    const points = Array.from({ length: 37 }, (_, index) => ({ s: index * 0.25 }));
    const waypoints = buildWaypoints([
      { x: 9, y: 5, theta: 0, segmentHeadingMode: "tangent" },
      {
        x: 6, y: 5, theta: 0, segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.75 },
      },
      {
        x: 3, y: 5, theta: -45, thetaOn: true, segmentHeadingMode: "tangent",
        headingTransition: { placement: "before", rotationPriority: "heading", distanceM: 0.75 },
      },
      { x: 0, y: 5, theta: 0 },
    ]);
    const raw = points.map((point) => {
      if (point.s <= 3 || point.s >= 6) return Math.PI;
      return (-45 * ((point.s - 3) / 3)) * Math.PI / 180;
    });
    const goals = headingTransitionGoals(
      ["tangent", "targets", "tangent"],
      [false, false, false],
      [0, 12, 24, 36],
      points,
      {
        manual: [{ f: 0, heading: 0 }, { f: 1, heading: 0 }],
        targets: [{ f: 0, heading: 0 }, { f: 2 / 3, heading: -Math.PI / 4 }, { f: 1, heading: 0 }],
      },
    );

    expect(goals[0].distanceM).toBeCloseTo(6, 8);
    const headings = smoothHeadingTransitions(raw, ["tangent", "targets", "tangent"], [false, false, false], [0, 12, 24, 36], points, waypoints, goals);
    expect(headings[24]).toBeCloseTo(7 * Math.PI / 4, 8);

    const boundaryGoals = headingTransitionGoals(
      ["tangent", "targets"],
      [false, false],
      [0, 12, 24],
      points.slice(0, 25),
      {
        manual: [{ f: 0, heading: 0 }, { f: 1, heading: 0 }],
        targets: [{ f: 0.5, heading: -Math.PI / 4 }, { f: 1, heading: 0 }],
      },
    );
    expect(boundaryGoals[0].distanceM).toBeCloseTo(3, 8);
    const boundaryPoints = points.slice(0, 25);
    const boundaryRaw = boundaryPoints.map((point) => (
      point.s <= 3 ? Math.PI : (-45 + 45 * ((point.s - 3) / 3)) * Math.PI / 180
    ));
    const boundaryWaypoints = buildWaypoints([
      { x: 6, y: 5, theta: 0, segmentHeadingMode: "tangent" },
      {
        x: 3, y: 5, theta: -45, thetaOn: true, segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.75 },
      },
      { x: 0, y: 5, theta: 0 },
    ]);
    for (const placement of ["before", "split", "after"] as const) {
      boundaryWaypoints[1].headingTransition!.placement = placement;
      const boundaryHeadings = smoothHeadingTransitions(
        boundaryRaw,
        ["tangent", "targets"],
        [false, false],
        [0, 12, 24],
        boundaryPoints,
        boundaryWaypoints,
        boundaryGoals,
      );
      expect(boundaryHeadings.slice(12, 16).some((heading) => Math.abs(heading - 7 * Math.PI / 4) < 1e-8)).toBe(true);
    }
  });

  it.each(PLANNERS)("does not reverse before a target after a tangent-to-Targets switch with %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.constraints.maxAngVel = 720;
    path.constraints.maxAngAccel = 1440;
    path.constraints.maxAngDecel = 1440;
    path.waypoints = buildWaypoints([
      { x: 9, y: 5, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      {
        x: 6, y: 5, theta: 0, thetaOn: false, segType: "line", segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.05 },
      },
      { x: 3, y: 5, theta: 0, thetaOn: true, segType: "line" },
    ]);
    path.targets = [{ f: 0.75, deg: -45 }];

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const throughTarget = result.samples.filter((sample) => sample.f >= 0.49 && sample.f <= 0.75 + 1e-6);
    const unwrapped = [throughTarget[0].headingRad];
    for (let index = 1; index < throughTarget.length; index += 1) {
      let heading = throughTarget[index].headingRad;
      while (heading - unwrapped[index - 1] > Math.PI) heading -= 2 * Math.PI;
      while (heading - unwrapped[index - 1] < -Math.PI) heading += 2 * Math.PI;
      unwrapped.push(heading);
    }
    for (let index = 1; index < unwrapped.length; index += 1) {
      expect(unwrapped[index]).toBeGreaterThanOrEqual(unwrapped[index - 1] - 0.02 * Math.PI / 180);
    }
    expect(Math.max(...unwrapped)).toBeLessThanOrEqual(7 * Math.PI / 4 + 0.25 * Math.PI / 180);
  });

  it("places a heading-law blend before, across, or after its boundary", () => {
    const raw = [0, 0, 0, Math.PI / 2, Math.PI / 2, Math.PI / 2, Math.PI / 2];
    const points = raw.map((_, index) => ({ s: index }));
    const base = buildWaypoints([
      { x: 0, y: 0, theta: 0, segmentHeadingMode: "manual" },
      { x: 3, y: 0, theta: 90, segmentHeadingMode: "tangent" },
      { x: 6, y: 0, theta: 90 },
    ]);
    const headingsFor = (placement: "before" | "split" | "after") => {
      base[1].headingTransition = { placement, rotationPriority: "heading", distanceM: 2 };
      return smoothHeadingTransitions(raw, ["manual", "tangent"], [false, false], [0, 3, 6], points, base);
    };

    expect(headingsFor("before")[3]).toBeCloseTo(Math.PI / 2, 8);
    expect(headingsFor("split")[3]).toBeCloseTo(Math.PI / 4, 8);
    expect(headingsFor("after")[3]).toBeCloseTo(0, 8);

    base[1].headingTransition = { placement: "split", rotationPriority: "translation", distanceM: 2 };
    const [window] = headingTransitionWindows(base, ["manual", "tangent"], [false, false], [0, 0.5, 1], 6);
    expect(window).toMatchObject({ waypointIndex: 1, placement: "split", rotationPriority: "translation", distanceM: 2 });
    expect(window.start).toBeCloseTo(1 / 3, 10);
    expect(window.end).toBeCloseTo(2 / 3, 10);
  });

  it.each(PLANNERS)("lets a heading transition preserve translational timing with %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.constraints.maxVel = 4;
    path.constraints.maxAccel = 5;
    path.constraints.maxDecel = 5;
    path.constraints.maxAngVel = 90;
    path.constraints.maxAngAccel = 180;
    path.constraints.maxAngDecel = 180;
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: -90, thetaOn: true, segType: "line", segmentHeadingMode: "manual" },
      { x: 4, y: 2, theta: -90, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      { x: 9, y: 2, theta: 0, thetaOn: true },
    ]);
    path.waypoints[1].headingTransition = { placement: "after", rotationPriority: "heading", distanceM: 0.05 };
    const headingResult = getPlanner(plannerId).generate({ path: structuredClone(path), robot: project.robot });
    path.waypoints[1].headingTransition.rotationPriority = "translation";
    const translationResult = getPlanner(plannerId).generate({ path, robot: project.robot });

    expect(translationResult.totalTimeS).toBeLessThan(headingResult.totalTimeS);
    const settled = translationResult.samples.filter((sample) => sample.x >= 4);
    expect(Math.max(...settled.map((sample) => sample.headingRad))).toBeLessThanOrEqual(1 * Math.PI / 180);
    expect(Math.abs(translationResult.samples.at(-1)!.headingRad)).toBeLessThan(0.1 * Math.PI / 180);
  });

  it("validates and round-trips authored heading-transition controls", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([
      { x: 2, y: 2, theta: 0, segmentHeadingMode: "manual" },
      { x: 4, y: 2, theta: 0, segmentHeadingMode: "tangent" },
      { x: 6, y: 2, theta: 0 },
    ]);
    const transition = project.paths[0].waypoints[1];
    transition.headingTransition = { placement: "split", rotationPriority: "translation", distanceM: 1.1 };

    expect(validateProject(project).ok).toBe(true);
    expect(decodeProjectFile(JSON.stringify(project)).project.paths[0].waypoints[1].headingTransition).toEqual(transition.headingTransition);

    transition.headingTransition.distanceM = 4;
    expect(validateProject(project).ok).toBe(true);
    transition.headingTransition.distanceM = 0.04;
    expect(validateProject(project).issues.some((issue) => issue.path.endsWith("headingTransition.distanceM"))).toBe(true);
    transition.headingTransition = { placement: "after", rotationPriority: "translation", distanceM: 0.75 };
    project.robot.drive = "tank";
    expect(validateProject(project).issues.some((issue) => issue.path.endsWith("headingTransition.rotationPriority") && issue.message.includes("swerve"))).toBe(true);
  });

  it("catches up to a settled heading without overshooting and oscillating", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.constraints.maxAngVel = 180;
    path.constraints.maxAngAccel = 360;
    path.constraints.maxAngDecel = 360;
    path.ranges = [{
      anchor: "param", f0: 0, f1: 1,
      maxVel: path.constraints.maxVel,
      maxAccel: path.constraints.maxAccel,
      maxDecel: path.constraints.maxDecel,
      maxAngVel: path.constraints.maxAngVel,
      maxAngAccel: path.constraints.maxAngAccel,
      rotationPriority: "translation",
    }];
    const dt = 0.02;
    const sampleCount = 151;
    const samples = Array.from({ length: sampleCount }, (_, index) => {
      const t = index * dt;
      const progress = Math.min(1, t / 0.2);
      const headingRad = (-90 + progress * 90) * Math.PI / 180;
      return {
        i: index,
        t,
        s: t,
        f: index / (sampleCount - 1),
        x: t,
        y: 0,
        headingRad,
        velocityMps: 1,
        accelerationMps2: 0,
        angularVelocityRadps: t > 0 && t <= 0.2 ? 450 * Math.PI / 180 : 0,
        curvatureInvM: 0,
      };
    });
    const raw: PlannerResult = {
      planner: "profiledSpline",
      samples,
      markers: [],
      diagnostics: [],
      totalDistanceM: samples.at(-1)!.x,
      totalTimeS: samples.at(-1)!.t,
    };

    const tracked = applyRotationPriority(path, raw, project.robot);
    const settled = tracked.samples.filter((sample) => sample.t >= 0.2);
    const maxHeading = Math.max(...settled.map((sample) => sample.headingRad));
    const angularAcceleration = tracked.samples.slice(1).map((sample, index) =>
      (sample.angularVelocityRadps - tracked.samples[index].angularVelocityRadps) / dt);

    expect(maxHeading).toBeLessThanOrEqual(0.5 * Math.PI / 180);
    expect(Math.abs(tracked.samples.at(-1)!.headingRad)).toBeLessThan(0.1 * Math.PI / 180);
    expect(Math.max(...angularAcceleration.map(Math.abs)))
      .toBeLessThanOrEqual(path.constraints.maxAngAccel * Math.PI / 180 * 1.01);
  });

  it("uses the acceleration limit after reversing angular direction", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.constraints.maxAngVel = 240;
    path.constraints.maxAngAccel = 120;
    path.constraints.maxAngDecel = 720;
    path.ranges = [{
      anchor: "param", f0: 0, f1: 1,
      maxVel: path.constraints.maxVel, maxAccel: path.constraints.maxAccel, maxDecel: path.constraints.maxDecel,
      maxAngVel: path.constraints.maxAngVel, maxAngAccel: path.constraints.maxAngAccel,
      rotationPriority: "translation",
    }];
    const dt = 0.02;
    const samples = Array.from({ length: 201 }, (_, index) => {
      const t = index * dt;
      const headingDeg = t < 0.2 ? 450 * t : t < 0.6 ? 90 : t < 0.8 ? 90 - 900 * (t - 0.6) : -90;
      return {
        i: index, t, s: t, f: index / 200, x: t, y: 0,
        headingRad: headingDeg * Math.PI / 180,
        velocityMps: index === 200 ? 0 : 1,
        accelerationMps2: 0, angularVelocityRadps: 0, curvatureInvM: 0,
      };
    });
    const tracked = applyRotationPriority(path, {
      planner: "profiledSpline", samples, markers: [], diagnostics: [], totalDistanceM: 4, totalTimeS: 4,
    }, project.robot);

    tracked.samples.slice(1).forEach((sample, index) => {
      const previous = tracked.samples[index];
      const acceleration = Math.abs(sample.angularVelocityRadps - previous.angularVelocityRadps) / (sample.t - previous.t);
      const reversing = Math.sign(sample.angularVelocityRadps) !== 0
        && Math.sign(previous.angularVelocityRadps) !== 0
        && Math.sign(sample.angularVelocityRadps) !== Math.sign(previous.angularVelocityRadps);
      const limitDeg = reversing
        ? Math.min(path.constraints.maxAngAccel, path.constraints.maxAngDecel!)
        : Math.abs(sample.angularVelocityRadps) > Math.abs(previous.angularVelocityRadps)
          ? path.constraints.maxAngAccel
          : path.constraints.maxAngDecel!;
      expect(acceleration).toBeLessThanOrEqual(limitDeg * Math.PI / 180 * 1.01);
    });
    expect(tracked.diagnostics.some((issue) => issue.message.includes("angular limits"))).toBe(false);
  });

  it("keeps a range's angular limits through its ending interval", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.constraints.maxAngVel = 240;
    path.constraints.maxAngAccel = 720;
    path.constraints.maxAngDecel = 720;
    path.ranges = [{
      anchor: "param", f0: 0, f1: 0.5,
      maxVel: path.constraints.maxVel, maxAccel: path.constraints.maxAccel, maxDecel: path.constraints.maxDecel,
