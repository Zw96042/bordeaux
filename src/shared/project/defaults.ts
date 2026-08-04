import { PM } from "../math/pm";
import { FIELD_H, FIELD_W, clampWorldPoint } from "../math/fieldBounds";
import type {
  BordeauxProject,
  LabviewPathOptions,
  PathConstraints,
  PathDoc,
  SegmentType,
  Waypoint,
} from "../types";

export { FIELD_H, FIELD_W, clampWorldPoint };

export const DEFAULT_CONSTRAINTS: PathConstraints = {
  maxVel: 4.2,
  maxAccel: 6.5,
  maxDecel: 6.5,
  maxAngVel: 540,
  maxAngAccel: 720,
  maxAngDecel: 720,
  maxJerk: 0,
  maxAngJerk: 0,
};

export const DEFAULT_LABVIEW_OPTIONS = {
  samplePeriodS: 0.02,
  minTurnRadiusM: 0.5,
  bezierTangentMode: "handles",
  reversePath: false,
  zeroVelocity: false,
  pickupBalls: false,
  currentLimit: 0,
  zeroTranslationalVelocity: false,
  correctAtBeginningOfPath: false,
} satisfies LabviewPathOptions;

export function createPathId(): string {
  return `path_${globalThis.crypto.randomUUID()}`;
}

export function createMarkerId(): string {
  return `event_${globalThis.crypto.randomUUID()}`;
}

type RawWaypoint = Partial<Waypoint> & {
  x: number;
  y: number;
  theta?: number;
  segType?: SegmentType;
};

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildWaypoints(raw: RawWaypoint[]): Waypoint[] {
  const out = raw.map((w) => ({
    linked: true,
    thetaOn: false,
    theta: 0,
    stop: false,
    ...w,
    ...clampWorldPoint(w),
  })) as Waypoint[];

  out.forEach((w, i) => {
    const handles = PM.autoHandles(out, i);
    w.prevC = w.prevC ?? handles.prevC;
    w.nextC = w.nextC ?? handles.nextC;
  });

  if (out.length) {
    out[0].thetaOn = true;
    out[out.length - 1].thetaOn = true;
  }

  return out;
}

export function blankPath(name = "NewPath"): PathDoc {
  return {
    id: createPathId(),
    name,
    waypoints: buildWaypoints([
      { x: 2.2, y: 4.0, theta: 0, segType: "bezier" },
      { x: 5.0, y: 4.0, theta: 0 },
    ]),
    targets: [],
