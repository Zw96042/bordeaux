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

function phraseAlliance(phrase: string): "blue" | "red" | undefined {
  const blue = /(?:^| )blue(?: |$)/.test(phrase);
  const red = /(?:^| )red(?: |$)/.test(phrase);
  return blue === red ? undefined : blue ? "blue" : "red";
}

function requestedAlliance(rawPhrase: string, phrase: string, options: ResolveFieldTermOptions): { alliance?: "blue" | "red"; error?: ResolvedFieldTerm } {
  const explicit = phraseAlliance(phrase);
  if (explicit && options.alliance && explicit !== options.alliance) {
    return { error: { phrase: rawPhrase, status: "unresolved", matches: [], message: `“${rawPhrase}” names the ${explicit} field structure but the request alliance is ${options.alliance}; Bordeaux will not silently substitute the opposite alliance.` } };
  }
  return { alliance: explicit ?? options.alliance ?? options.defaultAlliance };
}

export function withAllianceView(result: ResolvedFieldTerm, allianceView: "blue" | "red"): ResolvedFieldTerm {
  return { ...result, matches: result.matches.map((match) => ({ ...match, displayPoint: appToAllianceViewPoint(match.point, allianceView) })) };
}

function allianceOfficialPoint(alliance: "blue" | "red", bluePoint: FieldPoint): FieldPoint {
  return alliance === "blue" ? bluePoint : {
    x: REBUILT_2026_FIELD_LENGTH_M - bluePoint.x,
    // Near/far is longitudinal. Preserve the caller's physical guardrail lane;
    // rotating Y here silently moved red routes to the opposite side.
    y: bluePoint.y,
  };
}

function fieldMatch(id: string, label: string, officialPoint: FieldPoint, reason: string) {
  return { id, label, officialPoint, point: officialToAppPoint(officialPoint), confidence: 1, reason };
}

export function resolveFieldTerm(rawPhrase: string, options: ResolveFieldTermOptions = {}): ResolvedFieldTerm {
  const phrase = normalized(rawPhrase);
  const robotDirection = hasAny(phrase, ["front of bot", "front of robot", "in front of bot", "in front of robot", "ahead of bot", "ahead of robot"])
    ? "front"
    : hasAny(phrase, ["back of bot", "back of robot", "behind bot", "behind robot", "rear of bot", "rear of robot"])
      ? "back"
      : hasAny(phrase, ["left of bot", "left of robot", "bot left", "robot left"])
        ? "left"
        : hasAny(phrase, ["right of bot", "right of robot", "bot right", "robot right"])
          ? "right"
          : null;
  if (robotDirection) return { ...relativePoint(robotDirection, options), phrase: rawPhrase };

  if (phrase.includes("center line") || phrase === "midfield" || phrase === "middle of the field") {
    return {
      phrase: rawPhrase,
      status: "resolved",
      matches: [fieldMatch("center-line", "CENTER LINE", {
        x: REBUILT_2026_FIELD_LENGTH_M / 2,
        y: options.pose ? appToOfficialPoint(options.pose).y : REBUILT_2026_FIELD_WIDTH_M / 2,
      }, "Official CENTER LINE landmark, transformed into Bordeaux coordinates.")],
    };
  }

  const initialFuelBand = phrase.includes("fuel") && hasAny(phrase, ["band", "cloud", "staging", "starting", "initial"]);
  if (initialFuelBand && hasAny(phrase, ["far side", "far edge", "opposite side", "other side"])) {
    const requested = requestedAlliance(rawPhrase, phrase, options);
    if (requested.error) return requested.error;
    if (!requested.alliance) return { phrase: rawPhrase, status: "unresolved", matches: [], message: "The far side of the initial FUEL band needs an alliance context." };
    const bluePoint = { x: REBUILT_2026_INITIAL_FUEL_REGION.xMax, y: options.pose ? appToOfficialPoint(options.pose).y : REBUILT_2026_FIELD_WIDTH_M / 2 };
    const officialPoint = allianceOfficialPoint(requested.alliance, bluePoint);
    return {
      phrase: rawPhrase,
      status: "resolved",
      matches: [fieldMatch(`${requested.alliance}-initial-fuel-far-edge`, `Far edge of the initial FUEL band for ${requested.alliance}`, officialPoint, "Resolved to the far edge of the official approximately 72-inch-deep starting FUEL corral, not the far edge of the full NEUTRAL ZONE.")],
    };
  }

  if (initialFuelBand && hasAny(phrase, ["near side", "near edge", "our side"])) {
    const requested = requestedAlliance(rawPhrase, phrase, options);
    if (requested.error) return requested.error;
    if (!requested.alliance) return { phrase: rawPhrase, status: "unresolved", matches: [], message: "The near side of the initial FUEL band needs an alliance context." };
    const bluePoint = { x: REBUILT_2026_INITIAL_FUEL_REGION.xMin, y: options.pose ? appToOfficialPoint(options.pose).y : REBUILT_2026_FIELD_WIDTH_M / 2 };
    const officialPoint = allianceOfficialPoint(requested.alliance, bluePoint);
    return {
      phrase: rawPhrase,
      status: "resolved",
      matches: [fieldMatch(`${requested.alliance}-initial-fuel-near-edge`, `Near edge of the initial FUEL band for ${requested.alliance}`, officialPoint, "Resolved to the near edge of the official approximately 72-inch-deep starting FUEL corral.")],
    };
  }

  if (phrase.includes("neutral") && hasAny(phrase, ["far side", "far edge", "opposite side", "other side"])) {
    const requested = requestedAlliance(rawPhrase, phrase, options);
    if (requested.error) return requested.error;
    if (!requested.alliance) return { phrase: rawPhrase, status: "unresolved", matches: [], message: "The far side of the NEUTRAL ZONE needs an alliance context." };
    const bluePoint = { x: REBUILT_2026_NEUTRAL_ZONE.xMax, y: options.pose ? appToOfficialPoint(options.pose).y : REBUILT_2026_FIELD_WIDTH_M / 2 };
    const officialPoint = allianceOfficialPoint(requested.alliance, bluePoint);
    return {
      phrase: rawPhrase,
