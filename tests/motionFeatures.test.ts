import { describe, expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { PM } from "../src/shared/math/pm";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { TrajectoryPlannerId } from "../src/shared/types";
import { validateProject } from "../src/shared/validation";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import { buildLabviewBdx } from "../src/shared/export/labviewBdx";
import { parseLabviewBdx } from "../src/shared/export/labviewBdxReader";
import { applyRotationPriority } from "../src/shared/planners/rotationPriority";
import {
  headingTransitionGoals,
  headingTransitionWindows,
  smoothHeadingTransitions,
} from "../src/shared/planners/headingTransitions";
import type { PlannerResult } from "../src/shared/types";

const PLANNERS: TrajectoryPlannerId[] = ["profiledSpline", "optimizedTrajectory", "labviewBezier", "labviewClothoid"];

function interiorTurnProject() {
  const project = createDemoProject();
  const path = project.paths[0];
  path.headingMode = "tangent";
  path.waypoints = buildWaypoints([
    { x: 2, y: 2, theta: 0, thetaOn: true, segType: "line" },
    {
      x: 4,
      y: 2,
      theta: 90,
      thetaOn: true,
      stop: true,
      wait: 0.12,
      segType: "line",
      segmentHeadingMode: "manual",
      turnInPlace: { headingDeg: 90, direction: "counterclockwise" },
    },
    { x: 6, y: 2, theta: 90, thetaOn: true },
  ]);
  return project;
}

describe("motion features", () => {
  it("acquires the first real target monotonically when Targets becomes active", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({ s: index * 0.25 }));
    const waypoints = buildWaypoints([
      { x: 6, y: 5, theta: 0, segmentHeadingMode: "tangent" },
      {
        x: 3, y: 5, theta: 0, segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.75 },
      },
      { x: 0, y: 5, theta: 0 },
    ]);
    const raw = points.map((point) => {
      if (point.s <= 3) return Math.PI;
      if (point.s <= 4.5) return (-45 * (point.s / 4.5)) * Math.PI / 180;
      return (-45 + 45 * ((point.s - 4.5) / 1.5)) * Math.PI / 180;
    });
    const goals = headingTransitionGoals(
      ["tangent", "targets"],
      [false, false],
      [0, 12, 24],
      points,
      {
        manual: [{ f: 0, heading: 0 }, { f: 1, heading: 0 }],
        targets: [{ f: 0, heading: 0 }, { f: 0.75, heading: -Math.PI / 4 }, { f: 1, heading: 0 }],
      },
    );
    for (const placement of ["before", "split", "after"] as const) {
      waypoints[1].headingTransition!.placement = placement;
      const headings = smoothHeadingTransitions(raw, ["tangent", "targets"], [false, false], [0, 12, 24], points, waypoints, goals);
      const throughTarget = headings.slice(9, 19);
      for (let index = 1; index < throughTarget.length; index += 1) {
        expect(throughTarget[index]).toBeGreaterThanOrEqual(throughTarget[index - 1] - 1e-10);
      }
      expect(throughTarget.at(-1)).toBeCloseTo(7 * Math.PI / 4, 8);
    }
  });

  it("honors a target on the mode boundary and protects it from a later blend", () => {
    const points = Array.from({ length: 37 }, (_, index) => ({ s: index * 0.25 }));
    const waypoints = buildWaypoints([
      { x: 9, y: 5, theta: 0, segmentHeadingMode: "tangent" },
      {
        x: 6, y: 5, theta: 0, segmentHeadingMode: "targets",
        headingTransition: { placement: "after", rotationPriority: "heading", distanceM: 0.75 },
      },
      {
        x: 3, y: 5, theta: -45, thetaOn: true, segmentHeadingMode: "tangent",
        headingTransition: { placement: "before", rotationPriority: "heading", distanceM: 0.75 },
      },
