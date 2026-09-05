import { describe, expect, it } from "vitest";
// @ts-expect-error The production preview engine is an intentional JavaScript module.
import { PM } from "../src/renderer/lib/pathMath";
import { loadRendererExport } from "./helpers/loadRendererExport";

interface Point { x: number; y: number; s: number }
interface Range { start: number; end: number; first?: Point; last?: Point }

function fieldScene() {
  return loadRendererExport<{
    fractionRange(points: Point[], total: number, first: number, last: number): Range;
    fractionPathData(points: Point[], total: number, first: number, last: number, project: (point: Point) => Point, precision?: number): string;
    segmentRange(derived: { sample: { pts: Point[]; length: number }; wpIdx: number[] }, segment: number): Range;
    pathData(points: Point[], range: Range | null, project: (point: Point) => Point, precision?: number): string;
  }>(new URL("../src/renderer/assets/field-scene.js", import.meta.url), "FieldScene");
}

describe("renderer field scene construction", () => {
  const points = Array.from({ length: 101 }, (_, index) => ({ x: index, y: index / 2, s: index }));

  it("constructs bounded path spans from sampled indexes", () => {
    const scene = fieldScene();
    expect(scene.fractionRange(points, 100, 0.7, 0.8)).toMatchObject({ start: 69, end: 80 });
    const derived = { sample: { pts: points, length: 100 }, wpIdx: [0, 30, 70, 100] };
    expect(scene.segmentRange(derived, 1)).toEqual({ start: 30, end: 70 });
    let projections = 0;
    const data = scene.pathData(points, { start: 30, end: 32 }, (point) => {
      projections += 1;
      return point;
    }, 1);
    expect(data).toBe("M 30.0 15.0 L 31.0 15.5 L 32.0 16.0");
    expect(projections).toBe(3);

    const shortRange = scene.fractionRange(points, 100, 0.3025, 0.303);
    expect(scene.pathData(points, shortRange, (point) => point, 3))
      .toBe("M 30.250 15.125 L 30.300 15.150");
    expect(scene.fractionPathData(points, 100, 0.3025, 0.303, (point) => point, 3))
      .toBe("M 30.250 15.125 L 30.300 15.150");
  });
});

describe("renderer path hit testing", () => {
  it("keeps separate visits when a path crosses the same field point", () => {
    const crossing = [
      { x: -1, y: 0, s: 0, seg: 0, t: 0, heading: 0 },
      { x: 1, y: 0, s: 2, seg: 0, t: 1, heading: 0 },
      { x: 3, y: 3, s: 6, seg: 1, t: 0, heading: 1 },
      { x: 3, y: -3, s: 12, seg: 1, t: 1, heading: -1 },
      { x: 0, y: -1, s: 16, seg: 2, t: 0, heading: Math.PI / 2 },
      { x: 0, y: 1, s: 18, seg: 2, t: 1, heading: Math.PI / 2 },
    ];

    const visits = PM.nearestVisits(0, 0, crossing, { tolerance: 0.1 });
    expect(visits).toHaveLength(2);
    expect(visits[0].f).toBeLessThan(visits[1].f);
  });
});
