import { describe, expect, it } from "vitest";
import { buildJavaDeployment, compareJavaDeployment, type RobotPushScope } from "../src/shared/export/javaDeployment";
import { buildJavaTrajectory } from "../src/shared/export/javaTrajectory";
import { blankPath, createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog } from "../src/shared/types";

const catalog: JavaCommandCatalog = { projectName: "Robot", sourceFileCount: 0, scannedAt: "", warnings: [], commands: [], conditions: [], authoritative: true, generatedSchemaVersion: "1.3", catalogId: "robot", supportVersion: "0.4.0", catalogHash: `sha256:${"a".repeat(64)}` };
function project() {
  const value = createDemoProject();
  value.paths = ["A", "B", "C"].map((name) => ({ ...blankPath(name), id: name }));
  value.routines = [
    { id: "R", name: "Routine R", nodes: [{ id: "r-a", type: "path", ref: "A" }, { id: "r-b", type: "path", ref: "B" }] },
    { id: "S", name: "Routine S", nodes: [{ id: "s-c", type: "path", ref: "C" }] },
  ];
  value.activeRoutineId = "R"; value.editor = { activePathId: "A" };
  return value;
}
const paths = (...pathIds: string[]): RobotPushScope => ({ kind: "paths", pathIds });
function baseline() { return buildJavaDeployment(project(), catalog, { kind: "project" }, null).trajectory; }
function changePath(value: ReturnType<typeof project>, id: string) { value.paths.find((path) => path.id === id)!.constraints.maxVel = 1; }

