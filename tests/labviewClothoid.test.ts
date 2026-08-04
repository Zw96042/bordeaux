import { describe, expect, it } from "vitest";
import { generateLabviewClothoidPath } from "../src/shared/math/labviewClothoid";

describe("LabVIEW clothoid vertex blends", () => {
  it("preserves an unblended straight polyline", () => {
    const points = generateLabviewClothoidPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 0 }], 1);
    expect(points).toHaveLength(3);
    expect(points.map((point) => point.kind)).toEqual(["straight", "straight", "straight"]);
    expect(points.at(-1)).toMatchObject({ x: 5, y: 0, heading: 0, curvature: 0, s: 5 });
  });

  it("builds a symmetric signed 90-degree Euler blend", () => {
    const points = generateLabviewClothoidPath([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], 1);
    const curved = points.filter((point) => point.kind !== "straight");
    expect(curved.length).toBeGreaterThan(1_000);
    expect(curved.some((point) => point.kind === "arc")).toBe(false);
    expect(Math.max(...curved.map((point) => point.curvature))).toBeCloseTo(1, 6);
    expect(points.at(-1)).toMatchObject({ x: 5, y: 5, curvature: 0 });
    expect(points.at(-1)!.heading).toBeCloseTo(Math.PI / 2, 8);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index].s).toBeGreaterThan(points[index - 1].s);
      expect(points[index].heading).toBeGreaterThanOrEqual(points[index - 1].heading - 1e-9);
    }
  });

  it("mirrors left and right turns with opposite signed curvature", () => {
    const left = generateLabviewClothoidPath([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], 1);
    const right = generateLabviewClothoidPath([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: -5 }], 1);
    expect(right).toHaveLength(left.length);
    left.forEach((point, index) => {
      expect(right[index].x).toBeCloseTo(point.x, 8);
      expect(right[index].y).toBeCloseTo(-point.y, 8);
      expect(right[index].heading).toBeCloseTo(-point.heading, 8);
      expect(right[index].curvature).toBeCloseTo(-point.curvature, 8);
      expect(right[index].s).toBeCloseTo(point.s, 8);
    });
  });

  it("inserts a constant-radius arc above 90 degrees", () => {
    const angle = 120 * Math.PI / 180;
    const points = generateLabviewClothoidPath([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8 + 8 * Math.cos(angle), y: 8 * Math.sin(angle) },
    ], 2);
    const arc = points.filter((point) => point.kind === "arc");
    expect(arc.length).toBeGreaterThan(10);
    arc.forEach((point) => expect(point.curvature).toBeCloseTo(0.5, 8));
    expect(points.at(-1)!.heading).toBeCloseTo(angle, 8);
  });

  it("reduces adjacent oversized blends so their trims remain ordered", () => {
    const points = generateLabviewClothoidPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ], 10);
    expect(points.length).toBeGreaterThan(1_000);
    expect(points[0]).toMatchObject({ x: 0, y: 0 });
    expect(points.at(-1)).toMatchObject({ x: 2, y: 1 });
    points.forEach((point) => {
      expect(Number.isFinite(point.x + point.y + point.heading + point.curvature + point.s)).toBe(true);
    });
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index].s).toBeGreaterThan(points[index - 1].s);
    }
  });
});
