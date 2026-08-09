import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";

interface Point { x: number; y: number }
interface HeadingAnchor { f: number; rad: number }

interface RendererWindow {
  PathLinks?: {
    sync(project: any, changedId: string, before: any): any;
  };
  PM?: {
    bez(p0: Point, c0: Point, c1: Point, p1: Point, t: number): Point;
    splitBezier(p0: Point, c0: Point, c1: Point, p1: Point, t: number): {
      point: Point;
      left: [Point, Point, Point, Point];
      right: [Point, Point, Point, Point];
    };
    nearestPointOnSegment(point: Point, samples: Array<Point & { seg: number; t: number; heading: number }>, segment: number): Point & { seg: number; t: number };
    nearestVisits(wx: number, wy: number, samples: Array<Point & { s: number; seg: number; t: number; heading: number }>, options?: { tolerance?: number; clusterDistance?: number }): Array<Point & { s: number; f: number; seg: number; t: number; distance: number }>;
    headingAt(fraction: number, anchors: HeadingAnchor[]): number;
    poseAtTime(time: number, points: Array<{ x: number; y: number; s: number; heading: number }>, profile: unknown, anchors: HeadingAnchor[], mode: string, reverse: boolean): { heading: number; speed: number };
    derivePath(path: unknown, robot: unknown, perSegment: number, plannerId: string): {
      sample: { pts: Array<{ x: number; y: number; s: number; heading: number; seg: number; t: number }>; length: number };
      prof: { totalTime: number; t: number[]; jiggles?: Array<{ strokeDuration: number }> };
      totalDistance: number;
      anchors: HeadingAnchor[];
      metrics: { v: number[]; omega: number[]; head: number[] };
      checks: Array<{ level: "error" | "warning" | "note"; text: string }>;
    };
    labviewPlannerForPath(path: unknown, fallback?: string): "labviewBezier" | "labviewClothoid";
  };
  UI?: {
    constraintRangeSummary(range: Record<string, number>, constraints: Record<string, number>, robot: { maxSpeed: number }): { text: string; ariaLabel: string; key: string } | null;
  };
}