describe("selective Java deployments", () => {
  it("replaces A by stable ID while preserving old B and R despite editing B and browsing S", () => {
    const old = baseline(); const current = project();
    current.activeRoutineId = "S"; changePath(current, "A"); changePath(current, "B");
    current.paths[0].name = "Renamed A";
    const result = buildJavaDeployment(current, catalog, paths("A"), old.contents);
    expect(result.trajectory.document.paths[0].name).toBe("Renamed A");
    expect(result.trajectory.document.paths[0].samples).not.toEqual(old.document.paths[0].samples);
    expect(result.trajectory.document.paths[1]).toEqual(old.document.paths[1]);
    expect(result.trajectory.document.routine).toEqual(old.document.routine);
    expect(result.summary).toMatchObject({ selectedNames: ["Renamed A"], updatedNames: ["Renamed A"], preservedPathCount: 2, routine: "Routine R", previousRoutine: "Routine R" });
    expect(JSON.parse(result.trajectory.contents)).toEqual(result.trajectory.document);
  });
  it("pushes a named batch and adds new paths without removing old records", () => {
    const old = baseline(); const current = project(); changePath(current, "A"); changePath(current, "B");
    current.paths.push({ ...blankPath("D"), id: "D" });
    const result = buildJavaDeployment(current, catalog, paths("A", "B", "D"), old.contents);
    expect(result.trajectory.pathCount).toBe(4);
    expect(result.summary).toMatchObject({ addedNames: ["D"], updatedNames: ["A", "B"], preservedPathCount: 1 });
    expect(result.trajectory.document.paths[2]).toEqual(old.document.paths[2]);
  });
  it("creates a paths-only first snapshot without deploying the editor routine", () => {
    const result = buildJavaDeployment(project(), catalog, paths("B"), null);
    expect(result.trajectory.document.routine).toBeNull();
    expect(result.trajectory.document.paths.map((path) => path.id)).toEqual(["B"]);
  });
  it("compiles the explicitly selected routine and its path dependencies", () => {
    const old = baseline(); const current = project(); changePath(current, "C");
    const result = buildJavaDeployment(current, catalog, { kind: "routine", routineId: "S" }, old.contents);
    expect(result.trajectory.document.routine?.name).toBe("Routine S");
    expect(result.summary).toMatchObject({ selectedNames: ["Routine S"], dependencyNames: ["C"], preservedPathCount: 2 });
    expect(result.trajectory.document.paths[0]).toEqual(old.document.paths[0]);
  });
  it("includes paths from both decisions and generated fallbacks", () => {
    const current = project();
    const capabilities: JavaCommandCatalog = { ...catalog,
      conditions: [{ id: "ready", label: "Ready", ownerType: "Robot", member: "ready", source: { file: "Robot.java", line: 1 } }],
      trajectoryGenerators: [{ id: "dynamic", label: "Dynamic", ownerType: "Robot", member: "dynamic", inputs: [], preview: { kind: "runtimeDynamic" }, fallbackPolicy: "validatedBranch",
        limits: { timeoutMs: 50, maxSamples: 100, maxDurationS: 8, maxDistanceM: 20, maxVelocityMps: 5, maxAccelerationMps2: 10, maxCentripetalAccelerationMps2: 8, maxAngularVelocityRadps: 12, maxAngularAccelerationRadps2: 40, minClearanceM: 0.2 }, source: { file: "Robot.java", line: 1 } }],
    };
    current.routines[0].nodes = [{ id: "decision", type: "decision", cond: "ready", thenLabel: "Yes", elseLabel: "No",
      then: [{ id: "a", type: "path", ref: "A" }],
      else: [{ id: "b", type: "path", ref: "B" }, { id: "generated", type: "generatedTrajectory", generatorId: "dynamic", arguments: {}, fallback: { type: "branch", nodes: [{ id: "fallback-c", type: "path", ref: "C" }] } }],
    }];
    const result = buildJavaDeployment(current, capabilities, { kind: "routine", routineId: "R" }, null);
    expect(result.summary.dependencyNames).toEqual(["A", "B", "C"]);
    expect(result.trajectory.document.routine?.nodes).toEqual(current.routines[0].nodes);
    current.paths.push({ ...blankPath("D"), id: "D" }, { ...blankPath("E"), id: "E" });
    current.pathLinks = [{ id: "ed", fromPathId: "E", toPathId: "D" }, { id: "dc", fromPathId: "D", toPathId: "C" }];
    const linkedFallback = buildJavaDeployment(current, capabilities, { kind: "routine", routineId: "R" }, null);
    expect(linkedFallback.summary.dependencyNames).toEqual(["A", "B", "C", "D", "E"]);
    expect(linkedFallback.trajectory.document.routine?.nodes).toEqual(current.routines[0].nodes);
  });
  it("supports command-only routines while retaining existing paths", () => {
    const current = project(); current.routines[0].nodes = [];
    const result = buildJavaDeployment(current, catalog, { kind: "routine", routineId: "R" }, baseline().contents);
    expect(result.trajectory.pathCount).toBe(3);
    expect(result.trajectory.document.routine?.nodes).toEqual([]);
    expect(result.summary.pathIds).toEqual([]);
  });
  it("explains how to push a routine with no static paths to an empty robot", () => {
    const current = project(); current.routines[0].nodes = [];
    expect(() => buildJavaDeployment(current, catalog, { kind: "routine", routineId: "R" }, null)).toThrow(/Push a path first/);
  });
  it("names the full linked routine dependency group and preserves unrelated robot paths", () => {
    const old = baseline(); const current = project();
    current.paths.push({ ...blankPath("D"), id: "D" });
    current.routines[1].nodes = [{ id: "only-a", type: "path", ref: "A" }];
    // Reverse order forces transitive expansion, including incoming links.
    current.pathLinks = [{ id: "bd", fromPathId: "B", toPathId: "D" }, { id: "ab", fromPathId: "A", toPathId: "B" }];
    changePath(current, "A"); changePath(current, "B"); changePath(current, "C");
    const result = buildJavaDeployment(current, catalog, { kind: "routine", routineId: "S" }, old.contents);
    expect(result.summary).toMatchObject({ dependencyNames: ["A", "B", "D"], pathIds: ["A", "B", "D"], preservedPathCount: 1 });
    expect(result.trajectory.document.paths.find((path) => path.id === "C")).toEqual(old.document.paths.find((path) => path.id === "C"));
    expect(result.trajectory.document.routine?.nodes).toEqual(current.routines[1].nodes);
    current.paths.find((path) => path.id === "D")!.exportable = false;
    expect(() => buildJavaDeployment(current, catalog, { kind: "routine", routineId: "S" }, old.contents)).toThrow(/D is not exportable/);
  });
  it("does not validate unrelated malformed path or routine drafts", () => {
    const current = project(); current.paths[1].waypoints = []; current.paths[1].name = "";
    current.routines[1].nodes = [{ id: "bad", type: "path", ref: "missing" }]; current.activeRoutineId = "S";
    expect(buildJavaDeployment(current, catalog, paths("A"), null).trajectory.pathCount).toBe(1);
    expect(() => buildJavaDeployment(current, catalog, paths("B"), null)).toThrow();
  });
  it("requires linked paths as an explicit group", () => {
    const current = project(); current.pathLinks = [{ id: "ab", fromPathId: "A", toPathId: "B" }];
    expect(() => buildJavaDeployment(current, catalog, paths("A"), null)).toThrow(/Include: B/);
    expect(buildJavaDeployment(current, catalog, paths("A", "B"), null).trajectory.pathCount).toBe(2);
  });
  it.each([{}, { kind: "paths", pathIds: [] }, { kind: "paths", pathIds: ["A", "A"] }, { kind: "paths", pathIds: ["A"], unexpected: true }, { kind: "routine" }])("strictly rejects malformed scope %s", (scope) => {
    expect(() => buildJavaDeployment(project(), catalog, scope as RobotPushScope, null)).toThrow(/Invalid push selection/);
  });
  it("blocks unavailable and disabled targets", () => {
    const current = project(); current.paths[0].exportable = false;
    expect(() => buildJavaDeployment(current, catalog, paths("A"), null)).toThrow(/not exportable/);
    expect(() => buildJavaDeployment(current, catalog, paths("deleted"), null)).toThrow(/no longer exists/);
    expect(() => buildJavaDeployment(current, catalog, { kind: "routine", routineId: "deleted" }, null)).toThrow(/no longer exists/);
  });
  it.each(["not-json", "{}", '{"paths":[],"paths":[]}'])("rejects malformed baseline %s", (contents) => {
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), contents)).toThrow(/baseline/i);
  });
  it("requires explicit replacement for legacy baseline without context", () => {
    const old = buildJavaTrajectory(project(), catalog);
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), old.contents)).toThrow(/no deployment context/);
    expect(buildJavaDeployment(project(), catalog, { kind: "project" }, old.contents).trajectory.pathCount).toBe(3);
  });
  it("blocks field/catalog and generation-affecting robot changes", () => {
    const old = baseline();
    const current = project(); current.robot.driveModel = { motorId: "neo", motorFreeRpm: 5676, gearRatio: 6.75, wheelDiameterM: 0.1016 };
    expect(() => buildJavaDeployment(current, catalog, paths("A"), old.contents)).toThrow(/Robot configuration changed/);
    const otherField = project(); otherField.field.revision = "other";
    expect(() => buildJavaDeployment(otherField, catalog, paths("A"), old.contents)).toThrow(/field differs/);
    expect(() => buildJavaDeployment(project(), { ...catalog, catalogHash: `sha256:${"b".repeat(64)}` }, paths("A"), old.contents)).toThrow(/catalog\/support/);
  });
  it("ignores robot editor hints and planning notes in compatibility", () => {
    const current = project(); current.robot.planning = { notes: "Notes changed" };
    expect(buildJavaDeployment(current, catalog, paths("A"), baseline().contents).trajectory.pathCount).toBe(3);
  });
  it("rejects duplicate IDs and names in composed content", () => {
    const old = baseline(); const current = project(); current.paths[0].name = "B";
    expect(() => buildJavaDeployment(current, catalog, paths("A"), old.contents)).toThrow(/names.*unique/);
    current.paths[1].id = "A";
    expect(() => buildJavaDeployment(current, catalog, paths("A"), null)).toThrow(/IDs.*unique/);
  });
  it("revalidates retained samples, routine references, and aggregate path limits", () => {
    const old = baseline();
    const corrupt = structuredClone(old.document); corrupt.paths[1].samples[1].i = 99;
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), JSON.stringify(corrupt))).toThrow(/sample indexes/);
    const dangling = structuredClone(old.document); dangling.routine!.nodes = [{ id: "bad", type: "path", ref: "gone" }];
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), JSON.stringify(dangling))).toThrow(/reference/);
    const full = structuredClone(old.document); full.routine = null;
    full.paths = Array.from({ length: 64 }, (_, i) => ({ ...full.paths[0], id: `old-${i}`, name: `Old ${i}` }));
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), JSON.stringify(full))).toThrow(/64/);
  });
  it("revalidates aggregate sample limits after composition", () => {
    const old = baseline(); const full = structuredClone(old.document); full.routine = null;
    const template = full.paths[0];
    full.paths = Array.from({ length: 63 }, (_, i) => {
      const samples = Array.from({ length: 1587 }, (_, index) => ({ ...template.samples[0], i: index }));
      return { ...template, id: `old-${i}`, name: `Old ${i}`, samples, followSections: [{ segmentIndex: 0, mode: "time" as const, startSample: 0, endSample: samples.length - 1 }] };
    });
    // 99,981 retained samples fit; the selected path takes the snapshot over 100k.
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), JSON.stringify(full))).toThrow(/100000 samples/);
  });
  it("enforces event, routine-node, and byte budgets on retained content", () => {
    const commandCatalog: JavaCommandCatalog = { ...catalog, commands: [{ id: "score", label: "Score", ownerType: "Robot", member: "score", kind: "factory", confidence: "confirmed", runtimeReady: true, parameters: [], source: { file: "Robot.java", line: 1 } }] };
    const old = buildJavaDeployment(project(), commandCatalog, { kind: "project" }, null).trajectory;
    const full = structuredClone(old.document);
    full.paths[1].events = Array.from({ length: 1999 }, (_, index) => ({ eventId: `old-${index}`, name: "Score", timeS: 0, fraction: 0, commandId: "score", arguments: {}, cancelOnPathEnd: false, trigger: "time" as const }));
    const current = project();
    current.paths[0].markers = [0, 1].map((index) => ({ id: `new-${index}`, name: "Score", f: 0, invocation: { commandId: "score", arguments: {} } }));
    expect(() => buildJavaDeployment(current, commandCatalog, paths("A"), JSON.stringify(full))).toThrow(/2000 events/);
    const nodes = structuredClone(old.document);
    nodes.routine!.nodes = Array.from({ length: 2001 }, (_, index) => ({ id: `node-${index}`, type: "path", ref: "A" }));
    expect(() => buildJavaDeployment(project(), commandCatalog, paths("A"), JSON.stringify(nodes))).toThrow(/2000 routine nodes/);
    expect(() => buildJavaDeployment(project(), catalog, paths("A"), " ".repeat(16 * 1024 * 1024 + 1))).toThrow(/16777216 bytes/);
  });
  it("compares exact path and routine dependency content without mistaking names for identity", () => {
    const old = baseline(); const current = project(); changePath(current, "A");
    current.paths.push({ ...blankPath("New"), id: "new" });
    current.paths[2].waypoints = [];
    const result = compareJavaDeployment(current, catalog, old.contents);
    expect(result.paths).toMatchObject({ A: { state: "changed" }, B: { state: "matches" }, C: { state: "invalid" }, new: { state: "missing" } });
    expect(result.routines.R.state).toBe("changed");
    const renamed = project(); renamed.routines[0].name = "Renamed"; renamed.routines[0].id = "different-local-id"; renamed.activeRoutineId = "different-local-id";
    expect(compareJavaDeployment(renamed, catalog, old.contents).routines["different-local-id"].state).toBe("matches");
    expect(compareJavaDeployment(current, catalog, "{}").paths.A.state).toBe("unknown");
  });
});
