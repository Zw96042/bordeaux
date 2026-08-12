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

const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// Densely samples every segment so tests can compare curve shape rather than control-point
// bookkeeping: splitting or merging a segment moves handles while leaving the curve intact.
function samplePath(path: Path, perSegment = 80): Point[] {
  const samples: Point[] = [];
  for (let index = 0; index + 1 < path.waypoints.length; index++) {
    const start = path.waypoints[index];
    const end = path.waypoints[index + 1];
    for (let step = 0; step <= perSegment; step++) {
      const t = step / perSegment;
      const u = 1 - t;
      samples.push({
        x: u ** 3 * start.x + 3 * u ** 2 * t * start.nextC.x + 3 * u * t ** 2 * end.prevC.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * start.nextC.y + 3 * u * t ** 2 * end.prevC.y + t ** 3 * end.y,
      });
    }
  }
  return samples;
}

// Distance from a point to the sampled curve. Comparing sample-to-sample instead would
// charge for the reparameterization an exact split introduces and report phantom drift.
function distanceToSamples(value: Point, samples: Point[]): number {
  let closest = Infinity;
  for (let index = 1; index < samples.length; index++) {
    const a = samples[index - 1];
    const b = samples[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-18) { closest = Math.min(closest, gap(value, a)); continue; }
    const t = Math.max(0, Math.min(1, ((value.x - a.x) * dx + (value.y - a.y) * dy) / lengthSquared));
    closest = Math.min(closest, gap(value, { x: a.x + dx * t, y: a.y + dy * t }));
  }
  return closest;
}

// Worst deformation of the pre-stroke curve at points the brush could not reach.
function driftOutside(before: Point[], after: Point[], center: Point, radius: number): number {
  let worst = 0;
  for (const sample of before) {
    if (gap(sample, center) <= radius) continue;
    worst = Math.max(worst, distanceToSamples(sample, after));
  }
  return worst;
}

// Cumulative arc-length fraction at each waypoint, matching how PM resolves a `wp` anchor.
function waypointFractions(path: Path): number[] {
  const cumulative = [0];
  let total = 0;
  for (let index = 0; index + 1 < path.waypoints.length; index++) {
    const segment = samplePath({ ...path, waypoints: path.waypoints.slice(index, index + 2) }, 128);
    for (let step = 1; step < segment.length; step++) total += gap(segment[step - 1], segment[step]);
    cumulative.push(total);
  }
  return cumulative.map((value) => (total > 1e-9 ? value / total : 0));
}

// Where a `wp`-anchored endpoint actually lands, as a fraction of the whole path.
function anchorFraction(path: Path, waypointIndex: number, local?: number): number {
  const fractions = waypointFractions(path);
  if (local == null) return fractions[Math.max(0, Math.min(fractions.length - 1, waypointIndex))];
  const segment = Math.max(0, Math.min(fractions.length - 2, Math.round(waypointIndex)));
  return fractions[segment] + (fractions[segment + 1] - fractions[segment]) * Math.max(0, Math.min(1, local));
}

function anchorPoint(path: Path, waypointIndex: number, local = 0): Point {
  const segment = Math.max(0, Math.min(path.waypoints.length - 2, waypointIndex));
  const start = path.waypoints[segment];
  const end = path.waypoints[segment + 1];
  const t = Math.max(0, Math.min(1, local));
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u ** 2 * t * start.nextC.x + 3 * u * t ** 2 * end.prevC.x + t ** 3 * end.x,
    y: u ** 3 * start.y + 3 * u ** 2 * t * start.nextC.y + 3 * u * t ** 2 * end.prevC.y + t ** 3 * end.y,
  };
}

// An S-curve with realistic handle lengths, used where a straight line would hide bending.
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

