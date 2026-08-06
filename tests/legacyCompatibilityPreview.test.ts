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