function rendererPathLinks() {
  const window: RendererWindow = {};
  const source = fs.readFileSync(new URL("../public/renderer/assets/path-links.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, JSON });
  return window.PathLinks!;
}

function rendererMath() {
  const window: RendererWindow = {};
  const source = fs.readFileSync(new URL("../public/renderer/assets/path-math.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, console, Math, Number, Set, Map, Infinity, isFinite });
  return window.PM!;
}

function rendererUi() {
  const window: RendererWindow = {};
  const noop = () => undefined;
  const React = { useState: noop, useRef: noop, useEffect: noop, useId: () => "id", createElement: noop };
  const source = fs.readFileSync(new URL("../public/renderer/assets/ui-primitives.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, React, console, Math, Number, Infinity });
  return window.UI!;
}

describe("renderer compatibility preview", () => {
  it("synchronizes linked endpoints in either edit direction", () => {
    const project = createDemoProject();
    const second = structuredClone(project.paths[0]);
    second.id = "path_second";
    second.name = "Second";
    project.paths.push(second);
    project.pathLinks = [{ id: "pathlink_one", fromPathId: project.paths[0].id, toPathId: second.id }];

    const beforeFirst = structuredClone(project.paths[0]);
    const targetHandleOffset = second.waypoints[0].nextC.x - second.waypoints[0].x;
    const firstEnd = project.paths[0].waypoints.at(-1)!;
    firstEnd.x += 1;
    firstEnd.y += 0.5;
    let synced = rendererPathLinks().sync(project, project.paths[0].id, beforeFirst);
    expect(synced.paths[1].waypoints[0]).toMatchObject({ x: firstEnd.x, y: firstEnd.y });
    expect(synced.paths[1].waypoints[0].nextC.x - synced.paths[1].waypoints[0].x).toBeCloseTo(targetHandleOffset);

    const beforeSecond = structuredClone(synced.paths[1]);
    synced.paths[1].waypoints[0].theta = 90;
    synced.paths[1].waypoints[0].x -= 0.4;
    synced = rendererPathLinks().sync(synced, second.id, beforeSecond);
    expect(synced.paths[0].waypoints.at(-1)).toMatchObject({ x: synced.paths[1].waypoints[0].x, theta: 90 });
  });

  it("offers append and removable endpoint-link controls in the path library", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    expect(panels).toContain("'Append'");
    expect(panels).toContain("'End to'");
    expect(panels).toContain("'Not linked'");
    expect(panels).toContain("'Unlink'");
  });

  it("preserves the global method when migrating legacy LabVIEW paths", () => {
    const path = createDemoProject().paths[0];
    path.waypoints.slice(0, -1).forEach((waypoint) => { waypoint.segType = "bezier"; });
    expect(rendererMath().labviewPlannerForPath(path, "labviewClothoid")).toBe("labviewClothoid");

    path.labview = { trajectoryType: "bezier" };
    expect(rendererMath().labviewPlannerForPath(path, "labviewClothoid")).toBe("labviewBezier");
  });

  it("derives a legacy path method before applying LabVIEW defaults", () => {
    const source = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const deriveMethod = source.indexOf("const trajectoryType = labviewPlannerForPath(p, project.plannerId)");
    const applyDefaults = source.indexOf("p.labview = { ...LV_DEFAULTS, ...(p.labview || {}), trajectoryType }");

    expect(deriveMethod).toBeGreaterThan(-1);
    expect(applyDefaults).toBeGreaterThan(deriveMethod);
  });

  it("rotates the field artwork with overlays in Red view", () => {
    const source = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");
    expect(source).toContain("const FIELD_CX = (X0 + X1) / 2, FIELD_CY = (Y0 + Y1) / 2");
    expect(source).toContain("transform: flip ? `rotate(180 ${FIELD_CX} ${FIELD_CY})` : undefined");
  });

  it("shows the selected candidate's validation blocker in the proposal UI", () => {
    const source = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    expect(source).toContain("agentCandidate.rejectionReason");
    expect(source).toContain("'Blocked: ' + agentCandidate.rejectionReason");
  });

  it("restores a ready proposal when its one-time renderer event is missed", () => {
    const source = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    expect(source).toContain("getActiveAgentProposal");
    expect(source).toContain("window.setInterval(restoreProposal, 1000)");
    expect(source).toContain("proposal.id + ':' + proposal.status");
  });

  it("shows the strongest locally tightened constraint instead of copied velocity", () => {
    const summary = rendererUi().constraintRangeSummary({
      maxVel: 4.2,
      maxAccel: 6.5,
      maxDecel: 6.5,
      maxAngVel: 180,
      maxAngAccel: 720,
    }, {
      maxVel: 4.2,
      maxAccel: 6.5,
      maxDecel: 6.5,
      maxAngVel: 540,
      maxAngAccel: 720,
    }, { maxSpeed: 4.8 });

    expect(summary).toMatchObject({ key: "maxAngVel", text: "ω ≤ 180°/s" });
    expect(summary!.ariaLabel).toContain("maximum angular velocity");
  });

  it("previews translation timing priority with bounded continuous rotation", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxVel = 4;
    path.constraints.maxAccel = 5;
    path.constraints.maxDecel = 5;
    path.constraints.maxAngVel = 60;
    path.constraints.maxAngAccel = 120;
    path.constraints.maxAngDecel = 120;
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 8, y: 2, theta: 180, thetaOn: true },
    ]);
    path.ranges = [{ anchor: "param", f0: 0.05, f1: 0.95, maxVel: 4, maxAccel: 5, maxDecel: 5, maxAngVel: 60, maxAngAccel: 120 }];
    const math = rendererMath();
    const heading = math.derivePath(structuredClone(path), project.robot, 56, "profiledSpline");
    path.ranges[0].rotationPriority = "translation";
    const translation = math.derivePath(path, project.robot, 56, "profiledSpline");

    expect(translation.prof.totalTime).toBeLessThan(heading.prof.totalTime);
    expect(Math.max(...translation.metrics.v)).toBeGreaterThan(Math.max(...heading.metrics.v) + 0.2);
    expect(Math.max(...translation.metrics.omega.map(Math.abs))).toBeLessThanOrEqual(Math.PI / 3 * 1.02);
    expect(translation.checks.some((check) => check.text.includes("Rotation limits speed"))).toBe(false);
    const finalPose = math.poseAtTime(translation.prof.totalTime, translation.sample.pts, translation.prof, translation.anchors, "swerve", false);
    expect(Math.abs(finalPose.heading - Math.PI)).toBeLessThan(0.1 * Math.PI / 180);
    translation.metrics.head.slice(1).forEach((value, index) => {
      expect(value - translation.metrics.head[index]).toBeCloseTo(
        translation.metrics.omega[index + 1] * (translation.prof.t[index + 1] - translation.prof.t[index]), 4,
      );
    });
  });

  it("previews before, split, and after heading-law boundaries", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "manual" },
      { x: 4, y: 2, theta: 90, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      { x: 7, y: 5, theta: 45, thetaOn: true },
    ]);
    const math = rendererMath();
    const boundaryHeading = (placement: "before" | "split" | "after") => {
      path.waypoints[1].headingTransition = { placement, rotationPriority: "heading", distanceM: 1 };
      const result = math.derivePath(structuredClone(path), project.robot, 80, "profiledSpline");
      let boundary = 0;
      result.sample.pts.forEach((point, index) => {
        if (Math.hypot(point.x - 4, point.y - 2) < Math.hypot(result.sample.pts[boundary].x - 4, result.sample.pts[boundary].y - 2)) boundary = index;
      });
      return result.metrics.head[boundary];
    };

    expect(boundaryHeading("before")).toBeCloseTo(Math.PI / 4, 2);
    expect(boundaryHeading("split")).toBeCloseTo(Math.PI * 3 / 8, 2);
    expect(boundaryHeading("after")).toBeCloseTo(Math.PI / 2, 2);
  });

  it("can ignore, blend toward, or meet a tangent-to-Targets boundary heading", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "targets";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      { x: 4, y: 2, theta: -45, thetaOn: true, segType: "line", segmentHeadingMode: "targets" },
      { x: 7, y: 2, theta: 90, thetaOn: true },
    ]);
    const math = rendererMath();
    const boundaryHeading = (placement: "before" | "split" | "after") => {
      path.waypoints[1].headingTransition = { placement, rotationPriority: "heading", distanceM: 0.75 };
      const result = math.derivePath(structuredClone(path), project.robot, 80, "profiledSpline");
      const boundary = result.sample.pts.reduce((nearest, point, index) => (
        Math.abs(point.x - 4) < Math.abs(result.sample.pts[nearest].x - 4) ? index : nearest
      ), 0);
      return result.metrics.head[boundary];
    };

    expect(boundaryHeading("before")).toBeCloseTo(-Math.PI / 4, 2);
    expect(boundaryHeading("split")).toBeCloseTo(-Math.PI / 8, 2);
    expect(boundaryHeading("after")).toBeCloseTo(0, 2);
  });

  it("preserves translation through a minimum-distance heading transition", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxVel = 4;
    path.constraints.maxAccel = 5;
    path.constraints.maxDecel = 5;
    path.constraints.maxAngVel = 90;
    path.constraints.maxAngAccel = 180;
    path.constraints.maxAngDecel = 180;
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: -90, thetaOn: true, segType: "line", segmentHeadingMode: "manual" },
      { x: 4, y: 2, theta: -90, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      { x: 9, y: 2, theta: 0, thetaOn: true },
    ]);
    path.waypoints[1].headingTransition = { placement: "after", rotationPriority: "heading", distanceM: 0.05 };
    const math = rendererMath();
    const heading = math.derivePath(structuredClone(path), project.robot, 56, "profiledSpline");
    path.waypoints[1].headingTransition.rotationPriority = "translation";
    const translation = math.derivePath(path, project.robot, 56, "profiledSpline");

    expect(translation.prof.totalTime).toBeLessThan(heading.prof.totalTime);
    const settledHeadings = translation.metrics.head.filter((_, index) => translation.sample.pts[index].x >= 4);
    expect(Math.max(...settledHeadings)).toBeLessThanOrEqual(Math.PI / 180);
    expect(Math.abs(translation.metrics.head.at(-1)!)).toBeLessThan(0.1 * Math.PI / 180);
  });

  it("keeps transition placement from stalling the outgoing preview segment", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    Object.assign(path.constraints, {
      maxVel: 4, maxAccel: 5, maxDecel: 5,
      maxAngVel: 90, maxAngAccel: 180, maxAngDecel: 180,
    });
    path.waypoints = buildWaypoints([
      { x: 5.1, y: 7.6, theta: 0, thetaOn: true, segmentHeadingMode: "tangent" },
      { x: 9.3, y: 5.4, theta: -91, thetaOn: true, segmentHeadingMode: "targets" },
      { x: 6, y: 5.5, theta: 0, thetaOn: true },
    ]);
    const math = rendererMath();
    const durations = (["before", "split", "after"] as const).map((placement) => {
      path.waypoints[1].headingTransition = { placement, rotationPriority: "translation", distanceM: 0.75 };
      const result = math.derivePath(structuredClone(path), project.robot, 80, "profiledSpline");
      const boundary = result.sample.pts.reduce((nearest, point, index) => (
        Math.hypot(point.x - 9.3, point.y - 5.4) < Math.hypot(result.sample.pts[nearest].x - 9.3, result.sample.pts[nearest].y - 5.4)
          ? index : nearest
      ), 0);
      expect(Math.min(...result.metrics.v.slice(boundary, -1))).toBeGreaterThan(0.05);
      return result.prof.t.at(-1)! - result.prof.t[boundary];
    });

    expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(0.08);
  });

  it("previews heading catch-up without overshooting a settled tangent", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxVel = 4;
    path.constraints.maxAccel = 5;
    path.constraints.maxDecel = 5;
    path.constraints.maxAngVel = 180;
    path.constraints.maxAngAccel = 360;
    path.constraints.maxAngDecel = 360;
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: -90, thetaOn: true, segType: "line", segmentHeadingMode: "manual" },
      { x: 3, y: 2, theta: -90, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      { x: 8, y: 2, theta: 0, thetaOn: true },
    ]);
    path.ranges = [{
      anchor: "param", f0: 0.2, f1: 1,
      maxVel: 4, maxAccel: 5, maxDecel: 5, maxAngVel: 180, maxAngAccel: 360,
      rotationPriority: "translation",
    }];

    const result = rendererMath().derivePath(path, project.robot, 80, "profiledSpline");
    const tangentStart = result.sample.pts.findIndex((point) => point.seg === 1);
    const settledHeading = result.metrics.head.slice(Math.max(0, tangentStart));

    expect(Math.max(...settledHeading)).toBeLessThanOrEqual(0.5 * Math.PI / 180);
    expect(Math.abs(settledHeading.at(-1)!)).toBeLessThan(0.1 * Math.PI / 180);
  });

  it("splits cubic segments without changing their geometry", () => {
    const math = rendererMath();
    const curve: [Point, Point, Point, Point] = [
      { x: 0, y: 0 }, { x: 1, y: 3 }, { x: 4, y: -1 }, { x: 6, y: 2 },
    ];
    const splitAt = 0.37;
    const split = math.splitBezier(...curve, splitAt);

    for (let index = 0; index <= 100; index++) {
      const t = index / 100;
      const expected = math.bez(...curve, t);
      const actual = t <= splitAt
        ? math.bez(...split.left, t / splitAt)
        : math.bez(...split.right, (t - splitAt) / (1 - splitAt));
      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.y).toBeCloseTo(expected.y, 10);
    }
  });

  it("projects insertion onto the selected segment when paths pass near each other", () => {
    const math = rendererMath();
    const samples = [
      { x: 0, y: 0, seg: 0, t: 0, heading: 0 },
      { x: 2, y: 0, seg: 0, t: 1, heading: 0 },
      { x: 2, y: 0.2, seg: 1, t: 1, heading: Math.PI / 2 },
      { x: 1, y: 0.2, seg: 2, t: 0.5, heading: Math.PI },
      { x: 0, y: 0.2, seg: 2, t: 1, heading: Math.PI },
    ];

    const projected = math.nearestPointOnSegment({ x: 1, y: 0.01 }, samples, 2);

    expect(projected.seg).toBe(2);
    expect(projected.x).toBeCloseTo(1, 10);
    expect(projected.y).toBeCloseTo(0.2, 10);
    expect(projected.t).toBeCloseTo(0.5, 10);
  });

  it("derives an endpoint jiggle without crashing the renderer", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints.at(-1)!.jiggle = { distanceM: 0.18, strokes: 4, startDeg: 90, stepDeg: -90, strokeTimeS: 0.4 };

    const derived = rendererMath().derivePath(path, project.robot, 56, "profiledSpline");

    expect(derived.prof.jiggles).toHaveLength(1);
    expect(derived.prof.jiggles![0].strokeDuration).toBeGreaterThanOrEqual(0.4);
    expect(derived.totalDistance - derived.sample.length).toBeCloseTo(1.44, 8);
  });

  it("keeps exact retraces as separate ordered visits", () => {
    const math = rendererMath();
    const samples = [
      { x: 0, y: 0, s: 0, seg: 0, t: 0, heading: 0 },
      { x: 2, y: 0, s: 2, seg: 0, t: 1, heading: 0 },
      { x: 3, y: 1, s: 3.5, seg: 1, t: 1, heading: Math.PI / 4 },
      { x: 2, y: 0, s: 5, seg: 2, t: 0, heading: Math.PI },
      { x: 0, y: 0, s: 7, seg: 2, t: 1, heading: Math.PI },
    ];

    const visits = math.nearestVisits(1, 0, samples, { tolerance: 0.04 });

    expect(visits).toHaveLength(2);
    expect(visits.map((visit) => visit.seg)).toEqual([0, 2]);
    expect(visits[0].f).toBeCloseTo(1 / 7, 10);
    expect(visits[1].f).toBeCloseTo(6 / 7, 10);
  });

  it("keeps two visits inside one self-intersecting authored segment", () => {
    const math = rendererMath();
    const samples = [
      { x: 0, y: 0, s: 0, seg: 0, t: 0, heading: 0 },
      { x: 2, y: 2, s: Math.sqrt(8), seg: 0, t: 0.25, heading: Math.PI / 4 },
      { x: 0, y: 2, s: Math.sqrt(8) + 2, seg: 0, t: 0.5, heading: Math.PI },
      { x: 2, y: 0, s: Math.sqrt(8) * 2 + 2, seg: 0, t: 0.75, heading: -Math.PI / 4 },
      { x: 3, y: 1, s: Math.sqrt(8) * 2 + 2 + Math.sqrt(2), seg: 0, t: 1, heading: Math.PI / 4 },
    ];

    const visits = math.nearestVisits(1, 1, samples, { tolerance: 0.04 });

    expect(visits).toHaveLength(2);
    expect(visits.map((visit) => visit.seg)).toEqual([0, 0]);
    expect(visits[0].t).toBeCloseTo(0.125, 10);
    expect(visits[1].t).toBeCloseTo(0.625, 10);
  });

  it("clusters adjacent polyline edges into one visit", () => {
    const math = rendererMath();
    const samples = [
      { x: 0, y: 0, s: 0, seg: 0, t: 0, heading: 0 },
      { x: 1, y: 0, s: 1, seg: 0, t: 0.5, heading: 0 },
      { x: 2, y: 0, s: 2, seg: 0, t: 1, heading: 0 },
    ];

    expect(math.nearestVisits(1, 0, samples, { tolerance: 0.04 })).toHaveLength(1);
  });

  it("does not count neighboring samples on the same pass as separate passes", () => {
    const math = rendererMath();
    const samples = [
      { x: -0.3, y: 0.05, s: 0, seg: 0, t: 0, heading: 0 },
      { x: -0.1, y: 0.05, s: 0.2, seg: 0, t: 0.1, heading: 0 },
      { x: 0.1, y: 0.05, s: 0.4, seg: 0, t: 0.2, heading: 0 },
      { x: 0.3, y: 0.05, s: 0.6, seg: 0, t: 0.3, heading: 0 },
      { x: 1, y: 1, s: 1.78, seg: 0, t: 0.4, heading: Math.PI / 4 },
      { x: 1, y: -1, s: 3.78, seg: 0, t: 0.6, heading: -Math.PI / 2 },
      { x: 0.3, y: -0.05, s: 4.96, seg: 0, t: 0.7, heading: Math.PI * 0.75 },
      { x: 0.1, y: -0.05, s: 5.16, seg: 0, t: 0.8, heading: Math.PI },
      { x: -0.1, y: -0.05, s: 5.36, seg: 0, t: 0.9, heading: Math.PI },
      { x: -0.3, y: -0.05, s: 5.56, seg: 0, t: 1, heading: Math.PI },
    ];

    const visits = math.nearestVisits(0, 0, samples, { tolerance: 0.22, clusterDistance: 0.01 });

    expect(visits).toHaveLength(2);
    expect(visits[0].y).toBeCloseTo(0.05, 10);
    expect(visits[1].y).toBeCloseTo(-0.05, 10);
  });

  it("switches a handled two-waypoint path between quintic Bezier and straight clothoid geometry", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, nextC: { x: 2, y: 3 } },
      { x: 6, y: 4, prevC: { x: 5, y: 6 } },
    ]);
    const math = rendererMath();
    const bezier = math.derivePath(path, project.robot, 56, "labviewBezier");
    const clothoid = math.derivePath(path, project.robot, 56, "labviewClothoid");
    const a = path.waypoints[0], b = path.waypoints[1];
    const chordDistance = (point: { x: number; y: number }) => Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));

    expect(bezier.sample.pts.some((point) => chordDistance(point) > 0.1)).toBe(true);
    expect(clothoid.sample.pts.every((point) => chordDistance(point) < 1e-9)).toBe(true);
    expect(bezier.sample.length).not.toBeCloseTo(clothoid.sample.length, 3);
    expect(bezier.prof.totalTime).not.toBeCloseTo(clothoid.prof.totalTime, 3);
  });

  it("previews a stopped Bezier as two independent pieces without a loop", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, nextC: { x: 2, y: 1 } },
      { x: 4, y: 1, stop: true, linked: false, prevC: { x: 3, y: 1 }, nextC: { x: 4, y: 2 } },
      { x: 4, y: 5, prevC: { x: 4, y: 4 } },
    ]);

    const points = rendererMath().derivePath(path, project.robot, 56, "labviewBezier").sample.pts;
    const stopIndex = points.reduce((best, point, index) => (
      Math.hypot(point.x - 4, point.y - 1) < Math.hypot(points[best].x - 4, points[best].y - 1) ? index : best
    ), 0);

    expect(points.slice(0, stopIndex + 1).every((point) => Math.abs(point.y - 1) < 1e-8)).toBe(true);
    expect(points.slice(stopIndex).every((point) => Math.abs(point.x - 4) < 1e-8)).toBe(true);
  });

  it("resolves heading mode independently for each segment", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, theta: 0 },
      { x: 4, y: 1, theta: 0 },
      { x: 7, y: 1, theta: 0 },
    ]);
    path.waypoints[0].segmentHeadingMode = "tangent";
    path.waypoints[1].segmentHeadingMode = "targets";
    path.targets = [{ f: 0.75, deg: 180 }];

    const math = rendererMath();
    const preview = math.derivePath(path, project.robot, 56, "labviewBezier");

    expect(math.headingAt(0.25, preview.anchors)).toBeCloseTo(0, 6);
    expect(Math.abs(math.headingAt(0.75, preview.anchors))).toBeGreaterThan(Math.PI / 2);
  });

  it("acquires the next target without reversing when Targets follows Tangent", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "targets";
    path.waypoints = buildWaypoints([
      { x: 9, y: 5, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      {
        x: 6, y: 5, theta: 0, thetaOn: false, segType: "line", segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.05 },
      },
      { x: 3, y: 5, theta: 0, thetaOn: true, segType: "line" },
    ]);
    path.targets = [{ f: 0.75, deg: -45 }];

    const preview = rendererMath().derivePath(path, project.robot, 80, "profiledSpline");
    const throughTarget = preview.sample.pts
      .map((point, index) => ({ f: point.s / preview.sample.length, heading: preview.metrics.head[index] }))
      .filter((sample) => sample.f >= 0.49 && sample.f <= 0.75 + 1e-6);
    for (let index = 1; index < throughTarget.length; index += 1) {
      expect(throughTarget[index].heading).toBeGreaterThanOrEqual(throughTarget[index - 1].heading - 1e-10);
    }
    expect(Math.max(...throughTarget.map((sample) => sample.heading))).toBeLessThanOrEqual(7 * Math.PI / 4 + 1e-8);
  });

  it("blends heading laws without snapping at a segment boundary", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 2, y: 2, theta: 45, segType: "line", segmentHeadingMode: "lookAt", segmentLookAt: { x: 4, y: 4 } },
      { x: 4, y: 2, theta: 0, segType: "line", segmentHeadingMode: "tangent" },
      { x: 7, y: 2, theta: 0 },
    ]);
    const math = rendererMath();
    const preview = math.derivePath(path, project.robot, 56, "profiledSpline");
    const before = math.headingAt(0.4 - 1 / 140, preview.anchors);
    const after = math.headingAt(0.4, preview.anchors);

    expect(Math.abs(after - before)).toBeLessThan(0.12);
    expect(math.headingAt(1, preview.anchors)).toBeCloseTo(0, 2);
  });

  it("keeps a duplicate clothoid waypoint from crashing the live preview", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 4, y: 3 }]);

    const preview = rendererMath().derivePath(path, project.robot, 56, "labviewClothoid");

    expect(preview.sample.pts.length).toBeGreaterThan(2);
    expect(preview.sample.pts.at(-1)).toMatchObject({ x: 4, y: 3 });
  });

  it("assigns LabVIEW clothoid samples to every authored waypoint span", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }]);

    const preview = rendererMath().derivePath(path, project.robot, 56, "labviewClothoid");
    const counts = preview.sample.pts.reduce((result, point) => {
      result[point.seg] = (result[point.seg] || 0) + 1;
      return result;
    }, {} as Record<number, number>);

    expect(counts[0]).toBeGreaterThan(10);
    expect(counts[1]).toBeGreaterThan(10);
    expect(preview.sample.pts.filter((point) => point.seg === 0).at(-1)?.t).toBeCloseTo(1, 6);
    expect(preview.sample.pts.filter((point) => point.seg === 1).at(-1)?.t).toBeCloseTo(1, 6);
  });

  it("treats expected configured clothoid radii in either turn direction as notes, not issues", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.labview = { samplePeriodS: 0.02, minTurnRadiusM: 0.5, bezierTangentMode: "handles" };
    const math = rendererMath();

    for (const endY of [4, -2]) {
      path.waypoints = buildWaypoints([{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: endY }]);
      const preview = math.derivePath(path, project.robot, 56, "labviewClothoid");

      expect(preview.checks.filter((check) => check.level !== "note")).toEqual([]);
      expect(preview.checks.some((check) => check.level === "note" && check.text.includes("limits speed"))).toBe(true);
    }
  });

  it("keeps path checks informational until a repair can be validated", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");

    expect(panels).toContain("Path checks");
    expect(panels).not.toContain("diag-fixes");
    expect(app).not.toContain("Cap velocity on this stretch");
    expect(app).not.toContain("Insert a waypoint here");
  });

  it("keeps Select mode non-destructive and previews compatibility insertions", () => {
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");

    expect(field).not.toContain("if (d.onPath) actions.addWaypoint(d.world)");
    expect(field).not.toContain("if (role === 'seg') actions.addWaypoint");
    expect(field).toContain("actions.select('seg'");
    expect(app).toContain("Preview waypoint");
    expect(app).toContain("window.PM.splitBezier");
    expect(app).toContain("segType: originalType");
    expect(app).toContain("addWaypoint(window.PM.pointAtFraction");
  });

  it("enters explicit waypoint placement and keeps shortcuts active after scrubbing", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const inspector = fs.readFileSync(new URL("../public/renderer/assets/context-inspector.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");
    const styles = fs.readFileSync(new URL("../public/renderer/styles.css", import.meta.url), "utf8");

    expect(panels).toContain("actions.setTool('waypoint')");
    expect(inspector).toContain("actions.setTool('waypoint')");
    expect(app).not.toContain("addWaypointEnd");
    expect(app).toContain('input:not([type="range"])');
    expect(app).toContain("nativeKeyboardControl");
    expect(app).toContain("keyboardNavigation.current = false");
    expect(app).toContain("const appendWaypoint");
    expect(field).toContain("actions.appendWaypoint(d.world)");
    expect(field).toContain("insertWaypoint: e.altKey");
    expect(field.indexOf("role === 'wp' && e.shiftKey")).toBeLessThan(field.indexOf("tool === 'waypoint' && !e.altKey"));
    expect(field.indexOf("tool === 'waypoint' && !e.altKey")).toBeLessThan(field.indexOf("if (role === 'head')"));
    expect(panels).toContain("onPointerUp: (e) => e.currentTarget.blur()");
    expect(panels).toContain("'aria-valuetext': playTime.toFixed(2)");
    expect(panels).toContain("min: 0, max: total, step: scrubStep");
    expect(panels).toContain("e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')");
    expect(panels).toContain("const timeAtFraction = (fraction)");
    expect(panels).toContain("window.PM.featureFraction(marker, derived.sample)");
    expect(panels).toContain("className: 'timeline-event'");
    expect(panels).toContain("className: 'timeline-target'");
    expect(panels).toContain("className: 'timeline-range'");
    expect(panels).toContain("className: 'timeline-waypoint'");
    expect(panels).toContain("className: 'timeline-toolbar'");
    expect(panels).toContain("className: 'timeline-ruler'");
    expect(panels).toContain("className: 'timeline-lanes'");
    expect(panels).not.toContain("className: 'timeline-gutter'");
    expect(panels).toContain("const timelineTicks = [0, 0.25, 0.5, 0.75, 1]");
    expect(panels).not.toContain("className: 'timeline-progress'");
    expect(styles).toContain(".transport{position:absolute;left:0;right:0;bottom:0");
    expect(styles).toContain(".timeline{position:relative;min-width:0;margin:0;");
    expect(styles).toContain(".timeline-playhead{z-index:8;top:-20px;bottom:0;width:1px");
    expect(styles).toContain(".timeline-event{z-index:5;top:9px;bottom:4px;width:1px");
    expect(styles).toContain("transform:translate(-50%,-50%) rotate(45deg)");
    expect(app).toContain("derived, doc, metric, setMetric, playTime");
    expect(app).not.toContain("bordeaux-notice");
    expect(app).not.toContain("setNotice(");
  });

  it("keeps the grid toggle with the field view controls", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const toolbar = panels.slice(panels.indexOf("function Toolbar"), panels.indexOf("// ---------------- canvas tool rail"));
    const viewControls = panels.slice(panels.indexOf("function ViewControls"), panels.indexOf("function fmt"));

    expect(toolbar).not.toContain("icon: 'grid'");
    expect(viewControls).toContain("'aria-label': 'Toggle field grid'");
    expect(viewControls).toContain("showGrid ? ' active' : ''");
    expect(app).toContain("h(window.Panels.ViewControls, { zoomPct, zoomBy, onFit, showGrid, setShowGrid })");
  });

  it("uses a flat folder-capable path library and stable multi-path metadata", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");

    expect(panels).toContain("function PathLibrary");
    expect(panels).toContain("className: 'pathlib-panel'");
    expect(panels).toContain("Search paths and folders");
    expect(panels).toContain("'aria-modal': true");
    expect(panels).toContain("const trapFocus");
    expect(panels).toContain("className: 'pathlib-actionmenu'");
    expect(panels).toContain("className: 'pathlib-actionrow'");
    expect(panels).toContain("'Move to'");
    expect(panels).toContain("h('span', null, 'Delete')");
    expect(panels).not.toContain("className: 'pathlib-actions'");
    expect(panels).toContain("addPathFolder");
    expect(panels).toContain("movePathToFolder");
    expect(panels).toContain("h('form', { className: 'pathlib-rename'");
    expect(panels).toContain("type: 'submit'");
    expect(panels).toContain("Enter a name.");
    expect(panels).toContain("'aria-label': 'Search paths and folders'");
    expect(panels).toContain("tabIndex: -1");
    expect(panels).not.toContain("autoFocus: !('ontouchstart' in window)");
    expect(panels).toContain("'aria-describedby': error ? 'path-library-name-error' : undefined");
    expect(panels).not.toContain("h(PathSwitcher");
    expect(panels).not.toContain("onChange: (e) => renamePath(activeIdx");
    expect(app).toContain("t[doc.id]");
    expect(app).toContain("const uniquePathName");
    expect(app).toContain("const addPathFolder");
    expect(app).toContain("const movePathToFolder");
    expect(app).toContain("resetForPath(index)");
  });

  it("manages a searchable library of stable autonomous routines", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");

    expect(panels).toContain("function RoutineLibrary");
    expect(panels).toContain("'aria-label': 'Routine library'");
    expect(panels).toContain("'aria-label': 'Search routines'");
    expect(panels).toContain("duplicateRoutine(routine.id)");
    expect(panels).toContain("deleteRoutine(routine.id)");
    expect(app).toContain("const routineId = () => 'routine_'");
    expect(app).toContain("const addRoutine = () =>");
    expect(app).toContain("const duplicateRoutine = (id) =>");
    expect(app).toContain("const deleteRoutine = (id) =>");
    expect(app).toContain("routines.forEach((candidate) => window.AUTO.walk");
  });

  it("uses one Bordeaux accent and does not expose theme customization", () => {
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const styles = fs.readFileSync(new URL("../public/renderer/styles.css", import.meta.url), "utf8");

    expect(panels).not.toContain("ThemePicker");
    expect(panels).not.toContain("Choose accent color");
    expect(panels).toContain("assets/wrlp-chap-bird-original.svg");
    expect(app).not.toContain("setTheme");
    expect(app).not.toContain("dataset.theme");
    expect(app).not.toContain("ACCENTS");
    expect(styles).not.toContain("[data-theme=");
    expect(styles).not.toContain(".themebtn");
    expect(styles).toContain("--accent:#7ea2ed");
  });

  it("uses the full WRLP Chap for the app mark and startup animation", () => {
    const html = fs.readFileSync(new URL("../public/renderer/index.html", import.meta.url), "utf8");
    const styles = fs.readFileSync(new URL("../public/renderer/styles.css", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const bird = fs.readFileSync(new URL("../public/renderer/assets/wrlp-chap-bird-original.svg", import.meta.url), "utf8");
    const loader = fs.readFileSync(new URL("../public/renderer/assets/chap-loader-wrlp.js", import.meta.url), "utf8");

    expect(html).toContain('id="boot-splash"');
    expect(html).toContain('src="assets/wrlp-chap-bird-original.svg"');
    expect(html).toContain('src="assets/chap-loader-wrlp.js"');
    expect(styles).toContain("boot-chap-leg-l");
    expect(styles).toContain("boot-chap-leg-r");
    expect(styles).toContain("boot-chap-dust 920ms");
    const splashRule = styles.match(/\.boot-splash\{([^}]*)\}/)?.[1] || "";
    expect(splashRule).toContain("cursor:wait");
    expect(splashRule).not.toContain("pointer-events:none");
    expect(styles).not.toContain(".boot-splash.boot-splash-ready{pointer-events:none}");
    expect(html).toContain("class=\"boot-curtain\"");
    expect(styles).toContain(".boot-curtain{position:absolute;inset:-1px;z-index:0;background:var(--bg)");
    expect(styles).toContain("transition:transform var(--boot-curtain) cubic-bezier(.76,0,.24,1) var(--boot-run)");
    expect(styles).toContain(".boot-splash.boot-splash-ready .boot-curtain{transform:translate3d(-101%,0,0)}");
    expect(styles).toContain(".boot-splash-inner{position:absolute;z-index:1;top:50%;left:50%");
    expect(styles).toContain("@keyframes boot-chap-exit{0%{transform:translate3d(-50%,-50%,0);animation-timing-function:cubic-bezier(.3,0,.7,.45)}20%");
    expect(html).toContain('<div id="root"></div>');
    expect(bird).toContain(".st5{fill:#FF330D;stroke:#FFFFFF");
    expect(bird).toContain(".st3{fill:#422397;stroke:#FFFFFF");
    expect(styles).not.toContain("animation-play-state:paused");
    expect(styles).toContain("width:clamp(260px,26vw,370px)");
    expect(app).toContain("boot-splash-ready");
    expect(app).toContain("const strideMs = 460");
    expect(app).toContain("const strideDistancePx = Math.max(1, runnerWidth * 1.7)");
    expect(app).toContain("const runMs = strideCount * strideMs");
    expect(app).toContain("const curtainMs = 280");
    expect(app).toContain("reducedMotion ? 0 : strideMs / 2");
    expect(app).toContain("splash.style.setProperty('--boot-run', runMs + 'ms')");
    expect(app).toContain("splash.style.setProperty('--boot-curtain', curtainMs + 'ms')");
    expect(app).not.toContain("splash.setAttribute('aria-hidden', 'true')");
    expect(app).toContain("if (document.getElementById('boot-splash')) return");
    expect(app).toContain("appRoot.removeAttribute('inert')");
    expect(app).toContain("splash.remove()");
    expect(loader).toContain("Right_Leg_Upper");
    expect(loader).toContain("Left_Leg_Claw");
    expect(loader).toContain("rotate(-120");
    expect(loader).toContain("boot-chap-head");
    expect(loader).toContain("element('use'");
    expect(loader).toContain("wrlp-chap-bird-original.svg#");
    expect(loader).toContain("appRoot.inert = true");
    expect(loader).not.toContain("fetch(");
    expect(bird).toContain('id="Tail"');
    expect(bird).toContain('id="Body"');
    expect(bird).toContain('id="Head"');
  });

  it("splits stopped Bezier geometry and exposes segment-local heading modes", () => {
    const math = fs.readFileSync(new URL("../public/renderer/assets/path-math.js", import.meta.url), "utf8");
    const inspector = fs.readFileSync(new URL("../public/renderer/assets/context-inspector.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");

    expect(math).toContain("function lvBezierPiece");
    expect(math).toContain("raw[end].stop || end === raw.length - 1");
    expect(math).toContain("segmentHeadingMode");
    expect(math).toContain("pointIndex >= wpIdx[segment + 1]");
    expect(inspector).toContain("Heading on this segment");
    expect(inspector).toContain("const waypointHeadingMode");
    expect(inspector).toContain("actions.setSegmentHeadingMode(headingSegment, 'manual')");
    expect(inspector).toContain("Use path default (");
    expect(app).toContain("const setSegmentHeadingMode");
    expect(app).toContain("end.segmentHeadingMode = before.segmentHeadingMode");
    expect(app).toContain("const enableTargetsAtFraction");
    expect(app).toContain("segmentHeadingMode = 'targets'");
    expect(app).not.toContain("d.headingMode = 'targets'");
    expect(app).toContain("delete d.waypoints[last].segmentHeadingMode");
    expect(app).toContain("oldHeading[n - 2 - j]");
    expect(field).toContain("const rad = segmentMode(segment) === 'tangent'");
    expect(field).toContain("wpTangent || wpTracksPoint ? null : i");
  });

  it("mirrors authored heading-transition controls in the browser planner and inspector", () => {
    const math = fs.readFileSync(new URL("../public/renderer/assets/path-math.js", import.meta.url), "utf8");
    const inspector = fs.readFileSync(new URL("../public/renderer/assets/context-inspector.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");

    expect(math).toContain("function headingTransitionWindows");
    expect(math).toContain("opts.headingTransitions || []");
    expect(math).toContain("function headingTransitionGoals");
    expect(math).toContain("smoothHeadingTransitions(rawHead, segmentLaws, transitionBreaks, wpIdx, pts, doc.waypoints, transitionGoals)");
    expect(inspector).toContain("Heading blend");
    expect(inspector).toContain("Heading transition timing priority");
    expect(inspector).toContain("Blend distance");
    expect(inspector).toContain("Keep tangent");
    expect(inspector).toContain("Meet heading");
    expect(app).toContain("const setHeadingTransition");
    expect(app).toContain("w.thetaOn = true");
    expect(app).toContain("transition.placement === 'before' ? 'after'");
    expect(app).toContain("oldLaws[index] !== oldLaws[index - 1]");
    expect(app).toContain("{ placement: 'after', rotationPriority: 'heading', distanceM: 0.75, ...(waypoint.headingTransition || {}) }");
    expect(field).toContain("const waypointHeadingIgnored");
  });

  it("uses segmented controls for segment choices without a redundant planner chooser", () => {
    const styles = fs.readFileSync(new URL("../public/renderer/styles.css", import.meta.url), "utf8");
    const ui = fs.readFileSync(new URL("../public/renderer/assets/ui-primitives.js", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const inspector = fs.readFileSync(new URL("../public/renderer/assets/context-inspector.js", import.meta.url), "utf8");

    expect(ui).toContain("function Seg({ value, options, onChange, ariaLabel, className })");
    expect(ui).toContain("'--seg-clip-left'");
    expect(ui).toContain("className: 'seg-indicator'");
    expect(ui).not.toContain("className: 'seg-active-ink'");
    expect(styles).not.toContain(".seg-active-ink");
    expect(ui).not.toContain("function GroupSelect");
    expect(panels).not.toContain("function PlannerControl");
    expect(panels).not.toContain("optimizedTrajectory");
    expect(panels).not.toContain("ariaLabel: 'Planner family'");
    expect(panels).not.toContain("ariaLabel: 'Trajectory planner'");
    expect(inspector).toContain("ariaLabel: 'Path type'");
    expect(inspector).toContain("ariaLabel: 'Heading on this segment'");
    expect(inspector).toContain("className: 'seg-heading'");
    expect(inspector).toContain("tag = wpName(i, n) + ' \\u2192 ' + wpName(i + 1, n)");
    expect(inspector).toContain("{ v: 'param', label: 'Proportional' }");
    expect(inspector).toContain("{ v: 'wp', label: 'Local' }");
    expect(inspector).toContain("Distance (legacy)");
    expect(inspector).not.toContain("h(GroupSelect");
    expect(panels).toContain(": 'Waypoint ' + k");
  });

  it("routes overlapping field visits through a stable ordered candidate", () => {
    const math = fs.readFileSync(new URL("../public/renderer/assets/path-math.js", import.meta.url), "utf8");
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");

    expect(math).toContain("function nearestVisits");
    expect(math).toContain("different distances along the path");
    expect(field).toContain("const [visitFocus, setVisitFocus]");
    expect(field).toContain("projectVisit(world, d.lastF)");
    expect(field).toContain("const resolveWaypointVisit");
    expect(field).toContain("resolveWaypointVisit(waypoint, false, sel.idx)");
    expect(field).toContain("d.role === 'wp' && !d.moved && d.cycleWaypoint");
    expect(field).toContain("actions.addWaypoint(d.world, d.segment, !!d.onPath, d.visit)");
    expect(field).toContain("event.code === 'BracketRight'");
    expect(field).toContain("window.addEventListener('keydown', onVisitKey, true)");
    expect(field).toContain("'Pass ' + (visitFocus.index + 1) + ' of ' + visitFocus.candidates.length");
    expect(field).toContain("waypointOrder.sort");
    expect(app).toContain("Number.isFinite(visitFraction) ? visitFraction");
    expect(app).toContain("selectedVisit && Number.isFinite(selectedVisit.t)");
    expect(app).toContain("selectedVisit.seg === segment");
  });

  it("keeps the inspector modeless and independently collapsible", () => {
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const inspector = fs.readFileSync(new URL("../public/renderer/assets/context-inspector.js", import.meta.url), "utf8");
    const ui = fs.readFileSync(new URL("../public/renderer/assets/ui-primitives.js", import.meta.url), "utf8");
    const styles = fs.readFileSync(new URL("../public/renderer/styles.css", import.meta.url), "utf8");

    expect(app).toContain("const [inspectorOpen, setInspectorOpen] = useState(true)");
    expect(app).toContain("className: 'inspector-tab'");
    expect(app).toContain("name: 'sliders'");
    expect(app).toContain("setInspectorOpen(true)");
    expect(inspector).toContain("title: 'Hide inspector'");
    expect(ui).toContain("sliders:");
    expect(styles).toContain(".seg-heading .seg-i{display:flex");
    expect(styles).toContain("white-space:normal");
  });

  it("opens the hidden inspector when editable path items are double-clicked", () => {
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const outline = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");

    expect(app).toContain("openInspector: () => setInspectorOpen(true)");
    expect(outline).toContain("const inspectItem = (actions, kind, index, event)");
    expect(outline).toContain("onDoubleClick: (e) => inspectItem(actions, 'wp', i, e)");
    expect(outline).toContain("onDoubleClick: (e) => inspectItem(actions, 'seg', i, e)");
    expect(outline).toContain("onDoubleClick: (e) => inspectItem(actions, 'rt', i, e)");
    expect(outline).toContain("onDoubleClick: (e) => inspectItem(actions, 'em', i, e)");
    expect(outline).toContain("onDoubleClick: (e) => inspectItem(actions, 'cr', i, e)");
    expect(field).toContain("eventTarget.closest('[data-role]')");
    expect(field).toContain("const lastInspectPress = useRef({ key: null, at: 0 })");
    expect(field).toContain("pressKey: kind + ':' + selectedIndex");
    expect(field).toContain("const candidateInspectDouble = inspectItem && pendingInspect.key === inspectItem.pressKey");
    expect(field).toContain("!e.altKey && !candidateInspectDouble");
    expect(field).toContain("if (d.inspectItem)");
    expect(field).toContain("previous.key === d.inspectItem.pressKey && now - previous.at <= 550");
    expect(field).toContain("if (d.moved)");
    expect(field).toContain("if (!inspectTarget(e.target)) return");
  });

  it("wires stationary turns, endpoint jiggles, and draggable segment track points", () => {
    const math = fs.readFileSync(new URL("../public/renderer/assets/path-math.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const inspector = fs.readFileSync(new URL("../public/renderer/assets/context-inspector.js", import.meta.url), "utf8");
    const field = fs.readFileSync(new URL("../public/renderer/assets/field-view.js", import.meta.url), "utf8");

    expect(math).toContain("function jigglePositions");
    expect(math).toContain("prof.turns");
    expect(app).toContain("const setJiggle");
    expect(app).toContain("const setTurnInPlace");
    expect(app).toContain("const moveSegmentLookAt");
    expect(inspector).toContain("'Turn in place'");
    expect(inspector).toContain("'Endpoint jiggle'");
    expect(inspector).toContain("'Limits may extend the time.'");
    expect(inspector).toContain("const JIGGLE_DEFAULTS = { distanceM: 0.03, strokes: 8, startDeg: 45, stepDeg: -45, strokeTimeS: 0.08 }");
    expect(math).toContain("opts.jiggles");
    expect(math).toContain("feasibleJiggleStrokeDuration");
    expect(math).toContain("jiggle.strokeDuration");
    expect(inspector).toContain("{ v: 'lookAt', label: 'Look at' }");
    expect(field).toContain("'data-role': 'look'");
    expect(field).toContain("actions.moveSegmentLookAt");
    expect(field).toContain("const waypointHeadingDeg = (index)");
    expect(field).toContain("return Math.atan2(dy, dx) * 180 / Math.PI");
    expect(field).toContain("wpTangent || wpTracksPoint ? null : i");
    expect(field).toContain("clientToWorld(e.clientX, e.clientY, d.role !== 'ct')");
    expect(field).toContain("const p = d.role === 'ct' ? world : clampWorld(world)");
    expect(math).toContain("function smoothHeadingTransitions");
  });

  it("uses one searchable dropdown component instead of native selects", () => {
    const files = [
      "ui-primitives.js",
      "panels.js",
      "context-inspector.js",
      "routine-inspector.js",
      "robot-page.js",
    ].map((name) => fs.readFileSync(new URL(`../public/renderer/assets/${name}`, import.meta.url), "utf8"));
    const [ui, ...consumers] = files;

    expect(ui).toContain("function Dropdown(");
    expect(ui).toContain("ReactDOM.createPortal");
    expect(ui).toContain("const MAX_RENDERED_PICKER_ITEMS = 80");
    expect(ui).toContain("showSearch && h('div', { className: 'cmd-picker-search'");
    expect(ui).toContain("role: 'combobox'");
    expect(ui).toContain("role: 'listbox'");
    expect(ui).toContain("style: panelStyle, onKeyDown: handleKeyDown");
    expect(ui).toContain("event.key !== 'Escape' && event.key !== 'Tab'");
    expect(ui).not.toContain("InlinePicker");
    expect(consumers.join("\n")).not.toContain("h('select'");
  });

  it("autosaves an established project and presents only planner-family choices", () => {
    const app = fs.readFileSync(new URL("../public/renderer/assets/app.js", import.meta.url), "utf8");
    const panels = fs.readFileSync(new URL("../public/renderer/assets/panels.js", import.meta.url), "utf8");
    const preload = fs.readFileSync(new URL("../src/electron/preload.ts", import.meta.url), "utf8");
    const main = fs.readFileSync(new URL("../src/electron/main.ts", import.meta.url), "utf8");

    expect(app).toContain("window.bordeauxAPI.autosaveProject({ schemaVersion: '1.0'");
    expect(preload).toContain('autosaveProject: (project: BordeauxProject) => ipcRenderer.invoke("project:autosave", project)');
    expect(main).toContain('handle("project:autosave"');
    expect(main).toContain("if (!currentProjectPath) return { saved: false }");
    expect(panels).toContain("{ v: 'java', label: 'Java' }");
    expect(panels).toContain("{ v: 'labview', label: 'LabVIEW' }");
    expect(panels).not.toContain("{ v: 'optimized'");
  });
});