describe("path sculpting brushes", () => {
  it("subdivides only the influenced curve and pushes the new waypoints", () => {
    const path = straightPath();
    const result = brush().apply(path, {
      kind: "push",
      previous: { x: 5.5, y: 4 },
      center: { x: 5.5, y: 5 },
      radius: 1.6,
      strength: 1,
    });

    expect(result.added).toBeGreaterThan(1);
    expect(path.waypoints.length).toBe(2 + result.added);
    expect(path.waypoints[0]).toMatchObject({ x: 1, y: 4 });
    expect(path.waypoints.at(-1)).toMatchObject({ x: 10, y: 4 });
    expect(path.waypoints.slice(1, -1).some((waypoint) => waypoint.y > 4.1)).toBe(true);
    expect(path.ranges[0].w1).toBe(path.waypoints.length - 1);
    expect(path.waypoints.every((waypoint) => [waypoint.x, waypoint.y, waypoint.prevC.x, waypoint.nextC.y].every(Number.isFinite))).toBe(true);
  });

  it("does not retangent an unmoved waypoint just outside the brush radius", () => {
    const path = straightPath();
    // A hand-shaped, deliberately unlinked waypoint sitting outside the brush.
    path.waypoints.splice(1, 0, {
      x: 5.5,
      y: 4,
      prevC: { x: 4.9, y: 3.4 },
      nextC: { x: 6.1, y: 4.6 },
      linked: false,
      theta: 0,
      thetaOn: false,
      stop: false,
      segType: "bezier",
    });
    const authored = { x: 5.5, y: 4, nextC: { x: 6.1, y: 4.6 } };
    const center = { x: 4.2, y: 4.4 };
    const radius = 1.2;
    expect(Math.hypot(authored.x - center.x, authored.y - center.y)).toBeGreaterThan(radius);

    brush().apply(path, { kind: "push", previous: { x: 4.2, y: 4 }, center, radius, strength: 1 });

    const survivor = path.waypoints.find((waypoint) => waypoint.x === authored.x && waypoint.y === authored.y);
    expect(survivor).toBeDefined();
    expect(survivor).toMatchObject({ nextC: authored.nextC, linked: false });
  });

  it("preserves local constraint-range anchors when a segment is split", () => {
    const path = straightPath();
    path.ranges = [{ anchor: "wp", w0: 0, t0: 0.25, w1: 0, t1: 0.75 }];
    brush().apply(path, {
      kind: "push",
      previous: { x: 5.5, y: 4 },
      center: { x: 5.5, y: 4 },
      radius: 4,
      strength: 1,
    });

    const position = (waypointIndex: number, local: number) => {
      const start = path.waypoints[waypointIndex];
      const end = path.waypoints[waypointIndex + 1];
      const oneMinusT = 1 - local;
      return oneMinusT ** 3 * start.x
        + 3 * oneMinusT ** 2 * local * start.nextC.x
        + 3 * oneMinusT * local ** 2 * end.prevC.x
        + local ** 3 * end.x;
    };
    const range = path.ranges[0];
    expect(position(range.w0, range.t0 ?? 0)).toBeCloseTo(3.25, 2);
    expect(position(range.w1, range.t1 ?? 0)).toBeCloseTo(7.75, 2);
  });

  it("refuses a smooth merge that would reshape the curve outside the brush", () => {
    // Merging rewrites both neighbours' handles, which reach past a small brush. Sculpt a
    // curve first so the span around the merge candidate carries real curvature.
    const path = straightPath();
    const pathBrush = brush();
    pathBrush.apply(path, { kind: "push", previous: { x: 5.5, y: 4 }, center: { x: 5.5, y: 5 }, radius: 2.4, strength: 1 });
    pathBrush.apply(path, { kind: "push", previous: { x: 5.5, y: 5 }, center: { x: 6.2, y: 5.3 }, radius: 2.4, strength: 1 });

    const center = { x: 4.5, y: 4.7 };
    const radius = 0.8;
    const before = samplePath(path);

    pathBrush.apply(path, { kind: "smooth", previous: { x: 4.35, y: 4.65 }, center, radius, strength: 0.4 });

    // Samples the brush could not reach must still lie on the curve. Accepting the merge
    // here would drag them roughly 2cm.
    const after = samplePath(path);
    const outside = before.filter((sample) => Math.hypot(sample.x - center.x, sample.y - center.y) > radius);
    expect(outside.length).toBeGreaterThan(0);
    const drift = Math.max(...outside.map((sample) => Math.min(...after.map((other) => Math.hypot(sample.x - other.x, sample.y - other.y)))));
    expect(drift).toBeLessThan(0.002);
  });

  it("removes redundant waypoints while preserving local range positions", () => {
    const path = straightPath();
    path.waypoints.splice(1, 0, {
      x: 5.5,
      y: 4,
      prevC: { x: 4, y: 4 },
      nextC: { x: 7, y: 4 },
      linked: true,
      theta: 0,
      thetaOn: false,
      stop: false,
      segType: "bezier",
    });
    path.waypoints[0].nextC = { x: 2.5, y: 4 };
    path.waypoints[2].prevC = { x: 8.5, y: 4 };
    path.ranges = [{ anchor: "wp", w0: 0, t0: 0.5, w1: 1, t1: 0.5 }];

    const result = brush().apply(path, {
      kind: "smooth",
      previous: { x: 5.3, y: 4 },
      center: { x: 5.5, y: 4 },
      radius: 3,
      strength: 1,
    });

    expect(result).toMatchObject({ added: 0, removed: 1 });
    expect(path.waypoints).toHaveLength(2);
    expect(path.ranges[0]).toMatchObject({ w0: 0, w1: 0 });
    expect(path.ranges[0].t0).toBeCloseTo(0.25, 1);
    expect(path.ranges[0].t1).toBeCloseTo(0.75, 1);
  });

  it("keeps semantic and shape-defining waypoints", () => {
    const path = straightPath();
    path.waypoints.splice(1, 0, {
      x: 5.5,
      y: 6,
      prevC: { x: 4, y: 5.5 },
      nextC: { x: 7, y: 5.5 },
      linked: false,
      corner: true,
      theta: 90,
      thetaOn: true,
      stop: false,
      segType: "bezier",
    });

    const result = brush().apply(path, {
      kind: "smooth",
      previous: { x: 5.3, y: 6 },
      center: { x: 5.5, y: 6 },
      radius: 3,
      strength: 1,
    });

    expect(result.removed).toBe(0);
    expect(path.waypoints).toHaveLength(3);
    expect(path.waypoints[1]).toMatchObject({ x: 5.5, y: 6, corner: true, thetaOn: true });
  });

  it("keeps a non-semantic waypoint when merging would change the curve", () => {
    const path = straightPath();
    path.waypoints.splice(1, 0, {
      x: 5.5,
      y: 6,
      prevC: { x: 4.5, y: 6 },
      nextC: { x: 6.5, y: 6 },
      linked: true,
      theta: 0,
      thetaOn: false,
      stop: false,
      segType: "bezier",
    });

    const result = brush().apply(path, {
      kind: "smooth",
      previous: { x: 5.45, y: 6 },
      center: { x: 5.5, y: 6 },
      radius: 1,
      strength: 0.2,
    });

    expect(result.removed).toBe(0);
    expect(path.waypoints).toHaveLength(3);
  });

  it("keeps waypoint boundaries that change segment policy", () => {
    const path = straightPath();
    path.waypoints.splice(1, 0, {
      x: 5.5,
      y: 4,
      prevC: { x: 4, y: 4 },
      nextC: { x: 7, y: 4 },
      linked: true,
      theta: 0,
      thetaOn: false,
      stop: false,
      segType: "bezier",
      segmentFollowMode: "reverse",
    });

    const result = brush().apply(path, {
      kind: "smooth",
      previous: { x: 5.3, y: 4 },
      center: { x: 5.5, y: 4 },
      radius: 3,
      strength: 1,
    });

    expect(result.removed).toBe(0);
    expect(path.waypoints).toHaveLength(3);
  });

  it("does not keep adding topology after local spacing is dense enough", () => {
    const path = straightPath();
    const pathBrush = brush();
    const stroke = { kind: "push", previous: { x: 5, y: 4 }, center: { x: 5.1, y: 4.2 }, radius: 1, strength: 0.6 };
    const first = pathBrush.apply(path, stroke);
    const count = path.waypoints.length;
    const second = pathBrush.apply(path, { ...stroke, previous: stroke.center, center: { x: 5.2, y: 4.3 } });

    expect(first.added).toBeGreaterThan(0);
    expect(second.added).toBeLessThanOrEqual(2);
    expect(path.waypoints.length).toBeLessThanOrEqual(count + 2);
  });

  it("smooths noisy waypoints and twirls a curve around the brush center", () => {
    const path = straightPath();
    const pathBrush = brush();
    pathBrush.apply(path, { kind: "push", previous: { x: 5.5, y: 4 }, center: { x: 5.5, y: 5.2 }, radius: 2, strength: 1 });
    const peakBefore = Math.max(...path.waypoints.map((waypoint) => waypoint.y));
    pathBrush.apply(path, { kind: "smooth", previous: { x: 5.3, y: 5 }, center: { x: 5.7, y: 5 }, radius: 2.2, strength: 1 });
    const peakAfter = Math.max(...path.waypoints.map((waypoint) => waypoint.y));
    expect(peakAfter).toBeLessThan(peakBefore);

    const before = path.waypoints.map(({ x, y }) => ({ x, y }));
    pathBrush.apply(path, { kind: "twirl", previous: { x: 5.2, y: 4.7 }, center: { x: 5.8, y: 4.7 }, radius: 2, strength: 0.8 });
    expect(path.waypoints.some((waypoint, index) => Math.hypot(waypoint.x - before[index].x, waypoint.y - before[index].y) > 0.01)).toBe(true);
  });

  // A segment whose shape is generated from its endpoints, not its handles. Subdividing or
  // retangenting one would silently reinterpret it as a Bézier.
  it.each(["arc", "clothoid"])("leaves %s segments untouched", (segType) => {
    const path: Path = {
      waypoints: [
        { x: 1, y: 4, prevC: { x: 1, y: 4 }, nextC: { x: 3, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false, segType },
        { x: 6, y: 4, prevC: { x: 4, y: 4 }, nextC: { x: 8, y: 4 }, linked: true, theta: 0, thetaOn: false, stop: false, segType },
        { x: 12, y: 4, prevC: { x: 10, y: 4 }, nextC: { x: 12, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false },
      ],
      ranges: [],
    };
    const snapshot = JSON.stringify(path.waypoints);

    const result = brush().apply(path, { kind: "push", previous: { x: 6, y: 4 }, center: { x: 6, y: 4.6 }, radius: 1.5, strength: 1 });

    expect(result).toMatchObject({ added: 0, removed: 0, changed: false });
    expect(JSON.stringify(path.waypoints)).toBe(snapshot);
  });

  it("confines a small drag to the brush on a curved path", () => {
    const path = curvedPath();
    const center = { x: 5, y: 4 };
    const radius = 1;
    const before = samplePath(path);

    // A 1 cm drag. Before rim anchoring this bent the neighbouring segments by ~0.27 m.
    brush().apply(path, { kind: "push", previous: { x: center.x, y: center.y - 0.01 }, center, radius, strength: 1 });

    const after = samplePath(path);
    expect(driftOutside(before, after, center, radius)).toBeLessThan(0.001);
    // The stroke still did its job inside the brush.
    expect(distanceToSamples(center, after)).toBeGreaterThan(0.002);
  });

  it("pins the outside edge when a tight curve enters a small brush", () => {
    const path: Path = {
      waypoints: [
        { x: 1.5, y: 2.357286002021283, prevC: { x: 0.13400839447954405, y: 1.7796357775122171 }, nextC: { x: 2.0551417665539167, y: 2.5920442280515577 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
        { x: 5, y: 4.692719192709774, prevC: { x: 3.8768699890705296, y: 4.777529440879848 }, nextC: { x: 6.188715024037764, y: 4.602956462472776 }, linked: true, theta: 0, thetaOn: false, stop: false, segType: "bezier" },
        { x: 8.5, y: 6.251226670574397, prevC: { x: 7.552763727148848, y: 4.351259580892702 }, nextC: { x: 8.876854514094784, y: 7.007121683149142 }, linked: true, theta: 0, thetaOn: false, stop: false, segType: "bezier" },
        { x: 12, y: 1.3511616117320955, prevC: { x: 11.502353800164393, y: 0.8821462698795819 }, nextC: { x: 13.730569620727616, y: 2.982167138416041 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
      ],
      ranges: [],
    };
    const center = { x: 8.565781697702949, y: 6.350418574169616 };
    const radius = 0.22996919080615044;
    const before = samplePath(path, 600);

    brush().apply(path, {
      kind: "push",
      previous: { x: 8.557453245336374, y: 6.355953633444609 },
      center,
      radius,
      strength: 1,
    });

    // Without an entering-side exterior anchor, this moved geometry 1.81 m from the
    // cursor by more than 1.6 cm.
    expect(driftOutside(before, samplePath(path, 600), center, radius)).toBeLessThan(0.001);
  });

  // The hardest case for locality: a waypoint carrying long, hand-authored handles, so any
  // wholesale retangent of it swings metres of far geometry.
  function longHandlePath(): Path {
    return {
      waypoints: [
        { x: 1, y: 4, prevC: { x: 1, y: 4 }, nextC: { x: 2, y: 6.5 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
        { x: 5, y: 4, prevC: { x: 3.5, y: 6.5 }, nextC: { x: 6.5, y: 1.5 }, linked: true, theta: 0, thetaOn: false, stop: false, segType: "bezier" },
        { x: 9, y: 4, prevC: { x: 8, y: 1.5 }, nextC: { x: 9, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false },
      ],
      ranges: [],
    };
  }

  it.each([
    { label: "grazing the waypoint", center: { x: 5.95, y: 4 }, radius: 1 },
    // Here the brush rim falls mid-segment, so the anchor is a generated waypoint rather
    // than an authored one.
    { label: "with the rim mid-segment", center: { x: 4.5, y: 4 }, radius: 1.5 },
    // The authored waypoint sits just inside the rim, where an unweighted retangent would
    // replace its 2 m handles outright and swing the curve by most of a metre.
    { label: "barely reaching the waypoint", center: { x: 4.5, y: 4 }, radius: 1.2 },
  ])("confines a 1 cm drag on a long-handled path $label", ({ center, radius }) => {
    const path = longHandlePath();
    const before = samplePath(path);

    brush().apply(path, { kind: "push", previous: { x: center.x, y: center.y - 0.01 }, center, radius, strength: 1 });

    // Originally a 1 cm drag here moved the curve 0.9 m several metres away.
    expect(driftOutside(before, samplePath(path), center, radius)).toBeLessThan(0.0006);
  });

  it("declines a smooth merge that would move the wave outside the brush", () => {
    // A dense sine, the shape Smooth is normally used on. The waypoint under the brush is
    // mergeable on its own terms, but collapsing it rewrites both neighbours' handles and
    // drags the next crest, which lies outside the radius.
    const steps = 10;
    const path: Path = {
      waypoints: Array.from({ length: steps + 1 }, (_, index) => {
        const x = 1 + index * (10 / steps);
        const y = 4 + Math.sin((index / steps) * Math.PI * 2) * 0.3;
        return { x, y, prevC: { x: x - 0.35, y }, nextC: { x: x + 0.35, y }, linked: true, theta: 0, thetaOn: index === 0 || index === steps, stop: false, segType: "bezier" };
      }),
      ranges: [],
    };
    const center = { x: 5.5, y: 4 };
    const radius = 1.2;
    const before = samplePath(path);

    brush().apply(path, { kind: "smooth", previous: { x: 5.45, y: 4 }, center, radius, strength: 1 });

    // Taking the merge here roughly doubles how far the outside curve shifts.
    expect(driftOutside(before, samplePath(path), center, radius)).toBeLessThan(0.008);
  });

  // Repeated strokes are the real usage pattern, and each one re-subdivides. Without a
  // waypoint pinned just past the rim, every stroke bends the segment leaving the brush and
  // the error compounds.
  it("keeps repeated strokes from accumulating drift outside the brush", () => {
    const path = curvedPath();
    const pathBrush = brush();
    const center = { x: 6.5, y: 4.6 };
    const radius = 0.9;
    const before = samplePath(path);

    for (let step = 0; step < 12; step++) {
      pathBrush.apply(path, { kind: "push", previous: { x: center.x, y: center.y - 0.01 }, center, radius, strength: 1 });
    }

    expect(driftOutside(before, samplePath(path), center, radius)).toBeLessThan(0.002);
  });

  it("holds a curved-segment range anchor in place through subdivision", () => {
    const path = curvedPath();
    path.ranges = [{ anchor: "wp", w0: 0, t0: 0.4, w1: 2, t1: 0.6 }];
    const startBefore = anchorPoint(path, 0, 0.4);
    const endBefore = anchorPoint(path, 2, 0.6);

    brush().apply(path, { kind: "push", previous: { x: 5, y: 4 }, center: { x: 5, y: 4.05 }, radius: 1.5, strength: 0.4 });

    const range = path.ranges[0];
    expect(gap(anchorPoint(path, range.w0, range.t0), startBefore)).toBeLessThan(0.0001);
    expect(gap(anchorPoint(path, range.w1, range.t1), endBefore)).toBeLessThan(0.0001);
  });

  // App.applyBrush follows a `wp` selection by object identity across a stroke. These cover
  // the contract that makes that possible: a surviving waypoint stays the same object, and
  // a merged one is gone rather than replaced in place.
  it("keeps surviving waypoints identical across a stroke that inserts topology", () => {
    const path = curvedPath();
    const tracked = path.waypoints[2];

    const result = brush().apply(path, { kind: "push", previous: { x: 3.2, y: 2.6 }, center: { x: 3.2, y: 3 }, radius: 1.5, strength: 1 });

    expect(result.added).toBeGreaterThan(0);
    const moved = path.waypoints.indexOf(tracked);
    // Still the same object, at a higher index now that waypoints were inserted before it.
    expect(moved).toBeGreaterThan(2);
    expect(path.waypoints[moved]).toBe(tracked);
  });

  it("drops a merged waypoint from the path rather than replacing it in place", () => {
    const path = legacyRangePath(2);
    path.ranges = [];
    const tracked = path.waypoints[2];

    const result = brush().apply(path, { kind: "smooth", previous: { x: 5.4, y: 4 }, center: { x: 5.5, y: 4 }, radius: 1, strength: 1 });

    expect(result.removed).toBeGreaterThan(0);
    // indexOf returning -1 is what tells the app to clear the selection instead of leaving
    // it pointed at whichever waypoint inherited the index.
    expect(path.waypoints.indexOf(tracked)).toBe(-1);
  });

  // Ranges from older project files name whole waypoints and carry no t0/t1.
  function legacyRangePath(anchorIndex: number): Path {
    return {
      waypoints: [0, 1, 2, 3, 4].map((step) => ({
        x: 1 + step * 2.2,
        y: 4,
        prevC: { x: 1 + step * 2.2 - 0.8, y: 4 },
        nextC: { x: 1 + step * 2.2 + 0.8, y: 4 },
        linked: true,
        theta: 0,
        thetaOn: step === 0 || step === 4,
        stop: false,
        segType: "bezier",
      })),
      ranges: [{ anchor: "wp", w0: anchorIndex, w1: anchorIndex }],
    };
  }

  it("keeps a legacy whole-waypoint range naming its waypoint when that waypoint survives", () => {
    const path = legacyRangePath(3);
    const anchored = path.waypoints[3];
    const before = anchorFraction(path, 3);

    // Merges near the start of the path, well away from the anchored waypoint.
    const result = brush().apply(path, { kind: "smooth", previous: { x: 3.1, y: 4 }, center: { x: 3.2, y: 4 }, radius: 1, strength: 1 });

    expect(result.removed).toBeGreaterThan(0);
    const range = path.ranges[0];
    expect(path.waypoints[range.w0]).toBe(anchored);
    expect(range.t0).toBeUndefined();
    expect(anchorFraction(path, range.w0, range.t0)).toBeCloseTo(before, 3);
  });

  it("holds a legacy range at its position when the brush merges the waypoint it names", () => {
    const path = legacyRangePath(2);
    const before = anchorFraction(path, 2);

    const result = brush().apply(path, { kind: "smooth", previous: { x: 5.4, y: 4 }, center: { x: 5.5, y: 4 }, radius: 1, strength: 1 });

    // The named waypoint is gone, so the range degrades to a local position rather than
    // snapping to whatever waypoint inherited the index.
    expect(result.removed).toBeGreaterThan(0);
    const range = path.ranges[0];
    expect(anchorFraction(path, range.w0, range.t0)).toBeCloseTo(before, 3);
  });

  it("reports whether a stroke changed anything", () => {
    const path = curvedPath();
    const pathBrush = brush();

    // Far from the path, so nothing is in range.
    expect(pathBrush.apply(path, { kind: "push", previous: { x: 2, y: 7.5 }, center: { x: 2, y: 7.6 }, radius: 0.5, strength: 1 }).changed).toBe(false);
    expect(pathBrush.apply(path, { kind: "push", previous: { x: 5, y: 4 }, center: { x: 5, y: 4.1 }, radius: 1, strength: 1 }).changed).toBe(true);
  });

  it("twirls a path dragged diagonally", () => {
    // The old twirl scaled rotation by (dx - dy), which cancels exactly on a 45-degree
    // drag, so a diagonal gesture silently did nothing.
    const path = straightPath();
    const pathBrush = brush();
    pathBrush.apply(path, { kind: "push", previous: { x: 5.5, y: 4 }, center: { x: 5.5, y: 4.8 }, radius: 2, strength: 1 });

    const origin = { x: 5.5, y: 4.4 };
    const before = samplePath(path);
    // Match the first UI sample: origin and previous are identical, and the pointer moves
    // away with equal x and y components.
    pathBrush.apply(path, { kind: "twirl", origin, previous: origin, center: { x: 5.8, y: 4.7 }, radius: 2, strength: 0.8 });

    const after = samplePath(path);
    const moved = Math.max(...before.map((sample) => distanceToSamples(sample, after)));
    expect(moved).toBeGreaterThan(0.01);
  });
});
