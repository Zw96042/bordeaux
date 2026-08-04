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
    schemaVersion: "1.0",
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
      maxSpeedMps: project.robot.maxSpeed,
    },
    paths,
  };
}

export function previewBdxExport(project: BordeauxProject, options: BdxExportOptions = {}): ExportPreview {
  const issues: ValidationIssue[] = [];
  const validation = validateProject(project);
  issues.push(...validation.issues);

  let pathCount = 0;
  let sampleCount = 0;
  let totalTimeS = 0;

  if (validation.ok) {
    try {
      const exportData = buildBdxExport(project, options);
      pathCount = exportData.paths.length;
      sampleCount = exportData.paths.reduce((sum, path) => sum + path.samples.length, 0);
      totalTimeS = Number(exportData.paths.reduce((sum, path) => sum + path.totalTimeS, 0).toFixed(4));
      for (const path of exportData.paths) issues.push(...path.diagnostics);
    } catch (error) {
      issues.push({
        severity: "error",
        path: "$.export",
        message: error instanceof Error ? error.message : "Failed to build export",
      });
    }
  }

  const hasBlocking = issues.some((issue) => issue.severity === "error" || (options.includeWarningsAsBlocking && issue.severity === "warning"));
  return { ok: !hasBlocking, pathCount, sampleCount, totalTimeS, issues };
}
