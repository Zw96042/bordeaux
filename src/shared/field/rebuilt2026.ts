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
  return { id, name, aliases, kind: "point", behavior: "interaction", navigable: false, description, ...extra };
}

export const REBUILT_2026_NEUTRAL_ZONE: FieldRect = {
  xMin: NEUTRAL_X_MIN,
  xMax: NEUTRAL_X_MAX,
  yMin: 0,
  yMax: REBUILT_2026_FIELD_WIDTH_M,
};

/** Approximate pre-MATCH FUEL corral from Game Manual section 6.3.4.1. */
export const REBUILT_2026_INITIAL_FUEL_REGION: FieldRect = {
  xMin: REBUILT_2026_FIELD_LENGTH_M / 2 - INITIAL_FUEL_DEPTH_M / 2,
  xMax: REBUILT_2026_FIELD_LENGTH_M / 2 + INITIAL_FUEL_DEPTH_M / 2,
  yMin: REBUILT_2026_FIELD_WIDTH_M / 2 - INITIAL_FUEL_WIDTH_M / 2,
  yMax: REBUILT_2026_FIELD_WIDTH_M / 2 + INITIAL_FUEL_WIDTH_M / 2,
};

const hubLandmarks = [
  obstacle("blue-hub", "Blue HUB", ["blue hub", "blue goal"], { xMin: BLUE_BARRIER_X, xMax: BLUE_STRUCTURE_X_MAX, yMin: HUB_Y_MIN, yMax: HUB_Y_MIN + HUB_WIDTH_M }),
  obstacle("red-hub", "Red HUB", ["red hub", "red goal"], { xMin: RED_STRUCTURE_X_MIN, xMax: RED_BARRIER_X, yMin: HUB_Y_MIN, yMax: HUB_Y_MIN + HUB_WIDTH_M }),
];

const aprilTagData = [
  [1, 11.8779798, 7.4247756, 0.889, 180], [2, 11.9154194, 4.63804, 1.12395, 90], [3, 11.3118646, 4.3902376, 1.12395, 180], [4, 11.3118646, 4.0346376, 1.12395, 180],
  [5, 11.9154194, 3.4312352, 1.12395, -90], [6, 11.8779798, 0.6444996, 0.889, 180], [7, 11.9528844, 0.6444996, 0.889, 0], [8, 12.2710194, 3.4312352, 1.12395, -90],
  [9, 12.5191774, 3.6790376, 1.12395, 0], [10, 12.5191774, 4.0346376, 1.12395, 0], [11, 12.2710194, 4.63804, 1.12395, 90], [12, 11.9528844, 7.4247756, 0.889, 0],
  [13, 16.5333172, 7.4033126, 0.55245, 180], [14, 16.5333172, 6.9715126, 0.55245, 180], [15, 16.5329616, 4.3235626, 0.55245, 180], [16, 16.5329616, 3.8917626, 0.55245, 180],
  [17, 4.6630844, 0.6444996, 0.889, 0], [18, 4.6256194, 3.4312352, 1.12395, -90], [19, 5.2291742, 3.6790376, 1.12395, 0], [20, 5.2291742, 4.0346376, 1.12395, 0],
  [21, 4.6256194, 4.63804, 1.12395, 90], [22, 4.6630844, 7.4247756, 0.889, 0], [23, 4.5881798, 7.4247756, 0.889, 180], [24, 4.2700194, 4.63804, 1.12395, 90],
  [25, 4.0218614, 4.3902376, 1.12395, 180], [26, 4.0218614, 4.0346376, 1.12395, 180], [27, 4.2700194, 3.4312352, 1.12395, -90], [28, 4.5881798, 0.6444996, 0.889, 180],
  [29, 0.007747, 0.6659626, 0.55245, 0], [30, 0.007747, 1.0977626, 0.55245, 0], [31, 0.0080772, 3.7457126, 0.55245, 0], [32, 0.0080772, 4.1775126, 0.55245, 0],
] as const;

function aprilTagAttachment(id: number): string {
  if ([1, 6, 7, 12, 17, 22, 23, 28].includes(id)) return "TRENCH";
  if ((id >= 2 && id <= 5) || (id >= 8 && id <= 11) || (id >= 18 && id <= 21) || (id >= 24 && id <= 27)) return "HUB";
  if ([13, 14, 29, 30].includes(id)) return "OUTPOST";
  return "TOWER WALL";
}

const aprilTagLandmarks: FieldLandmark[] = aprilTagData.map(([id, x, y, elevationM, headingDeg]) => ({
  id: `apriltag-${id}`,
  name: `AprilTag ${id}`,
  aliases: [`april tag ${id}`, `apriltag ${id}`, `tag ${id}`],
  kind: "point",
  behavior: "interaction",
  navigable: false,
  point: { x, y },
  elevationM,
  headingDeg,
  attachedTo: aprilTagAttachment(id),
  allianceOwner: id <= 16 ? "red" : "blue",
  description: "Official WPILib 2026 welded-field fiducial pose; the reported point is on the tag face, not a collision-free robot pose.",
}));

