import { describe, expect, it } from "vitest";
import { appToOfficialPoint, officialToAppPoint, REBUILT_2026_CROSSINGS, REBUILT_2026_FIELD, REBUILT_2026_FIELD_LENGTH_M, REBUILT_2026_INITIAL_FUEL_REGION } from "../src/shared/field/rebuilt2026";
import { resolveFieldTerm, resolveProjectFieldTerm, resolveStrategyTerm } from "../src/shared/field/vocabulary";
import { validateProject } from "../src/shared/validation";
import { createDemoProject } from "../src/shared/project/defaults";

describe("2026 field vocabulary", () => {
  it("keeps official dimensions separate from the legacy renderer calibration", () => {
    expect(REBUILT_2026_FIELD.dimensions.lengthM).toBe(16.541);
    expect(REBUILT_2026_FIELD.appDisplayTransform.appLengthM).toBe(17.548);
    const official = { x: 4.883, y: 2.25 };
    const roundTrip = appToOfficialPoint(officialToAppPoint(official));
    expect(roundTrip.x).toBeCloseTo(official.x, 10);
    expect(roundTrip.y).toBeCloseTo(official.y, 10);
  });

  it("resolves alliance-relative manual vocabulary into app coordinates", () => {
    const blue = resolveFieldTerm("far side of the neutral zone", { alliance: "blue" });
    const red = resolveFieldTerm("far side of the neutral zone", { alliance: "red" });
    expect(blue.status).toBe("resolved");
    expect(red.status).toBe("resolved");
    expect(blue.matches[0].officialPoint?.x).toBeGreaterThan(REBUILT_2026_FIELD_LENGTH_M / 2);
    expect(red.matches[0].officialPoint?.x).toBeLessThan(REBUILT_2026_FIELD_LENGTH_M / 2);
  });

  it("preserves the physical lane when resolving red near/far vocabulary", () => {
    const result = resolveFieldTerm("far side of the neutral zone", {
      alliance: "red",
      pose: { headingSource: "physical", x: 4.3, y: 7.2, physicalHeadingRad: 0 },
    });
    expect(result.matches[0].point.y).toBeCloseTo(7.2, 10);
  });

  it("distinguishes the shallow initial FUEL band from the full NEUTRAL ZONE", () => {
    expect(REBUILT_2026_INITIAL_FUEL_REGION.xMax - REBUILT_2026_INITIAL_FUEL_REGION.xMin).toBeCloseTo(1.8288, 10);
    const fuel = resolveFieldTerm("far side of the initial neutral FUEL band", { alliance: "red" });
    const neutral = resolveFieldTerm("far side of the neutral zone", { alliance: "red" });
    expect(fuel.status).toBe("resolved");
    expect(fuel.matches[0].point.x).toBeCloseTo(9.7441, 3);
    expect(fuel.matches[0].point.x).toBeLessThan(neutral.matches[0].point.x);
  });

  it("matches the official overhead image frame instead of swapping red and blue", () => {
    expect(REBUILT_2026_CROSSINGS.red.trenchTable.x).toBeLessThan(REBUILT_2026_CROSSINGS.blue.trenchTable.x);
    expect(REBUILT_2026_CROSSINGS.red.trenchTable.y).toBeCloseTo(REBUILT_2026_CROSSINGS.blue.trenchTable.y, 10);
    expect(REBUILT_2026_CROSSINGS.red.trenchTable.y).toBeLessThan(REBUILT_2026_CROSSINGS.red.trenchAway.y);
    expect(REBUILT_2026_FIELD.coordinateFrame).toContain("+Y away from the scoring-table");
  });

  it("resolves red left from the red drivers' perspective, independent of Blue view", () => {
    const result = resolveFieldTerm("red left trench", { defaultAlliance: "blue", allianceView: "blue", robotHeightM: 0.5 });
    expect(result.status).toBe("resolved");
    expect(result.matches[0].id).toBe("red-trench-table");
    expect(result.matches[0].point.x).toBeLessThan(REBUILT_2026_FIELD.appDisplayTransform.appLengthM / 2);
    expect(result.matches[0].point.y).toBeLessThan(REBUILT_2026_FIELD.appDisplayTransform.appWidthM / 2);
    expect(resolveFieldTerm("red left trench", { alliance: "blue" }).message).toContain("will not silently substitute");
  });

  it("publishes full BUMP depth, edge-aligned TRENCH openings, and corrected HUB bounds", () => {
    const blue = REBUILT_2026_FIELD.crossingBarriers.find((item) => item.allianceOwner === "blue")!;
    const tableTrench = blue.portals.find((item) => item.traversal === "trench" && item.side === "table")!;
    const tableBump = blue.portals.find((item) => item.traversal === "bump" && item.side === "table")!;
    expect(tableTrench.bounds.yMin).toBe(0);
    expect(tableTrench.bounds.yMax).toBeCloseTo(1.278636, 6);
    expect(tableBump.bounds.xMax - tableBump.bounds.xMin).toBeCloseTo(1.12776, 6);
    expect(tableBump.bounds.yMax - tableBump.bounds.yMin).toBeCloseTo(1.8542, 6);
    const blueHub = REBUILT_2026_FIELD.solidObstacles.find((item) => item.id === "blue-hub")!;
    expect(blueHub.bounds?.xMin).toBeCloseTo(4.02844, 6);
    expect(blueHub.bounds?.xMax).toBeCloseTo(5.22224, 6);
    expect(resolveFieldTerm("red HUB").status).toBe("resolved");
    expect(REBUILT_2026_FIELD.solidObstacles.every((item) => item.behavior === "solid")).toBe(true);
  });

  it("inventories official structures, off-field vocabulary, HUB faces, rungs, and all welded AprilTags", () => {
    const ids = new Set(REBUILT_2026_FIELD.landmarks.map((item) => item.id));
    expect(["blue-depot", "red-depot", "alliance-area", "outpost-area", "human-starting-line", "blue-outpost-chute", "red-outpost-corral", "blue-tower-low-rung", "red-tower-high-rung", "blue-driver-station-1", "red-driver-station-3", "blue-hub-neutral-face", "red-hub-table-face"].every((id) => ids.has(id))).toBe(true);
    expect(REBUILT_2026_FIELD.landmarks.filter((item) => item.id.startsWith("apriltag-"))).toHaveLength(32);
    expect(resolveFieldTerm("AprilTag 29")).toMatchObject({ status: "resolved", matches: [{ navigable: false, officialPoint: { x: 0.007747, y: 0.6659626 } }] });
    expect(resolveFieldTerm("alliance area")).toMatchObject({ status: "unresolved", matches: [] });
    expect(resolveFieldTerm("alliance area").message).toContain("not an on-field robot drive coordinate");
  });

  it("uses the physical chassis frame exactly once for front and back", () => {
    const authored = { headingSource: "authored" as const, x: 5, y: 4, authoredHeadingRad: 0, driveBackward: true };
    const front = resolveFieldTerm("front of bot", { pose: authored, relativeDistanceM: 1 });
    const back = resolveFieldTerm("back of bot", { pose: authored, relativeDistanceM: 1 });
    expect(front.matches[0].point.x).toBeCloseTo(4);
    expect(back.matches[0].point.x).toBeCloseTo(6);
    const sampled = resolveFieldTerm("front of robot", { pose: { headingSource: "physical", x: 5, y: 4, physicalHeadingRad: Math.PI }, relativeDistanceM: 1 });
    expect(sampled.matches[0].point.x).toBeCloseTo(4);
