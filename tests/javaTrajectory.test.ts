import { describe, expect, it } from "vitest";
import { buildJavaTrajectory, javaTrajectoryFileName } from "../src/shared/export/javaTrajectory";
import { getPlanner } from "../src/shared/planners";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { AutonomousRoutine, JavaCommandCatalog, RoutineNode } from "../src/shared/types";

function generatedCatalog(): JavaCommandCatalog {
  return {
    projectName: "CompetitionRobot",
    sourceFileCount: 1,
    scannedAt: "2026-08-05T00:00:00.000Z",
    source: "generated",
    runtimeCommandCount: 1,
    generatedSchemaVersion: "1.0",
    catalogId: "competition-robot",
    supportVersion: "0.1.0",
    catalogHash: `sha256:${"a".repeat(64)}`,
    authoritative: true,
    warnings: [],
    commands: [{
      id: "frc.robot.AutoCommands#score",
      label: "Score",
      ownerType: "frc.robot.AutoCommands",
      member: "score",
      kind: "factory",
      confidence: "confirmed",
      runtimeReady: true,
      source: { file: "src/main/java/frc/robot/AutoCommands.java", line: 12 },
      parameters: [
        { name: "sequence", javaType: "long", role: "argument", schema: { kind: "integerString", javaType: "long" } },
        {
          name: "target",
          javaType: "frc.robot.Target",
          role: "argument",
          schema: { kind: "object", javaType: "frc.robot.Target", fields: [{ name: "level", schema: { kind: "string", javaType: "String" } }] },
        },
      ],
    }],
  };
}