const landmarks: FieldLandmark[] = [
  regionLandmark("field-carpet", "FIELD carpet", ["field", "field carpet", "playing field"], { xMin: 0, xMax: REBUILT_2026_FIELD_LENGTH_M, yMin: 0, yMax: REBUILT_2026_FIELD_WIDTH_M }),
  regionLandmark("blue-alliance-zone", "Blue ALLIANCE ZONE", ["blue alliance zone", "blue side"], { xMin: 0, xMax: BLUE_BARRIER_X, yMin: 0, yMax: REBUILT_2026_FIELD_WIDTH_M }),
  regionLandmark("red-alliance-zone", "Red ALLIANCE ZONE", ["red alliance zone", "red side"], { xMin: RED_BARRIER_X, xMax: REBUILT_2026_FIELD_LENGTH_M, yMin: 0, yMax: REBUILT_2026_FIELD_WIDTH_M }),
  regionLandmark("neutral-zone", "NEUTRAL ZONE", ["neutral zone", "neutral"], REBUILT_2026_NEUTRAL_ZONE),
  regionLandmark("initial-fuel-region", "Initial NEUTRAL ZONE FUEL region", ["initial fuel region", "fuel staging region", "neutral fuel band", "starting fuel cloud"], REBUILT_2026_INITIAL_FUEL_REGION),
  lineLandmark("center-line", "CENTER LINE", ["center line", "midfield", "middle of the field"], { x: REBUILT_2026_FIELD_LENGTH_M / 2, y: 0 }, { x: REBUILT_2026_FIELD_LENGTH_M / 2, y: REBUILT_2026_FIELD_WIDTH_M }),
  lineLandmark("blue-robot-starting-line", "Blue ROBOT STARTING LINE", ["blue starting line", "blue alliance line"], { x: BLUE_BARRIER_X, y: 0 }, { x: BLUE_BARRIER_X, y: REBUILT_2026_FIELD_WIDTH_M }, "blue"),
  lineLandmark("red-robot-starting-line", "Red ROBOT STARTING LINE", ["red starting line", "red alliance line"], { x: RED_BARRIER_X, y: 0 }, { x: RED_BARRIER_X, y: REBUILT_2026_FIELD_WIDTH_M }, "red"),
  lineLandmark("scoring-table-guardrail", "Scoring-table guardrail", ["scoring table side", "table guardrail", "table side"], { x: 0, y: 0 }, { x: REBUILT_2026_FIELD_LENGTH_M, y: 0 }),
  lineLandmark("away-guardrail", "Non-scoring-table guardrail", ["non scoring table side", "away guardrail", "away side"], { x: 0, y: REBUILT_2026_FIELD_WIDTH_M }, { x: REBUILT_2026_FIELD_LENGTH_M, y: REBUILT_2026_FIELD_WIDTH_M }),
  lineLandmark("blue-alliance-wall", "Blue ALLIANCE WALL", ["blue wall", "blue driver wall"], { x: 0, y: 0 }, { x: 0, y: REBUILT_2026_FIELD_WIDTH_M }, "blue"),
  lineLandmark("red-alliance-wall", "Red ALLIANCE WALL", ["red wall", "red driver wall"], { x: REBUILT_2026_FIELD_LENGTH_M, y: 0 }, { x: REBUILT_2026_FIELD_LENGTH_M, y: REBUILT_2026_FIELD_WIDTH_M }, "red"),
  descriptiveLandmark("alliance-area", "ALLIANCE AREA", ["alliance area"], "Off-field 360 in by 134 in drive-team area. It is official vocabulary but never a robot drive target.", { dimensionsM: { width: 360 * 0.0254, depth: 134 * 0.0254 } }),
  descriptiveLandmark("outpost-area", "OUTPOST AREA", ["outpost area"], "Off-field 71 in by 134 in HUMAN PLAYER area. It is official vocabulary but never a robot drive target.", { dimensionsM: { width: 71 * 0.0254, depth: 134 * 0.0254 } }),
  descriptiveLandmark("human-starting-line", "HUMAN STARTING LINE", ["human starting line"], "Off-field white line 24 in from the ALLIANCE WALL bottom tube. It is not a robot navigation line."),
  pointLandmark("blue-trench-table", "Blue scoring-table-side TRENCH", ["blue table trench", "blue right trench"], { x: BLUE_BARRIER_X, y: TRENCH_TABLE_Y }, "blue", "trench", "right"),
  pointLandmark("blue-trench-away", "Blue non-scoring-table-side TRENCH", ["blue away trench", "blue left trench"], { x: BLUE_BARRIER_X, y: TRENCH_AWAY_Y }, "blue", "trench", "left"),
  pointLandmark("red-trench-table", "Red scoring-table-side TRENCH", ["red table trench", "red left trench"], { x: RED_BARRIER_X, y: TRENCH_TABLE_Y }, "red", "trench", "left"),
  pointLandmark("red-trench-away", "Red non-scoring-table-side TRENCH", ["red away trench", "red right trench"], { x: RED_BARRIER_X, y: TRENCH_AWAY_Y }, "red", "trench", "right"),
  pointLandmark("blue-bump-table", "Blue scoring-table-side BUMP", ["blue table bump", "blue right bump"], { x: BLUE_BARRIER_X, y: BUMP_TABLE_Y }, "blue", "bump", "right"),
  pointLandmark("blue-bump-away", "Blue non-scoring-table-side BUMP", ["blue away bump", "blue left bump"], { x: BLUE_BARRIER_X, y: BUMP_AWAY_Y }, "blue", "bump", "left"),
  pointLandmark("red-bump-table", "Red scoring-table-side BUMP", ["red table bump", "red left bump"], { x: RED_BARRIER_X, y: BUMP_TABLE_Y }, "red", "bump", "left"),
  pointLandmark("red-bump-away", "Red non-scoring-table-side BUMP", ["red away bump", "red right bump"], { x: RED_BARRIER_X, y: BUMP_AWAY_Y }, "red", "bump", "right"),
  { id: "blue-tower-base", name: "Blue TOWER BASE", aliases: ["blue tower", "blue tower base", "blue climb zone"], kind: "region", bounds: { xMin: 0, xMax: 1.147572, yMin: 3.5392, yMax: 4.5298 }, allianceOwner: "blue", behavior: "climbable" },
  { id: "red-tower-base", name: "Red TOWER BASE", aliases: ["red tower", "red tower base", "red climb zone"], kind: "region", bounds: { xMin: REBUILT_2026_FIELD_LENGTH_M - 1.147572, xMax: REBUILT_2026_FIELD_LENGTH_M, yMin: 3.5392, yMax: 4.5298 }, allianceOwner: "red", behavior: "climbable" },
  ...(["blue", "red"] as const).flatMap((alliance) => [
    descriptiveLandmark(`${alliance}-tower-low-rung`, `${alliance} TOWER LOW RUNG`, [`${alliance} low rung`], "Climbing rung center 27 in above the carpet.", { allianceOwner: alliance, elevationM: 27 * 0.0254, dimensionsM: { diameter: 1.66 * 0.0254 } }),
    descriptiveLandmark(`${alliance}-tower-mid-rung`, `${alliance} TOWER MID RUNG`, [`${alliance} mid rung`], "Climbing rung center 45 in above the carpet.", { allianceOwner: alliance, elevationM: 45 * 0.0254, dimensionsM: { diameter: 1.66 * 0.0254 } }),
    descriptiveLandmark(`${alliance}-tower-high-rung`, `${alliance} TOWER HIGH RUNG`, [`${alliance} high rung`], "Climbing rung center 63 in above the carpet.", { allianceOwner: alliance, elevationM: 63 * 0.0254, dimensionsM: { diameter: 1.66 * 0.0254 } }),
    descriptiveLandmark(`${alliance}-outpost-chute`, `${alliance} OUTPOST CHUTE`, [`${alliance} chute`], "15-degree HUMAN PLAYER chute feeding the upper OUTPOST opening; not a robot drive target.", { allianceOwner: alliance, dimensionsM: { width: 31.8 * 0.0254, height: 7 * 0.0254 } }),
    descriptiveLandmark(`${alliance}-outpost-corral`, `${alliance} OUTPOST CORRAL`, [`${alliance} corral`], "Lower OUTPOST opening where ROBOTS return FUEL; use the adjacent AprilTag poses for perception, not this label as a drive coordinate.", { allianceOwner: alliance, dimensionsM: { width: 32 * 0.0254, height: 7 * 0.0254 } }),
    descriptiveLandmark(`${alliance}-depot`, `${alliance} DEPOT`, [`${alliance} depot`], "42 in wide by 27 in deep FUEL staging structure along the ALLIANCE WALL. Its 3 in wide steel barriers are solid; exact barrier polygons are intentionally not inferred from a center point.", { allianceOwner: alliance, dimensionsM: { width: 42 * 0.0254, depth: 27 * 0.0254, height: 1.125 * 0.0254 } }),
    ...([1, 2, 3] as const).map((station) => descriptiveLandmark(`${alliance}-driver-station-${station}`, `${alliance} DRIVER STATION ${station}`, [`${alliance} driver station ${station}`, `${alliance} ds ${station}`], "One of three off-field DRIVE TEAM stations in the ALLIANCE WALL; not a robot drive target.", { allianceOwner: alliance, dimensionsM: { height: (36.8 + 42) * 0.0254 } })),
