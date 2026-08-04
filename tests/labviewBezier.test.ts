import { describe, expect, it } from "vitest";
import {
  buildLabviewQuinticSpline,
  deriveLabviewTangents,
  evaluateLabviewQuinticDerivative,
  evaluateLabviewQuinticSecondDerivative,
  sampleLabviewQuinticByCount,
  sampleLabviewQuinticByDistance,
} from "../src/shared/math/labviewBezier";

describe("LabVIEW-compatible quintic Bezier geometry", () => {
  it("uses the normalized neighbor bisector for automatic interior tangents", () => {
    const tangent = deriveLabviewTangents([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }])[1];
    expect(Math.atan2(tangent.y, tangent.x)).toBeCloseTo(Math.PI / 4, 10);
    expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(0.5, 10);
  });

  it("preserves a straight line and its arc length", () => {
    const spline = buildLabviewQuinticSpline([
      { x: 0, y: 0, nextC: { x: 2, y: 0 } },
      { x: 10, y: 0, prevC: { x: 8, y: 0 } },
    ]);

    expect(spline.totalLength).toBeCloseTo(10, 10);
    const samples = sampleLabviewQuinticByCount(spline, 5);
    expect(samples.map((sample) => sample.x)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(samples.every((sample) => Math.abs(sample.y) < 1e-12)).toBe(true);
    expect(samples.every((sample) => Math.abs(sample.curvature) < 1e-12)).toBe(true);
  });

  it("shares first and second derivatives at interior waypoints", () => {
    const spline = buildLabviewQuinticSpline([
      { x: 0, y: 0, nextC: { x: 1, y: 0 } },
      { x: 3, y: 2, prevC: { x: 2, y: 1 }, nextC: { x: 4, y: 3 } },
      { x: 7, y: 1, prevC: { x: 6, y: 2 } },
    ]);
    const leftFirst = evaluateLabviewQuinticDerivative(spline.segments[0], 1);
    const rightFirst = evaluateLabviewQuinticDerivative(spline.segments[1], 0);
    const leftSecond = evaluateLabviewQuinticSecondDerivative(spline.segments[0], 1);
    const rightSecond = evaluateLabviewQuinticSecondDerivative(spline.segments[1], 0);

    expect(leftFirst.x).toBeCloseTo(rightFirst.x, 10);
    expect(leftFirst.y).toBeCloseTo(rightFirst.y, 10);
    expect(leftSecond.x).toBeCloseTo(rightSecond.x, 10);
    expect(leftSecond.y).toBeCloseTo(rightSecond.y, 10);
  });

  it("samples by fixed arc-distance and includes the final point", () => {
    const spline = buildLabviewQuinticSpline([
      { x: 0, y: 0, nextC: { x: 2, y: 0 } },
      { x: 10, y: 0, prevC: { x: 8, y: 0 } },
    ]);
    const samples = sampleLabviewQuinticByDistance(spline, 3);

    expect(samples.map((sample) => sample.distance)).toEqual([0, 3, 6, 9, 10]);
    expect(samples.at(-1)).toMatchObject({ x: 10, y: 0, t: 1 });
  });
});
