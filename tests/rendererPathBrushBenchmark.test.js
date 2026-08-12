import { expect, it } from "vitest";
import { PathBrush } from "../src/renderer/lib/pathBrush";
import { applyBrushDraft } from "../src/renderer/app/App";
import { createDemoProject } from "../src/shared/project/defaults";
import { validateProject } from "../src/shared/validation";

const benchmark = process.env.BENCHMARK_PATH_BRUSH === "1" ? it : it.skip;

function densePath(waypointCount, rangeCount) {
  const waypoints = Array.from({ length: waypointCount }, (_, index) => {
    const progress = index / (waypointCount - 1);
    const x = 0.7 + progress * 16;
    const phase = progress * Math.PI * 4;
    const y = 4 + Math.sin(phase) * 0.18;
    const dx = 16 / (waypointCount - 1) / 3;
    const dy = Math.cos(phase) * 0.18 * Math.PI * 4 / (waypointCount - 1) / 3;
    return {
      x,
      y,
      prevC: { x: x - dx, y: y - dy },
      nextC: { x: x + dx, y: y + dy },
      linked: true,
      theta: 0,
      thetaOn: index === 0 || index === waypointCount - 1,
      stop: false,
      segType: "bezier",
    };
  });
  const project = createDemoProject();
  const path = project.paths[0];
  path.headingMode = "tangent";
  path.waypoints = waypoints;
  path.ranges = Array.from({ length: rangeCount }, (_, index) => {
    const segment = index % (waypointCount - 1);
    return {
      anchor: "wp",
      f0: (segment + 0.2) / (waypointCount - 1),
      f1: (segment + 0.8) / (waypointCount - 1),
      w0: segment, t0: 0.2, w1: segment, t1: 0.8,
      maxVel: 2, maxAccel: 3, maxDecel: 3,
      maxAngVel: 360, maxAngAccel: 540,
    };
  });
  expect(validateProject(project).ok).toBe(true);
  return path;
}

function settings() {
  return {
    waypointCount: Number.parseInt(process.env.BENCHMARK_PATH_BRUSH_WAYPOINTS || "4096", 10),
    rangeCount: Number.parseInt(process.env.BENCHMARK_PATH_BRUSH_RANGES || "4096", 10),
    runs: Number.parseInt(process.env.BENCHMARK_PATH_BRUSH_RUNS || "7", 10),
  };
}

function summarize(benchmarkName, waypointCount, rangeCount, removed, samples) {
  const ordered = samples.slice().sort((left, right) => left - right);
  const median = ordered[Math.floor(ordered.length / 2)];
  console.log(JSON.stringify({ benchmark: benchmarkName, waypointCount, rangeCount, removed, samplesMs: samples, medianMs: median }));
}

benchmark("smooths a valid maximum-size ranged path", () => {
  const { waypointCount, rangeCount, runs } = settings();
  const fixture = densePath(waypointCount, rangeCount);
  const samples = [];
  let removed = 0;
  for (let run = 0; run < runs + 1; run += 1) {
    const path = structuredClone(fixture);
    const started = performance.now();
    removed = PathBrush.apply(path, {
      kind: "smooth", previous: { x: 8.45, y: 4 }, center: { x: 8.5, y: 4 },
      radius: 3, strength: 1,
    }).removed;
    if (run > 0) samples.push(performance.now() - started);
  }
  expect(removed).toBeGreaterThan(0);
  expect(removed).toBeLessThanOrEqual(16);
  summarize("path-brush-smooth", waypointCount, rangeCount, removed, samples);
});

benchmark("applies a smooth draft within one pointer frame", () => {
  const { waypointCount, rangeCount, runs } = settings();
  const fixture = densePath(waypointCount, rangeCount);
  const store = { getSnapshot: () => fixture, update: () => undefined, begin: () => undefined };
  const stroke = {
    kind: "smooth", previous: { x: 8.45, y: 4 }, center: { x: 8.5, y: 4 },
    radius: 3, strength: 1,
  };
  const samples = [];
  let removed = 0;
  for (let run = 0; run < runs + 1; run += 1) {
    const started = performance.now();
    removed = applyBrushDraft(store, fixture, stroke).removed;
    if (run > 0) samples.push(performance.now() - started);
  }
  expect(removed).toBeGreaterThan(0);
  summarize("path-brush-pointer-frame", waypointCount, rangeCount, removed, samples);
});
