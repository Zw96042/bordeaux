import { getPlanner } from "../planners";
import { clone } from "../project/defaults";
import type {
  BdxExport,
  BdxPath,
  BordeauxProject,
  ExportPreview,
  TrajectoryPlannerId,
  ValidationIssue,
} from "../types";
import { validateProject } from "../validation";

export interface BdxExportOptions {
  planner?: TrajectoryPlannerId;
  includeWarningsAsBlocking?: boolean;
}

function exportablePaths(project: BordeauxProject) {
  return project.paths.filter((path) => path.exportable !== false);
}

export function buildBdxExport(project: BordeauxProject, options: BdxExportOptions = {}): BdxExport {
  const validation = validateProject(project);
  if (!validation.ok) {
    throw new Error(validation.issues.map((x) => x.message).join("\n"));
  }

  const planner = getPlanner(options.planner ?? project.plannerId ?? "profiledSpline");
  const paths: BdxPath[] = exportablePaths(project).map((path) => {
    const result = planner.generate({ path, robot: project.robot });
    if (result.samples.length < 2) {
      throw new Error(`Path "${path.name}" generated fewer than two samples`);
    }
    const blockingDiagnostic = result.diagnostics.find((item) => item.severity === "error" || (options.includeWarningsAsBlocking && item.severity === "warning"));
    if (blockingDiagnostic) throw new Error(`${path.name}: ${blockingDiagnostic.message}`);
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
  assertFiniteValue(project.routine, "routine");

  return {
    schemaVersion: "1.1",
    generator: "bordeaux",
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
      maxSpeedMps: project.robot.maxSpeed,
    },
    paths,
    routine: project.routine ?? null,
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

export function previewBdxExport(project: BordeauxProject, options: BdxExportOptions = {}): ExportPreview {
  const issues: ValidationIssue[] = [];
  const validation = validateProject(project);
  issues.push(...validation.issues);
  return { ok: !hasBlocking, pathCount, sampleCount, totalTimeS, issues };
}
