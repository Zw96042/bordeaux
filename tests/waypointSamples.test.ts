import { describe, expect, it } from "vitest";
import { PM } from "../src/shared/math/pm";
import { getPlanner } from "../src/shared/planners";
import { orderedWaypointSampleIndices } from "../src/shared/planners/waypointSamples";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { PathDoc, TrajectorySample } from "../src/shared/types";

function legacyArrivalIndices(path: PathDoc, samples: readonly TrajectorySample[]): number[] {
  let cursor = 0;
  return path.waypoints.map((waypoint, waypointIndex) => {
    let best = cursor;
    let distance = Infinity;
    const last = waypointIndex === path.waypoints.length - 1
      ? samples.length - 1
      : Math.max(cursor, samples.length - (path.waypoints.length - waypointIndex));
    for (let index = cursor; index <= last; index += 1) {
      const candidate = Math.hypot(samples[index].x - waypoint.x, samples[index].y - waypoint.y);
      if (candidate < distance) { best = index; distance = candidate; }
    }
    cursor = best;
    return best;
  });
}

function legacyHeadingAt(fraction: number, anchors: readonly { f: number; rad: number }[]): number {
  if (!anchors.length) return 0;
  if (fraction <= anchors[0].f) return anchors[0].rad;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const first = anchors[index], second = anchors[index + 1];
    if (fraction < first.f || fraction > second.f) continue;
    const progress = second.f - first.f < 1e-6 ? 0 : (fraction - first.f) / (second.f - first.f);
    const smooth = progress * progress * (3 - 2 * progress);
    return PM.angLerp(first.rad, second.rad, smooth);
  }
  return anchors.at(-1)!.rad;
}

describe("shared path indices", () => {
  it("matches ordered nearest-waypoint arrivals on rounded planner samples", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 0.7123456, y: 2.1234567, segType: "line" },
      { x: 5.2345678, y: 4.3456789, segType: "line" },
      { x: 9.8765432, y: 2.7654321, segType: "line" },
      { x: 0.7123456, y: 2.1234567 },
    ]);
    const samples = getPlanner("profiledSpline").generate({ path, robot: project.robot }).samples;

    expect(orderedWaypointSampleIndices(path.waypoints, samples))
      .toEqual(legacyArrivalIndices(path, samples));
  });

  it("preserves heading interpolation at anchors, duplicates, and between anchors", () => {
    const anchors = [
      { f: 0, rad: -1 },
      { f: 0.2, rad: 0.5 },
      { f: 0.2, rad: 1 },
      { f: 0.75, rad: -2 },
      { f: 1, rad: 2 },
    ];
    for (const fraction of [-0.1, 0, 0.1, 0.2, 0.20001, 0.6, 0.75, 0.9, 1, 1.1]) {
      expect(PM.headingAt(fraction, anchors)).toBe(legacyHeadingAt(fraction, anchors));
    }
  });
});
