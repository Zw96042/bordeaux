import { describe, expect, it } from "vitest";
import { buildJavaTrajectory, javaTrajectoryFileName } from "../src/shared/export/javaTrajectory";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog } from "../src/shared/types";

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
});
