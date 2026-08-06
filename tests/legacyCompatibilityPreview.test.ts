import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";

interface Point { x: number; y: number }
interface HeadingAnchor { f: number; rad: number }

interface LegacyWindow {
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
  };
  UI?: {
    constraintRangeSummary(range: Record<string, number>, constraints: Record<string, number>, robot: { maxSpeed: number }): { text: string; ariaLabel: string; key: string } | null;
  };
}

function legacyMath() {
  const window: LegacyWindow = {};
  const source = fs.readFileSync(new URL("../public/legacy/assets/91d3dc25-ddca-4323-acb3-c8839e67735f.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, console, Math, Number, Set, Map, Infinity, isFinite });
  return window.PM!;
}

function legacyUi() {
  const window: LegacyWindow = {};
  const noop = () => undefined;
  const React = { useState: noop, useRef: noop, useEffect: noop, useId: () => "id", createElement: noop };
  const source = fs.readFileSync(new URL("../public/legacy/assets/760c13dd-1656-409e-a1f2-58b2285a7f6e.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, React, console, Math, Number, Infinity });
  return window.UI!;
}

describe("legacy compatibility preview", () => {
  it("rotates the field artwork with overlays in Red view", () => {
    const source = fs.readFileSync(new URL("../public/legacy/assets/f7c20d72-d5b2-464c-b0cb-59923213228e.js", import.meta.url), "utf8");
    expect(source).toContain("const FIELD_CX = (X0 + X1) / 2, FIELD_CY = (Y0 + Y1) / 2");
    expect(source).toContain("transform: flip ? `rotate(180 ${FIELD_CX} ${FIELD_CY})` : undefined");
  });

  it("shows the selected candidate's validation blocker in the proposal UI", () => {
    const source = fs.readFileSync(new URL("../public/legacy/assets/34f061c0-0a98-47ac-8cc1-537fad881fe6.js", import.meta.url), "utf8");
    expect(source).toContain("agentCandidate.rejectionReason");
    expect(source).toContain("'Blocked: ' + agentCandidate.rejectionReason");
  });

  it("restores a ready proposal when its one-time renderer event is missed", () => {
    const source = fs.readFileSync(new URL("../public/legacy/assets/34f061c0-0a98-47ac-8cc1-537fad881fe6.js", import.meta.url), "utf8");
    expect(source).toContain("getActiveAgentProposal");
    expect(source).toContain("window.setInterval(restoreProposal, 1000)");
    expect(source).toContain("proposal.id + ':' + proposal.status");
  });

  it("shows the strongest locally tightened constraint instead of copied velocity", () => {
    const summary = legacyUi().constraintRangeSummary({
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
    const math = legacyMath();
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
    const math = legacyMath();
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
    const math = legacyMath();
    const heading = math.derivePath(structuredClone(path), project.robot, 56, "profiledSpline");
    path.waypoints[1].headingTransition.rotationPriority = "translation";
    const translation = math.derivePath(path, project.robot, 56, "profiledSpline");

    expect(translation.prof.totalTime).toBeLessThan(heading.prof.totalTime);
    const settledHeadings = translation.metrics.head.filter((_, index) => translation.sample.pts[index].x >= 4);
    expect(Math.max(...settledHeadings)).toBeLessThanOrEqual(Math.PI / 180);
    expect(Math.abs(translation.metrics.head.at(-1)!)).toBeLessThan(0.1 * Math.PI / 180);
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

    const result = legacyMath().derivePath(path, project.robot, 80, "profiledSpline");
    const tangentStart = result.sample.pts.findIndex((point) => point.seg === 1);
    const settledHeading = result.metrics.head.slice(Math.max(0, tangentStart));

    expect(Math.max(...settledHeading)).toBeLessThanOrEqual(0.5 * Math.PI / 180);
    expect(Math.abs(settledHeading.at(-1)!)).toBeLessThan(0.1 * Math.PI / 180);
  });

  it("splits cubic segments without changing their geometry", () => {
    const math = legacyMath();
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
    const math = legacyMath();
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

    const derived = legacyMath().derivePath(path, project.robot, 56, "profiledSpline");

    expect(derived.prof.jiggles).toHaveLength(1);
    expect(derived.prof.jiggles![0].strokeDuration).toBeGreaterThanOrEqual(0.4);
    expect(derived.totalDistance - derived.sample.length).toBeCloseTo(1.44, 8);
  });

  it("keeps exact retraces as separate ordered visits", () => {
    const math = legacyMath();
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
    const math = legacyMath();
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
    const math = legacyMath();
    const samples = [
      { x: 0, y: 0, s: 0, seg: 0, t: 0, heading: 0 },
      { x: 1, y: 0, s: 1, seg: 0, t: 0.5, heading: 0 },
      { x: 2, y: 0, s: 2, seg: 0, t: 1, heading: 0 },
    ];

    expect(math.nearestVisits(1, 0, samples, { tolerance: 0.04 })).toHaveLength(1);
  });

  it("does not count neighboring samples on the same pass as separate passes", () => {
    const math = legacyMath();
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
    const math = legacyMath();
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

    const points = legacyMath().derivePath(path, project.robot, 56, "labviewBezier").sample.pts;
    const stopIndex = points.reduce((best, point, index) => (
      Math.hypot(point.x - 4, point.y - 1) < Math.hypot(points[best].x - 4, points[best].y - 1) ? index : best
    ), 0);

    expect(points.slice(0, stopIndex + 1).every((point) => Math.abs(point.y - 1) < 1e-8)).toBe(true);
    expect(points.slice(stopIndex).every((point) => Math.abs(point.x - 4) < 1e-8)).toBe(true);
  });

  it("resolves heading mode independently for each segment", () => {
