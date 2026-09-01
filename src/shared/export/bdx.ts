import { getPlanner } from "../planners";
import { authoredPath, getAcceptedTrajectory } from "../planners/acceptedTrajectory";
import { isOptimizationOutdated } from "../planners/acceptedTrajectoryIdentity";
import { clone } from "../project/defaults";
import { activeRoutine } from "../project/routines";
import type {
  BdxExport,
  BdxPath,
  BordeauxProject,
} from "../types";
import { validateProject } from "../validation";
import { robotHardLimits } from "../robotLimits";

function exportablePaths(project: BordeauxProject) {
  return project.paths.filter((path) => path.exportable !== false);
}

export function buildBdxExport(project: BordeauxProject): BdxExport {
  const validation = validateProject(project);
  if (!validation.ok) {
    throw new Error(validation.issues.map((x) => x.message).join("\n"));
  }

  const paths: BdxPath[] = exportablePaths(project).map((path) => {
    const accepted = getAcceptedTrajectory(path, project.robot, project.field);
    if (path.optimization?.accepted && !accepted && !isOptimizationOutdated(path, project.robot, project.field)) {
      throw new Error(`${path.name}: The applied optimization is invalid. Choose Use normal or optimize and apply again before exporting.`);
    }
    const result = accepted ?? getPlanner("profiledSpline").generate({ path: authoredPath(path), robot: project.robot });
    if (result.samples.length < 2) {
      throw new Error(`Path "${path.name}" generated fewer than two samples`);
    }
    const blockingDiagnostic = result.diagnostics.find((item) => item.severity === "error");
    if (blockingDiagnostic) throw new Error(`${path.name}: ${blockingDiagnostic.message}`);
    if (result.optimization?.fallback) {
      throw new Error(`${path.name}: ${result.optimization.fallbackReason ?? "Trajectory optimization fell back"}`);
    }
    assertFinitePlannerResult(path.name, result);
    return {
      id: path.id,
      name: path.name,
      planner: result.planner,
      totalTimeS: result.totalTimeS,
      totalDistanceM: result.totalDistanceM,
      samples: result.samples,
      markers: result.markers,
      diagnostics: result.diagnostics,
      optimization: result.optimization,
    };
  });
  const routine = activeRoutine(project);
  assertFiniteValue(routine, "routine");

  const hardLimits = robotHardLimits(project.robot);
  return {
    schemaVersion: "1.1",
    generator: "bordeaux",
    field: clone(project.field),
    units: {
      distance: "meters",
      time: "seconds",
      angle: "radians",
      velocity: "meters_per_second",
      acceleration: "meters_per_second_squared",
    },
    robot: {
      drive: project.robot.drive,
      widthM: project.robot.w,
      lengthM: project.robot.l,
      ...(project.robot.heightM === undefined ? {} : { heightM: project.robot.heightM }),
      ...(project.robot.footprint === undefined ? {} : { footprint: clone(project.robot.footprint) }),
      maxSpeedMps: hardLimits?.maxSpeedMps ?? project.robot.maxSpeed,
    },
    paths,
    routine: routine ?? null,
  };
}

function assertFiniteValue(value: unknown, valuePath: string): void {
  const inspect = (value: unknown, valuePath: string): void => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${valuePath} is not finite`);
    if (Array.isArray(value)) value.forEach((item, index) => inspect(item, `${valuePath}[${index}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => inspect(item, `${valuePath}.${key}`));
  };
  inspect(value, valuePath);
}

function assertFinitePlannerResult(pathName: string, result: ReturnType<ReturnType<typeof getPlanner>["generate"]>): void {
  assertFiniteValue(result, `Path "${pathName}" planner output`);
}
