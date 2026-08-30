  previousRoutine: string | null;
  routine: string | null;
  dependencyNames: string[];
}
export interface BuiltJavaDeployment { trajectory: BuiltJavaTrajectory; summary: JavaDeploymentSummary }
export interface JavaDeploymentItemStatus {
  state: "matches" | "changed" | "missing" | "invalid" | "unknown";
  message?: string;
}
export interface JavaDeploymentComparison {
  paths: Record<string, JavaDeploymentItemStatus>;
  routines: Record<string, JavaDeploymentItemStatus>;
}

const MAX_BYTES = 16 * 1024 * 1024;
const text = z.string().refine((value) => value.trim().length > 0, "A non-empty string is required");
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const integer = z.number().int().nonnegative();
const fraction = finite.min(0).max(1);
const argumentsSchema = z.record(z.string(), z.json());
const invocation = z.object({ commandId: text, arguments: argumentsSchema, cancelOnPathEnd: z.boolean().optional() }).strict();
const pathNode = z.object({ id: text, type: z.literal("path"), ref: text }).strict();
const commandNode = z.object({ id: text, type: z.literal("function"), cat: z.literal("command"), title: z.string().optional(), invocation }).strict();
const waitNode = z.object({ id: text, type: z.literal("builtin"), builtinId: z.literal("bordeaux.wait"), arguments: z.object({ durationS: finite.min(0.02).max(15) }).strict() }).strict();
const decisionFields = { id: text, type: z.literal("decision"), cond: text, thenLabel: z.string(), elseLabel: z.string() };
const fallbackNodeSchema: z.ZodType<RoutineFallbackNode> = z.lazy(() => z.union([
  pathNode, commandNode, waitNode,
  z.object({ ...decisionFields, then: z.array(fallbackNodeSchema), else: z.array(fallbackNodeSchema) }).strict(),
]));
const nodeSchema: z.ZodType<RoutineNode> = z.lazy(() => z.union([
  pathNode, commandNode, waitNode,
  z.object({ ...decisionFields, then: z.array(nodeSchema), else: z.array(nodeSchema) }).strict(),
  z.object({
    id: text, type: z.literal("generatedTrajectory"), generatorId: text, arguments: argumentsSchema,
    fallback: z.union([
      z.object({ type: z.literal("safeStop") }).strict(),
      z.object({ type: z.literal("branch"), nodes: z.array(fallbackNodeSchema) }).strict(),
    ]),
  }).strict(),
]));
const documentSchema = z.object({
  schemaVersion: z.literal("bordeaux-trajectory/1.0"), generator: z.literal("bordeaux"),
  catalog: z.object({ schemaVersion: z.enum(["1.0", "1.1", "1.2", "1.3"]), catalogId: text, supportVersion: text, catalogHash: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
  field: z.object({ id: text, revision: text, coordinateSchemaId: text }).strict(),
  units: z.object({ distance: z.literal("meters"), time: z.literal("seconds"), angle: z.literal("radians"), velocity: z.literal("meters_per_second"), acceleration: z.literal("meters_per_second_squared") }).strict(),
  robot: z.object({ drive: z.enum(["swerve", "tank"]), widthM: finite.positive(), lengthM: finite.positive(), heightM: finite.positive().optional(), maxSpeedMps: finite.positive(), footprint: z.object({ kind: z.literal("polygon"), verticesM: z.array(z.object({ x: finite, y: finite }).strict()) }).strict().optional() }).strict(),
  deploymentContext: z.object({ version: z.literal(1), robotSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict().optional(),
  routine: z.object({ name: text, nodes: z.array(nodeSchema) }).strict().nullable(),
  paths: z.array(z.object({ id: text, name: text, planner: text, totalTimeS: nonnegative, totalDistanceM: nonnegative,
    samples: z.array(z.object({ i: integer, t: nonnegative, s: nonnegative, f: fraction, x: finite, y: finite, headingRad: finite, velocityMps: finite, accelerationMps2: finite, angularVelocityRadps: finite, curvatureInvM: finite }).strict()).min(2).max(100_000),
    followSections: z.array(z.object({ segmentIndex: integer, mode: z.enum(["time", "position"]), startSample: integer, endSample: integer }).strict()).min(1),
    events: z.array(z.object({ eventId: text, name: text, timeS: nonnegative, fraction, commandId: text, arguments: argumentsSchema, cancelOnPathEnd: z.boolean(), trigger: z.enum(["time", "position"]), repeatEveryS: finite.positive().optional(), endTimeS: nonnegative.optional(), conditionId: text.optional() }).strict()).max(2_000),
  }).strict()).min(1).max(64),
}).strict();
type DeploymentDocument = JavaTrajectoryDocument & { deploymentContext?: { version: 1; robotSha256: string } };

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
function context(project: BordeauxProject): NonNullable<DeploymentDocument["deploymentContext"]> {
  const { planning: _planning, footprintPreset: _preset, ...robot } = project.robot;
  return { version: 1, robotSha256: createHash("sha256").update(stable(robot)).digest("hex") };
}

function parseBaseline(contents: string): DeploymentDocument {
  if (typeof contents !== "string" || Buffer.byteLength(contents, "utf8") > MAX_BYTES) throw new Error("Robot baseline is invalid or exceeds 16777216 bytes; refresh or replace the full project.");
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error("Robot baseline is not valid JSON; refresh or replace the full project."); }
  // JSON.parse accepts duplicate keys. Reject those and excessive nesting before
  // recursive schema validation, matching the robot's bounded JSON reader.
  const frames: Array<Set<string> | null> = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:]/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(contents))) {
    const current = token[0];
    if (current === "{" || current === "[") {
      frames.push(current === "{" ? new Set() : null);
      if (frames.length > 40) throw new Error("Robot baseline exceeds 40 nesting levels");
    } else if (current === "}" || current === "]") frames.pop();
    else if (current.startsWith('"') && /^\s*:/.test(contents.slice(tokens.lastIndex))) {
      const key: string = JSON.parse(current);
      const keys = frames.at(-1);
      if (keys?.has(key)) throw new Error(`Robot baseline has duplicate JSON key ${key}`);
      keys?.add(key);
    }
  }
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Robot baseline is invalid: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`);
  return parsed.data;
}

function visitNodes(nodes: RoutineNode[], visit: (node: RoutineNode) => void, depth = 0, count = { value: 0 }): void {
  if (!Array.isArray(nodes) || depth > 16) throw new Error("Routine branches must be arrays with at most 16 nesting levels");
  for (const node of nodes) {
    if (++count.value > 2_000) throw new Error("Java trajectory export exceeds 2000 routine nodes");
    if (!node || typeof node !== "object") throw new Error("Routine contains a malformed step");
    visit(node);
    if (node.type === "decision") { visitNodes(node.then, visit, depth + 1, count); visitNodes(node.else, visit, depth + 1, count); }
    if (node.type === "generatedTrajectory" && node.fallback?.type === "branch") visitNodes(node.fallback.nodes, visit, depth + 1, count);
  }
}
function unique(items: Array<{ id: string; name: string }>, kind: string): void {
  const ids = new Set<string>(); const names = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) throw new Error(`${kind} IDs must be present and unique`);
    if (typeof item.name !== "string" || !item.name.trim() || names.has(item.name)) throw new Error(`${kind} names must be present and unique`);
    ids.add(item.id); names.add(item.name);
  }
  for (const item of items) {
    if (item.name !== item.id && ids.has(item.name)) throw new Error(`${kind} name ${item.name} conflicts with another stable ID`);
  }
}
function validateDocument(document: DeploymentDocument, project: BordeauxProject, catalog: JavaCommandCatalog): void {
  const parsed = documentSchema.safeParse(document);
  if (!parsed.success) throw new Error(`Java deployment is invalid: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`);
  unique(document.paths, "Path");
  const eventIds = new Set<string>();
  let sampleCount = 0; let eventCount = 0;
  for (const path of document.paths) {
    sampleCount += path.samples.length; eventCount += path.events.length;
    if (sampleCount > 100_000) throw new Error("Java trajectory export exceeds 100000 samples");
    if (eventCount > 2_000) throw new Error("Java trajectory export exceeds 2000 events");
    path.samples.forEach((sample, index) => {
      if (sample.i !== index || (index && sample.t < path.samples[index - 1].t - 1e-9)
        || sample.t > path.totalTimeS + 1e-9) throw new Error(`${path.name}: sample indexes/times are invalid`);
    });
    path.followSections.forEach((section, index) => {
      if (section.startSample !== (index ? path.followSections[index - 1].endSample : 0)
        || section.endSample < section.startSample || section.endSample >= path.samples.length) throw new Error(`${path.name}: follow sections must be contiguous and within sample bounds`);
    });
    if (path.followSections.at(-1)!.endSample !== path.samples.length - 1) throw new Error(`${path.name}: follow sections must cover every sample`);
    for (const event of path.events) {
      if (eventIds.has(event.eventId)) throw new Error(`Duplicate event ID ${event.eventId}`);
      eventIds.add(event.eventId);
      if (event.timeS > path.totalTimeS + 1e-9 || (event.endTimeS !== undefined && event.endTimeS < event.timeS)) throw new Error(`${path.name}: event ${event.name} has invalid timing`);
    }
  }
  if (document.routine) visitNodes(document.routine.nodes, () => {});
  // Reuse catalog validation for every retained event and all routine branches.
  // No retained trajectory is regenerated from the current editor project.
  const routine = document.routine ? { ...document.routine, id: "deployment-validation" } : null;
  const validationProject: BordeauxProject = { ...project,
    paths: document.paths.map((path) => ({ ...blankPath(path.name), id: path.id,
      markers: path.events.map((event) => ({ id: event.eventId, name: event.name, f: event.fraction,
        invocation: { commandId: event.commandId, arguments: event.arguments, cancelOnPathEnd: event.cancelOnPathEnd },
        schedule: { trigger: event.trigger, repeatEveryS: event.repeatEveryS, endTimeS: event.endTimeS, conditionId: event.conditionId } })) })),
    routines: routine ? [routine] : [], activeRoutineId: routine?.id ?? "",
  };
  const issues = validateProjectJavaInvocations(validationProject, catalog);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
}
function compatible(document: DeploymentDocument, project: BordeauxProject, catalog: JavaCommandCatalog): void {
  if (!document.deploymentContext) throw new Error("Robot baseline has no deployment context. Review a full-project replacement before pushing individual paths or routines.");
  if (stable(document.deploymentContext) !== stable(context(project))) throw new Error("Robot configuration changed. Review a full-project replacement instead of combining old trajectories with new robot settings.");
  if (stable(document.field) !== stable(project.field)) throw new Error("Robot baseline field differs. Review a full-project replacement.");
  if (stable(document.catalog) !== stable({ schemaVersion: catalog.generatedSchemaVersion, catalogId: catalog.catalogId, catalogHash: catalog.catalogHash, supportVersion: catalog.supportVersion })) throw new Error("Robot baseline catalog/support identity differs. Rebuild and review a full-project replacement.");
}
function parseScope(scope: RobotPushScope): RobotPushScope {
  const schema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("paths"), pathIds: z.array(text).min(1).max(64).refine((ids) => new Set(ids).size === ids.length, "Selected path IDs must be unique") }).strict(),
    z.object({ kind: z.literal("routine"), routineId: text }).strict(), z.object({ kind: z.literal("project") }).strict(),
  ]);
  const result = schema.safeParse(scope);
  if (!result.success) throw new Error(`Invalid push selection: ${result.error.issues[0].message}`);
  return result.data;
}
function compileSelection(project: BordeauxProject, catalog: JavaCommandCatalog, scope: RobotPushScope, checkLinks = true, baseline: DeploymentDocument | null = null): { built: Pick<BuiltJavaTrajectory, "document">; dependencyNames: string[]; selectedNames: string[] } {
  if (new Set(project.paths.map((path) => path.id)).size !== project.paths.length) throw new Error("Project path IDs must be unique");
  // IDs must be unambiguous even when another routine is only an invalid draft.
  if (new Set(project.routines.map((routine) => routine.id)).size !== project.routines.length) throw new Error("Project routine IDs must be unique");
  const routine = scope.kind === "paths" ? undefined : scope.kind === "routine" ? project.routines.find((item) => item.id === scope.routineId) : activeRoutine(project);
  if (scope.kind === "routine" && !routine) throw new Error("Selected routine no longer exists");
  const pathIds = new Set(scope.kind === "paths" ? scope.pathIds : scope.kind === "project" ? project.paths.filter((path) => path.exportable !== false).map((path) => path.id) : []);
  if (routine) visitNodes(routine.nodes, (node) => { if (node.type === "path") pathIds.add(node.ref); });
  if (scope.kind === "routine") {
    // Continuity partners are named dependencies, even when the routine does
    // not execute them. Include the whole linked group in the frozen review.
    let previousSize: number;
    do {
      previousSize = pathIds.size;
      for (const link of project.pathLinks) {
        if (pathIds.has(link.fromPathId) || pathIds.has(link.toPathId)) {
          pathIds.add(link.fromPathId);
          pathIds.add(link.toPathId);
        }
      }
    } while (pathIds.size !== previousSize);
  }
  for (const id of pathIds) {
    const path = project.paths.find((item) => item.id === id);
    if (!path) throw new Error(`Selected or required path ${id} no longer exists`);
    if (path.exportable === false) throw new Error(`${path.name} is not exportable. Enable export before pushing it.`);
  }
  if (checkLinks && scope.kind !== "project") {
    const missing = new Set<string>();
    for (const link of project.pathLinks) {
      if (pathIds.has(link.fromPathId) !== pathIds.has(link.toPathId)) missing.add(pathIds.has(link.fromPathId) ? link.toPathId : link.fromPathId);
    }
    if (missing.size) throw new Error(`Linked paths must be pushed together to preserve endpoint continuity. Include: ${[...missing].map((id) => project.paths.find((path) => path.id === id)?.name ?? id).join(", ")}.`);
  }
  const paths = project.paths.filter((path) => pathIds.has(path.id));

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
