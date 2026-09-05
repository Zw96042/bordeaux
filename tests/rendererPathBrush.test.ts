import { describe, expect, it } from "vitest";
import { loadRendererExport } from "./helpers/loadRendererExport";

interface Point { x: number; y: number }
interface Waypoint extends Point {
  prevC: Point;
  nextC: Point;
  linked: boolean;
  theta: number;
  thetaOn: boolean;
  stop: boolean;
  corner?: boolean;
  segType?: string;
  segmentFollowMode?: string;
}
interface Path {
  waypoints: Waypoint[];
  ranges: Array<{ anchor: string; w0: number; w1: number; t0?: number; t1?: number }>;
  targets?: Array<Record<string, unknown>>;
  markers?: Array<Record<string, unknown>>;
}
interface Stroke {
  kind: string;
  center: Point;
  previous: Point;
  origin?: Point;
  radius: number;
  strength: number;
}

function brush() {
  return loadRendererExport<{
    apply(path: Path, stroke: Stroke): { path: Path; added: number; removed: number; changed: boolean };
  }>(new URL("../src/renderer/lib/pathBrush.js", import.meta.url), "PathBrush");
}

function straightPath(): Path {
  return {
    waypoints: [
      { x: 1, y: 4, prevC: { x: 1, y: 4 }, nextC: { x: 4, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
      { x: 10, y: 4, prevC: { x: 7, y: 4 }, nextC: { x: 10, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false },
    ],
    ranges: [{ anchor: "wp", w0: 0, w1: 1 }],
  };
}

function curvedPath(): Path {
  return {
    waypoints: [
      { x: 2, y: 2, prevC: { x: 2, y: 2 }, nextC: { x: 3.2, y: 2.6 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
      { x: 5, y: 4, prevC: { x: 3.9, y: 3.4 }, nextC: { x: 6.1, y: 4.6 }, linked: true, theta: 0, thetaOn: false, stop: false, segType: "bezier" },
      { x: 8, y: 5, prevC: { x: 6.9, y: 4.7 }, nextC: { x: 9, y: 5.3 }, linked: true, theta: 0, thetaOn: false, stop: false, segType: "bezier" },
      { x: 11, y: 3, prevC: { x: 10, y: 3.6 }, nextC: { x: 11, y: 3 }, linked: true, theta: 0, thetaOn: true, stop: false },
    ],
    ranges: [],
  };
}

const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function sampleSegment(start: Waypoint, end: Waypoint, steps = 100): Point[] {
  const samples: Point[] = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const u = 1 - t;
    samples.push({
      x: u ** 3 * start.x + 3 * u ** 2 * t * start.nextC.x + 3 * u * t ** 2 * end.prevC.x + t ** 3 * end.x,
      y: u ** 3 * start.y + 3 * u ** 2 * t * start.nextC.y + 3 * u * t ** 2 * end.prevC.y + t ** 3 * end.y,
    });
  }
  return samples;
}

function samplePath(path: Path, steps = 80): Point[] {
  return path.waypoints.slice(0, -1).flatMap((waypoint, index) => (
    sampleSegment(waypoint, path.waypoints[index + 1], steps)
  ));
}

function distanceToSamples(value: Point, samples: Point[]): number {
  return Math.min(...samples.map((sample) => gap(value, sample)));
}

describe("path sculpting brushes", () => {
  it("keeps authored waypoint topology stable through a long brush stroke", () => {
    const path = straightPath();
    const pathBrush = brush();
    const authoredWaypoints = path.waypoints.slice();
    const authoredPositions = path.waypoints.map(({ x, y }) => ({ x, y }));
    const before = JSON.stringify(path.waypoints);

    for (let sample = 1; sample <= 80; sample++) {
      const previous = { x: 3 + (sample - 1) * 0.05, y: 4 + Math.sin((sample - 1) * 0.08) * 0.2 };
      const center = { x: 3 + sample * 0.05, y: 4 + Math.sin(sample * 0.08) * 0.2 };
      const result = pathBrush.apply(path, { kind: "push", previous, center, radius: 0.9, strength: 0.7 });
      expect(result).toMatchObject({ added: 0, removed: 0 });
      expect(path.waypoints).toHaveLength(authoredWaypoints.length);
    }

    authoredWaypoints.forEach((waypoint, index) => expect(path.waypoints[index]).toBe(waypoint));
    expect(path.waypoints.map(({ x, y }) => ({ x, y }))).toEqual(authoredPositions);
    expect(JSON.stringify(path.waypoints)).not.toBe(before);
    expect(path.waypoints.flatMap((waypoint) => [waypoint.prevC.x, waypoint.prevC.y, waypoint.nextC.x, waypoint.nextC.y]).every(Number.isFinite)).toBe(true);
  });

  it("pushes the middle of a two-anchor curve by changing only its handles", () => {
    const path = straightPath();
    const before = samplePath(path);
    const result = brush().apply(path, {
      kind: "push",
      previous: { x: 5.5, y: 4 },
      center: { x: 5.5, y: 5 },
      radius: 1.6,
      strength: 1,
    });
    const after = samplePath(path);

    expect(result).toMatchObject({ added: 0, removed: 0, changed: true });
    expect(path.waypoints).toHaveLength(2);
    expect(path.waypoints.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 1, y: 4 }, { x: 10, y: 4 }]);
    expect(Math.max(...after.map((sample, index) => gap(sample, before[index])))).toBeGreaterThan(0.05);
  });

  it("preserves ranges, features, waypoint metadata, identity, and order", () => {
    const path = curvedPath();
    path.ranges = [{ anchor: "wp", w0: 0, t0: 0.25, w1: 2, t1: 0.75 }];
    path.targets = [{ f: 0.4, deg: 90 }];
    path.markers = [{ f: 0.6, name: "score" }];
    path.waypoints[1].segmentFollowMode = "position";
    const references = path.waypoints.slice();
    const positions = path.waypoints.map(({ x, y }) => ({ x, y }));
    const ranges = structuredClone(path.ranges);
    const targets = structuredClone(path.targets);
    const markers = structuredClone(path.markers);
    const metadata = path.waypoints.map(({ x: _x, y: _y, prevC: _prevC, nextC: _nextC, ...rest }) => rest);

    brush().apply(path, { kind: "twirl", origin: { x: 5, y: 3.5 }, previous: { x: 5, y: 3.5 }, center: { x: 5.3, y: 3.8 }, radius: 1.5, strength: 0.8 });

    references.forEach((waypoint, index) => expect(path.waypoints[index]).toBe(waypoint));
    expect(path.waypoints.map(({ x, y }) => ({ x, y }))).toEqual(positions);
    expect(path.waypoints.map(({ x: _x, y: _y, prevC: _prevC, nextC: _nextC, ...rest }) => rest)).toEqual(metadata);
    expect(path.ranges).toEqual(ranges);
    expect(path.targets).toEqual(targets);
    expect(path.markers).toEqual(markers);
  });

  it("keeps a miss as an exact no-op", () => {
    const path = curvedPath();
    const before = JSON.stringify(path);
    const result = brush().apply(path, {
      kind: "push",
      previous: { x: 2, y: 7.5 },
      center: { x: 2.1, y: 7.5 },
      radius: 0.5,
      strength: 1,
    });

    expect(result).toMatchObject({ added: 0, removed: 0, changed: false });
    expect(JSON.stringify(path)).toBe(before);
  });

  it("smooths a curve without deleting its anchors", () => {
    const path = straightPath();
    path.waypoints[0].nextC = { x: 3.5, y: 6 };
    path.waypoints[1].prevC = { x: 7.5, y: 6 };
    const before = sampleSegment(path.waypoints[0], path.waypoints[1]);
    const beforePeak = Math.max(...before.map((sample) => Math.abs(sample.y - 4)));

    const result = brush().apply(path, {
      kind: "smooth",
      previous: { x: 5.3, y: 5.4 },
      center: { x: 5.5, y: 5.4 },
      radius: 2.5,
      strength: 1,
    });
    const afterPeak = Math.max(...sampleSegment(path.waypoints[0], path.waypoints[1]).map((sample) => Math.abs(sample.y - 4)));

    expect(result).toMatchObject({ added: 0, removed: 0, changed: true });
    expect(path.waypoints).toHaveLength(2);
    expect(afterPeak).toBeLessThan(beforePeak);
  });

  it("twirls a curve on a diagonal first pointer sample", () => {
    const path = straightPath();
    const before = samplePath(path);
    const origin = { x: 5.5, y: 4 };
    const result = brush().apply(path, {
      kind: "twirl",
      origin,
      previous: origin,
      center: { x: 5.8, y: 4.3 },
      radius: 2,
      strength: 0.8,
    });

    expect(result.changed).toBe(true);
    expect(Math.max(...samplePath(path).map((sample, index) => gap(sample, before[index])))).toBeGreaterThan(0.01);
    expect(path.waypoints).toHaveLength(2);
  });

  it("converts a touched line to one curved Bézier without adding anchors", () => {
    const path = straightPath();
    path.waypoints[0].segType = "line";
    const result = brush().apply(path, {
      kind: "push",
      previous: { x: 5.5, y: 4 },
      center: { x: 5.5, y: 4.8 },
      radius: 2,
      strength: 1,
    });

    expect(result).toMatchObject({ added: 0, removed: 0, changed: true });
    expect(path.waypoints).toHaveLength(2);
    expect(path.waypoints[0].segType).toBe("bezier");
    expect(Math.max(...samplePath(path).map((sample) => sample.y))).toBeGreaterThan(4.05);
  });

  it.each(["arc", "clothoid"])("leaves %s segments untouched", (segType) => {
    const path = straightPath();
    path.waypoints[0].segType = segType;
    const before = JSON.stringify(path);
    const result = brush().apply(path, { kind: "push", previous: { x: 5.5, y: 4 }, center: { x: 5.5, y: 4.8 }, radius: 2, strength: 1 });

    expect(result).toMatchObject({ added: 0, removed: 0, changed: false });
    expect(JSON.stringify(path)).toBe(before);
  });

  it("keeps linked interior handles collinear", () => {
    const path = curvedPath();
    brush().apply(path, { kind: "push", previous: { x: 5, y: 3.8 }, center: { x: 5.2, y: 4.2 }, radius: 1.4, strength: 1 });
    const waypoint = path.waypoints[1];
    const incoming = { x: waypoint.x - waypoint.prevC.x, y: waypoint.y - waypoint.prevC.y };
    const outgoing = { x: waypoint.nextC.x - waypoint.x, y: waypoint.nextC.y - waypoint.y };

    expect(Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x)).toBeLessThan(1e-8);
    expect(incoming.x * outgoing.x + incoming.y * outgoing.y).toBeGreaterThan(0);
  });

  it("changes the hit area more than the distant curve", () => {
    const path = straightPath();
    const center = { x: 5.5, y: 4.2 };
    const radius = 1.2;
    const before = samplePath(path, 120);
    brush().apply(path, { kind: "push", previous: { x: 5.5, y: 4 }, center, radius, strength: 1 });
    const after = samplePath(path, 120);
    const movements = before.map((sample, index) => ({ sample, moved: gap(sample, after[index]) }));
    const inside = Math.max(...movements.filter(({ sample }) => gap(sample, center) <= radius).map(({ moved }) => moved));
    const distant = Math.max(0, ...movements.filter(({ sample }) => gap(sample, center) >= radius * 2).map(({ moved }) => moved));

    expect(inside).toBeGreaterThan(0.005);
    expect(inside).toBeGreaterThan(distant * 0.9);
    expect(distant).toBeLessThan(0.04);
  });

  it("keeps repeated strokes finite and topology-stable", () => {
    const path = curvedPath();
    const references = path.waypoints.slice();
    for (let index = 0; index < 100; index++) {
      const previous = { x: 5 + index * 0.005, y: 4 + Math.sin(index * 0.1) * 0.1 };
      const center = { x: previous.x + 0.01, y: previous.y + 0.01 };
      brush().apply(path, { kind: index % 2 ? "push" : "twirl", origin: { x: 5, y: 4 }, previous, center, radius: 1, strength: 0.7 });
    }

    expect(path.waypoints).toHaveLength(references.length);
    references.forEach((waypoint, index) => expect(path.waypoints[index]).toBe(waypoint));
    expect(path.waypoints.flatMap((waypoint) => [waypoint.prevC.x, waypoint.prevC.y, waypoint.nextC.x, waypoint.nextC.y]).every(Number.isFinite)).toBe(true);
  });

  it("reports whether a stroke actually changed the curve", () => {
    const path = straightPath();
    const pathBrush = brush();
    expect(pathBrush.apply(path, { kind: "push", previous: { x: 2, y: 7.5 }, center: { x: 2, y: 7.6 }, radius: 0.5, strength: 1 }).changed).toBe(false);
    expect(pathBrush.apply(path, { kind: "push", previous: { x: 5, y: 4 }, center: { x: 5, y: 4.1 }, radius: 1, strength: 1 }).changed).toBe(true);
  });

  it("keeps global endpoints anchored when the brush overlaps them", () => {
    const path = straightPath();
    const positions = path.waypoints.map(({ x, y }) => ({ x, y }));
    brush().apply(path, { kind: "push", previous: { x: 1, y: 4 }, center: { x: 1.2, y: 4.3 }, radius: 1.2, strength: 1 });

    expect(path.waypoints.map(({ x, y }) => ({ x, y }))).toEqual(positions);
    expect(distanceToSamples({ x: 1.8, y: 4 }, samplePath(path))).toBeGreaterThan(0.001);
  });
});
