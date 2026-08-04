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
    name,
    waypoints: buildWaypoints([
      { x: 2.2, y: 4.0, theta: 0, segType: "bezier" },
      { x: 5.0, y: 4.0, theta: 0 },
    ]),
    targets: [],
    markers: [],
    ranges: [],
    constraints: clone(DEFAULT_CONSTRAINTS),
    headingMode: "targets",
    startVel: 0,
    goalVel: 0,
    exportable: true,
  };
}

export function createDemoProject(): BordeauxProject {
  return {
    schemaVersion: "1.0",
    name: "Untitled",
    robot: { drive: "swerve", w: 0.84, l: 0.84, maxSpeed: 5.0 },
    paths: [blankPath("NewPath")],
    routine: {
      name: "Autonomous Routine",
      nodes: [],
    },
  };
}