describe("Java trajectory export", () => {
  it("emits stable timed events with exact custom arguments and catalog identity", () => {
    const project = createDemoProject();
    project.name = "Two Piece Auto";
    project.paths[0].markers = [{
      id: "event_score",
      f: 0.5,
      name: "Score",
      invocation: {
        commandId: "frc.robot.AutoCommands#score",
        arguments: { sequence: "9007199254740993", target: { level: "L4" } },
        cancelOnPathEnd: true,
      },
      schedule: { trigger: "position", repeatEveryS: 0.1, endTimeS: 2, conditionId: "frc.robot.Conditions#ready" },
    }];

    const built = buildJavaTrajectory(project, generatedCatalog());

    expect(built.document.schemaVersion).toBe("bordeaux-trajectory/1.0");
    expect(built.document.catalog.catalogHash).toMatch(/^sha256:/);
    expect(built.document.catalog.catalogId).toBe("competition-robot");
    expect(built.document.paths[0].events).toEqual([expect.objectContaining({
      eventId: "event_score",
      commandId: "frc.robot.AutoCommands#score",
      arguments: { sequence: "9007199254740993", target: { level: "L4" } },
      cancelOnPathEnd: true,
      trigger: "position",
      repeatEveryS: 0.1,
      endTimeS: 2,
      conditionId: "frc.robot.Conditions#ready",
    })]);
    expect(built.eventCount).toBe(1);
    expect(built.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(javaTrajectoryFileName(project.name)).toBe("Two-Piece-Auto.bordeaux.json");
  });

  it("exports mixed time and position following by authored segment", () => {
    const project = createDemoProject();
    project.paths[0].followMode = "position";
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, segmentFollowMode: "time" },
      { x: 4, y: 2, theta: 0 },
      { x: 7, y: 2, theta: 0 },
    ]);

    const sections = buildJavaTrajectory(project, generatedCatalog()).document.paths[0].followSections;

    expect(sections.map((section) => section.mode)).toEqual(["time", "position"]);
    expect(sections[0].startSample).toBe(0);
    expect(sections[0].endSample).toBe(sections[1].startSample);
    expect(sections[1].endSample).toBeGreaterThan(sections[1].startSample);
  });

  it("keeps a follow section through a final duplicate segment", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 1, segType: "clothoid" },
      { x: 5, y: 5, segType: "clothoid" },
      { x: 10, y: 2, segType: "clothoid" },
      { x: 12, y: 6, segType: "bezier" },
      { x: 12, y: 6, segType: "line" },
    ]);

    const sections = buildJavaTrajectory(project, generatedCatalog()).document.paths[0].followSections;

    expect(sections).toHaveLength(4);
    expect(sections[3].startSample).toBe(sections[2].endSample);
    expect(sections[3].endSample).toBeGreaterThan(sections[3].startSample);
  });

  it("exports a terminal position-follow wait as a trailing time section", () => {
    const project = createDemoProject();
    project.paths[0].followMode = "position";
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 2, segType: "line" },
      { x: 5, y: 2, segType: "line", stop: true, wait: 1 },
    ]);

    const path = buildJavaTrajectory(project, generatedCatalog()).document.paths[0];

    expect(path.followSections.map((section) => section.mode)).toEqual(["position", "time"]);
    expect(path.followSections[0].endSample).toBe(path.followSections[1].startSample);
    expect(path.followSections[1].endSample).toBe(path.samples.length - 1);
    const holdDuration = path.samples.at(-1)!.t - path.samples[path.followSections[1].startSample].t;
    expect(holdDuration).toBeGreaterThanOrEqual(1);
    expect(holdDuration).toBeLessThan(1.05);
  });

  it("exports consecutive duplicate actions from their authored boundaries", () => {
    const project = createDemoProject();
    project.paths[0].followMode = "position";
    project.paths[0].waypoints = buildWaypoints([
      { x: 0, y: 2, segType: "line" },
      { x: 2, y: 2, segType: "line" },
      { x: 2, y: 2, segType: "line", stop: true, wait: 1 },
      { x: 2, y: 2, segType: "line", stop: true, wait: 2 },
      { x: 1, y: 2, segType: "line" },
      { x: 3, y: 2, segType: "line" },
    ]);

    const path = buildJavaTrajectory(project, generatedCatalog()).document.paths[0];
    const arrivals = getPlanner(project.plannerId).generate({ path: project.paths[0], robot: project.robot })
      .waypointSampleIndices!;

    for (const [waypointIndex, wait] of [[2, 1], [3, 2]] as const) {
      const section = path.followSections.find((candidate) => (
        candidate.mode === "time" && candidate.startSample === arrivals[waypointIndex]
      ));
      expect(section).toBeDefined();
      expect(path.samples[section!.endSample].t - path.samples[section!.startSample].t)
        .toBeGreaterThanOrEqual(wait - 1e-4);
    }
  });

  it("exports decisions and bound commands between paths", () => {
    const project = createDemoProject();
    const pathId = project.paths[0].id;
    const selectedRoutine: AutonomousRoutine = { id: "routine_selected", name: "Choose note", nodes: [{
      id: "note-present", type: "decision", cond: "frc.robot.Conditions#hasNote",
      thenLabel: "present", elseLabel: "missing",
      then: [{ id: "score", type: "function", cat: "command", invocation: {
        commandId: "frc.robot.AutoCommands#score",
        arguments: { sequence: "2", target: { level: "L4" } },
      } }, { id: "run-a", type: "path", ref: pathId }],
      else: [{ id: "run-b", type: "path", ref: pathId }],
    }] };
    project.routines.push(selectedRoutine);
    project.activeRoutineId = selectedRoutine.id;

    const routine = buildJavaTrajectory(project, generatedCatalog()).document.routine!;

    expect(routine.name).toBe(selectedRoutine.name);
    expect(routine.nodes[0]).toEqual(expect.objectContaining({ type: "decision", cond: "frc.robot.Conditions#hasNote" }));
    expect((routine.nodes[0] as { then: unknown[] }).then[0]).toEqual(expect.objectContaining({ cat: "command" }));
  });

  it("blocks source-only, unresolved legacy, and schema-invalid commands", () => {
    const project = createDemoProject();
    project.paths[0].markers = [{ id: "legacy", f: 0.2, name: "Legacy", cmd: "shoot" }];
    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow(/Legacy command shoot/);

    project.paths[0].markers = [{
      id: "bad",
      f: 0.2,
      name: "Bad",
      invocation: { commandId: "frc.robot.AutoCommands#score", arguments: { sequence: "9223372036854775808", target: { level: "L4" } } },
    }];
    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow(/signed 64-bit/);

    const sourceOnly = generatedCatalog();
    sourceOnly.commands[0].runtimeReady = false;
    expect(() => buildJavaTrajectory(project, sourceOnly)).toThrow(/no generated robot binding/);
  });

  it("blocks collections larger than the robot runtime accepts", () => {
    const project = createDemoProject();
    const catalog = generatedCatalog();
    catalog.commands[0].parameters = [
      { name: "items", javaType: "java.util.List<java.lang.String>", role: "argument", schema: { kind: "array", javaType: "java.util.List<java.lang.String>", element: { kind: "string", javaType: "java.lang.String" } } },
      { name: "lookup", javaType: "java.util.Map<java.lang.String, java.lang.String>", role: "argument", schema: { kind: "map", javaType: "java.util.Map<java.lang.String, java.lang.String>", value: { kind: "string", javaType: "java.lang.String" } } },
    ];
    project.paths[0].markers = [{
      id: "oversized",
      f: 0.2,
      name: "Oversized",
      invocation: {
        commandId: catalog.commands[0].id,
        arguments: { items: Array.from({ length: 1_025 }, () => "x"), lookup: {} },
      },
    }];
    expect(() => buildJavaTrajectory(project, catalog)).toThrow(/more than 1024 items/);

    project.paths[0].markers[0].invocation!.arguments = {
      items: [],
      lookup: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key${index}`, "x"])),
    };
    expect(() => buildJavaTrajectory(project, catalog)).toThrow(/more than 256 entries/);
  });

  it("requires an authoritative generated catalog even when a project has no events", () => {
    const catalog = generatedCatalog();
    catalog.authoritative = false;
    expect(() => buildJavaTrajectory(createDemoProject(), catalog)).toThrow(/Build the annotated/);
  });

  it("rejects a document with no exportable paths before the robot reader does", () => {
    const project = createDemoProject();
    project.paths.forEach((path) => { path.exportable = false; });

    expect(() => buildJavaTrajectory(project, generatedCatalog()))
      .toThrow("Java trajectory export requires at least one exportable path");
  });

  it("rejects oversized event and metadata payloads during preflight", () => {
    const eventProject = createDemoProject();
    eventProject.paths[0].markers = Array.from({ length: 2_001 }, (_, index) => ({
      id: `event-${index}`,
      f: 0.5,
      name: `Event ${index}`,
      invocation: {
        commandId: "frc.robot.AutoCommands#score",
        arguments: { sequence: "1", target: { level: "L4" } },
      },
    }));
    expect(() => buildJavaTrajectory(eventProject, generatedCatalog())).toThrow(/exceeds 2000 events/);

    const metadataProject = createDemoProject();
    const metadataCatalog = generatedCatalog();
    metadataCatalog.commands[0].parameters = [{
      name: "message",
      javaType: "java.lang.String",
      role: "argument",
      schema: { kind: "string", javaType: "java.lang.String" },
    }];
    metadataProject.paths[0].markers = [{
      id: "large-message",
      f: 0.5,
      name: "Large message",
      invocation: {
        commandId: metadataCatalog.commands[0].id,
        arguments: { message: "x".repeat(16 * 1024 * 1024) },
      },
    }];
    expect(() => buildJavaTrajectory(metadataProject, metadataCatalog)).toThrow(/exceeds 16777216 bytes/);
  });

  it("rejects aggregate base samples before generating any trajectory", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints(Array.from({ length: 1_787 }, (_, index) => ({
      x: 1 + index * 0.001,
      y: 2,
      theta: 0,
    })));

    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow("exceeds 100000 samples");
  });

  it("rejects documents beyond the Java reader path and routine limits", () => {
    const pathProject = createDemoProject();
    const sourcePath = pathProject.paths[0];
    pathProject.paths = Array.from({ length: 65 }, (_, index) => ({
      ...structuredClone(sourcePath),
      id: `path-${index}`,
      name: `Path ${index}`,
    }));
    expect(() => buildJavaTrajectory(pathProject, generatedCatalog())).toThrow("exceeds 64 paths");

    const routineProject = createDemoProject();
    routineProject.routines[0].nodes = Array.from({ length: 2_001 }, (_, index) => ({
      id: `node-${index}`,
      type: "path" as const,
      ref: routineProject.paths[0].id,
    }));
    expect(() => buildJavaTrajectory(routineProject, generatedCatalog())).toThrow("exceeds 2000 routine nodes");
  });

  it("rejects routine JSON deeper than the Java reader accepts", () => {
    const project = createDemoProject();
    let nodes: RoutineNode[] = [{ id: "path-node", type: "path", ref: project.paths[0].id }];
    for (let depth = 0; depth < 20; depth += 1) {
      nodes = [{
        id: `decision-${depth}`,
        type: "decision",
        cond: `frc.robot.Conditions#depth${depth}`,
        thenLabel: "yes",
        elseLabel: "no",
        then: nodes,
        else: [],
      }];
    }
    project.routines[0].nodes = nodes;

    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow("exceeds JSON nesting depth of 40");
  });
});
