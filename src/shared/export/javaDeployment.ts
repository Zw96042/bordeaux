  if (scope.kind === "routine" && paths.length === 0) {
    if (!baseline) throw new Error("Push a path first, then push this routine. The robot runtime requires at least one deployed path, and this routine has no static path dependencies.");
    // A routine-only selection changes no motion. Validate against the verified
    // retained document instead of generating a placeholder or replanning local drafts.
    const document = { ...baseline, routine: { name: routine!.name, nodes: structuredClone(routine!.nodes) } };
    validateDocument(document, project, catalog);
    return { built: { document: { ...document, paths: [] } }, selectedNames: [routine!.name], dependencyNames: [] };
  }

  const planningRoutine = routine ?? { id: "deployment-empty", name: "Paths only", nodes: [] };
  const scopedProject: BordeauxProject = {
    ...project,
    paths: paths.map(({ folderId: _folder, ...path }) => path),
    pathFolders: undefined,
    routines: [planningRoutine],
    activeRoutineId: planningRoutine.id,
    pathLinks: project.pathLinks.filter((link) => pathIds.has(link.fromPathId) && pathIds.has(link.toPathId)),
    editor: undefined, strategy: undefined,
  };
  const built = buildJavaTrajectory(scopedProject, catalog);
  if (!routine) built.document.routine = null;
  return {
    built,
    selectedNames: scope.kind === "paths" ? scope.pathIds.map((id) => paths.find((path) => path.id === id)!.name) : routine ? [routine.name] : [],
    dependencyNames: scope.kind === "routine" ? paths.map((path) => path.name) : [],
  };
}

export function buildJavaDeployment(project: BordeauxProject, catalog: JavaCommandCatalog, requestedScope: RobotPushScope, baselineContents: string | null): BuiltJavaDeployment {
  const scope = parseScope(requestedScope);
  if (baselineContents !== null && typeof baselineContents !== "string") throw new Error("Robot baseline must be verified contents or null for an empty robot");
  const baseline = baselineContents === null ? null : parseBaseline(baselineContents);
  if (baseline && scope.kind !== "project") {
    compatible(baseline, project, catalog);
    validateDocument(baseline, project, catalog);
  }
  const { built, selectedNames, dependencyNames } = compileSelection(project, catalog, scope, true, baseline);
  if (baseline && scope.kind !== "project" && stable(baseline.robot) !== stable(built.document.robot)) throw new Error("Exported robot configuration differs; review a full-project replacement.");
  const replacements = new Map(built.document.paths.map((path) => [path.id, path]));
  const preserve = scope.kind !== "project" && baseline;
  const paths = preserve ? baseline.paths.map((path) => replacements.get(path.id) ?? path).concat(built.document.paths.filter((path) => !baseline.paths.some((old) => old.id === path.id))) : built.document.paths;
  const document: DeploymentDocument = { ...built.document, deploymentContext: context(project), paths,
    routine: scope.kind === "paths" ? baseline?.routine ?? null : built.document.routine };
  validateDocument(document, project, catalog);
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_BYTES) throw new Error("Java trajectory export exceeds 16777216 bytes");
  const oldIds = new Set(baseline?.paths.map((path) => path.id));
  return {
    trajectory: {
      document, contents,
      sha256: createHash("sha256").update(contents).digest("hex"),
      pathCount: paths.length,
      sampleCount: paths.reduce((sum, path) => sum + path.samples.length, 0),
      eventCount: paths.reduce((sum, path) => sum + path.events.length, 0),
    },
    summary: {
      kind: scope.kind, selectedNames, pathIds: [...replacements.keys()],
      addedNames: built.document.paths.filter((path) => !oldIds.has(path.id)).map((path) => path.name),
      updatedNames: built.document.paths.filter((path) => oldIds.has(path.id)).map((path) => path.name),
      preservedPathCount: preserve ? baseline.paths.filter((path) => !replacements.has(path.id)).length : 0,
      previousRoutine: baseline?.routine?.name ?? null,
      routine: document.routine?.name ?? null,
      dependencyNames,
    },
  };
}

export function compareJavaDeployment(project: BordeauxProject, catalog: JavaCommandCatalog, baselineContents: string | null): JavaDeploymentComparison {
  const result: JavaDeploymentComparison = { paths: {}, routines: {} };
  let baseline: DeploymentDocument | null;
  try {
    baseline = baselineContents === null ? null : parseBaseline(baselineContents);
    if (baseline) {
      compatible(baseline, project, catalog);
      validateDocument(baseline, project, catalog);
    }
  } catch (error) {
    const status: JavaDeploymentItemStatus = { state: "unknown", message: error instanceof Error ? error.message : String(error) };
    project.paths.forEach((path) => { result.paths[path.id] = status; });
    project.routines.forEach((routine) => { result.routines[routine.id] = status; });
    return result;
  }
  const compare = (scope: RobotPushScope): JavaDeploymentItemStatus => {
    try {
      const { built } = compileSelection(project, catalog, scope, false, baseline);
      if (!baseline) return { state: "missing" };
      if (stable(baseline.robot) !== stable(built.document.robot)) return { state: "unknown", message: "Exported robot configuration differs; review a full-project replacement." };
      const allPathsMatch = built.document.paths.every((path) => stable(path) === stable(baseline.paths.find((old) => old.id === path.id)));
      if (scope.kind === "paths") return { state: !baseline.paths.some((path) => path.id === scope.pathIds[0]) ? "missing" : allPathsMatch ? "matches" : "changed" };
      // This proves content equivalence, never an identity inferred from the name.
      return { state: !baseline.routine ? "missing" : allPathsMatch && stable(built.document.routine?.nodes) === stable(baseline.routine.nodes) ? "matches" : "changed" };
    } catch (error) { return { state: "invalid", message: error instanceof Error ? error.message : String(error) }; }
  };
  project.paths.forEach((path) => { result.paths[path.id] = compare({ kind: "paths", pathIds: [path.id] }); });
  project.routines.forEach((routine) => { result.routines[routine.id] = compare({ kind: "routine", routineId: routine.id }); });
  return result;
}
