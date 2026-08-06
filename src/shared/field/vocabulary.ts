import { FIELD_H, FIELD_W } from "../math/fieldBounds";
import {
  appToAllianceViewPoint,
  appToOfficialPoint,
  officialToAppPoint,
  REBUILT_2026_CROSSINGS,
  REBUILT_2026_FIELD,
  REBUILT_2026_FIELD_LENGTH_M,
  REBUILT_2026_FIELD_WIDTH_M,
  REBUILT_2026_INITIAL_FUEL_REGION,
  REBUILT_2026_NEUTRAL_ZONE,
  REBUILT_2026_TRENCH_CLEARANCE_M,
} from "./rebuilt2026";
import type { ProjectStrategyOverlay } from "../types";
import type { FieldPoint, ResolveFieldTermOptions, ResolvedFieldTerm } from "./types";

function normalized(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveStrategyTerm(rawPhrase: string, strategy?: ProjectStrategyOverlay): ResolvedFieldTerm | null {
  const phrase = normalized(rawPhrase);
  const matches = (strategy?.locations ?? []).filter((location) => [location.name, ...(location.aliases ?? [])].some((term) => normalized(term) === phrase)).map((location) => {
    const point = location.kind === "pose" ? { x: location.x, y: location.y } : {
      x: (location.bounds.xMin + location.bounds.xMax) / 2,
      y: (location.bounds.yMin + location.bounds.yMax) / 2,
    };
    return {
      id: location.id,
      label: location.name,
      point,
      confidence: 1,
      reason: location.kind === "pose" ? "Exact team strategy pose." : "Center of the exact team strategy region.",
      ...(location.headingDeg === undefined ? {} : { headingDeg: location.headingDeg }),
    };
  });
  if (matches.length === 0) return null;
  return {
    phrase: rawPhrase,
    status: matches.length === 1 ? "resolved" : "ambiguous",
    matches,
    ...(matches.length === 1 ? {} : { message: `Team strategy term “${rawPhrase}” matches more than one location.` }),
  };
}

function relativePoint(direction: "front" | "back" | "left" | "right", options: ResolveFieldTermOptions): ResolvedFieldTerm {
  if (!options.pose) {
    return {
      phrase: direction,
      status: "unresolved",
      matches: [],
      message: `“${direction} of the bot” needs a specific robot pose or trajectory sample.`,
    };
  }
  if (!Number.isFinite(options.pose.x) || !Number.isFinite(options.pose.y) || options.pose.x < 0 || options.pose.x > FIELD_W || options.pose.y < 0 || options.pose.y > FIELD_H) {
    return { phrase: direction, status: "unresolved", matches: [], message: "Robot-relative vocabulary requires a finite pose inside the Bordeaux field bounds." };
  }
  const distance = Math.max(0.01, Math.min(5, options.relativeDistanceM ?? 0.5));
  const offset = direction === "front" ? 0
    : direction === "back" ? Math.PI
      : direction === "left" ? Math.PI / 2
        : -Math.PI / 2;
  const physicalHeadingRad = options.pose.headingSource === "physical"
    ? options.pose.physicalHeadingRad
    : options.pose.authoredHeadingRad + (options.pose.driveBackward ? Math.PI : 0);
  const angle = physicalHeadingRad + offset;
  const point = {
    x: options.pose.x + Math.cos(angle) * distance,
    y: options.pose.y + Math.sin(angle) * distance,
  };
  if (point.x < 0 || point.x > FIELD_W || point.y < 0 || point.y > FIELD_H) {
    return { phrase: direction, status: "unresolved", matches: [], message: `The requested point ${distance.toFixed(2)} m ${direction} of the robot is outside the field; Bordeaux will not shorten or clamp it.` };
  }
  return {
    phrase: direction,
    status: "resolved",
    matches: [{
      id: `robot-${direction}`,
      label: `${direction} of the robot`,
      point,
      confidence: 1,
      reason: `Resolved ${distance.toFixed(2)} m in the physical chassis ${direction} direction.`,
    }],
  };
}

function hasAny(phrase: string, values: string[]): boolean {
  return values.some((value) => phrase.includes(value));
}

