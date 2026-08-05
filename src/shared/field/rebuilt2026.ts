import { FIELD_H, FIELD_W } from "../math/fieldBounds";
import type { FieldLandmark, FieldPack, FieldPoint, FieldRect } from "./types";

export const REBUILT_2026_FIELD_REVISION = "2026-manual-tu19-welded-4";
export const REBUILT_2026_FIELD_LENGTH_M = 16.541;
export const REBUILT_2026_FIELD_WIDTH_M = 8.069;

// These semantic fixtures live in the official WPILib blue-origin frame. The
// renderer has an older image calibration, so conversion into PathDoc space is
// explicit rather than changing Bordeaux's long-standing field bounds.
const BLUE_BARRIER_X = 4.02844;
const RED_BARRIER_X = REBUILT_2026_FIELD_LENGTH_M - BLUE_BARRIER_X;
const TRENCH_OPENING_WIDTH_M = 1.278636;
export const REBUILT_2026_TRENCH_CLEARANCE_M = 22.25 * 0.0254;
const TRENCH_TABLE_Y = TRENCH_OPENING_WIDTH_M / 2;
const TRENCH_AWAY_Y = REBUILT_2026_FIELD_WIDTH_M - TRENCH_OPENING_WIDTH_M / 2;
const BUMP_TABLE_Y = 2.59461;
const BUMP_AWAY_Y = REBUILT_2026_FIELD_WIDTH_M - BUMP_TABLE_Y;
const STRUCTURE_DEPTH_M = 1.1938;
const BUMP_DEPTH_M = 1.12776;
const HUB_WIDTH_M = 1.1938;
const HUB_Y_MIN = (REBUILT_2026_FIELD_WIDTH_M - HUB_WIDTH_M) / 2;
const BLUE_STRUCTURE_X_MAX = BLUE_BARRIER_X + STRUCTURE_DEPTH_M;
const RED_STRUCTURE_X_MIN = RED_BARRIER_X - STRUCTURE_DEPTH_M;
const BLUE_BUMP_X_MAX = BLUE_BARRIER_X + BUMP_DEPTH_M;
const RED_BUMP_X_MIN = RED_BARRIER_X - BUMP_DEPTH_M;
const NEUTRAL_X_MIN = (REBUILT_2026_FIELD_LENGTH_M - 7.1882) / 2;
const NEUTRAL_X_MAX = REBUILT_2026_FIELD_LENGTH_M - NEUTRAL_X_MIN;
const INITIAL_FUEL_DEPTH_M = 72 * 0.0254;
const INITIAL_FUEL_WIDTH_M = 206 * 0.0254;

export function officialToAppPoint(point: FieldPoint): FieldPoint {
  return {
    // WPILib's blue-wall origin increases toward the red wall, while the
    // official overhead image used by Bordeaux draws red on the left.
    x: (REBUILT_2026_FIELD_LENGTH_M - point.x) * FIELD_W / REBUILT_2026_FIELD_LENGTH_M,
    y: point.y * FIELD_H / REBUILT_2026_FIELD_WIDTH_M,
  };
}

export function officialToAppRect(bounds: FieldRect): FieldRect {
  const first = officialToAppPoint({ x: bounds.xMin, y: bounds.yMin });
  const second = officialToAppPoint({ x: bounds.xMax, y: bounds.yMax });
  return {
    xMin: Math.min(first.x, second.x), xMax: Math.max(first.x, second.x),
    yMin: Math.min(first.y, second.y), yMax: Math.max(first.y, second.y),
  };
}

export function appToOfficialPoint(point: FieldPoint): FieldPoint {
  return {
    x: REBUILT_2026_FIELD_LENGTH_M - point.x * REBUILT_2026_FIELD_LENGTH_M / FIELD_W,
    y: point.y * REBUILT_2026_FIELD_WIDTH_M / FIELD_H,
  };
}

export function appToAllianceViewPoint(point: FieldPoint, allianceView: "blue" | "red"): FieldPoint {
  return allianceView === "red" ? { x: FIELD_W - point.x, y: FIELD_H - point.y } : { ...point };
}

function pointLandmark(
  id: string,
  name: string,
  aliases: string[],
  point: FieldPoint,
  allianceOwner?: "blue" | "red",
  traversal?: "trench" | "bump",
  allianceSide?: "left" | "right",
): FieldLandmark {
  return {
    id, name, aliases, kind: traversal ? "portal" : "point", point, allianceOwner, traversal, allianceSide,
    behavior: traversal === "trench" ? "overhead" : traversal === "bump" ? "traversable" : "interaction",
    ...(traversal === "trench" ? { openingWidthM: TRENCH_OPENING_WIDTH_M, clearanceHeightM: REBUILT_2026_TRENCH_CLEARANCE_M } : {}),
    ...(traversal === "bump" ? { openingWidthM: 1.8542 } : {}),
  };
}

function regionLandmark(id: string, name: string, aliases: string[], bounds: FieldRect): FieldLandmark {
  return { id, name, aliases, kind: "region", bounds };
}

function lineLandmark(id: string, name: string, aliases: string[], start: FieldPoint, end: FieldPoint, allianceOwner?: "blue" | "red"): FieldLandmark {
  return { id, name, aliases, kind: "line", line: { start, end }, point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, allianceOwner, behavior: "line" };
}

function obstacle(id: string, name: string, aliases: string[], bounds: FieldRect): FieldLandmark {
  return { id, name, aliases, kind: "obstacle", bounds, behavior: "solid", navigable: false };
}

function descriptiveLandmark(id: string, name: string, aliases: string[], description: string, extra: Partial<FieldLandmark> = {}): FieldLandmark {
