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
