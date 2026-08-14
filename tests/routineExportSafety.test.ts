import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildJavaTrajectory } from "../src/shared/export/javaTrajectory";
import { validateProjectJavaInvocations } from "../src/shared/javaCommands";
import { createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog } from "../src/shared/types";
// @ts-expect-error Routine authoring remains a legacy JavaScript module.
import { AUTO } from "../src/renderer/lib/routineModel";

function catalog(): JavaCommandCatalog {
  return {
    projectName: "Safety robot", sourceFileCount: 1, scannedAt: new Date(0).toISOString(),
    authoritative: true, generatedSchemaVersion: "1.2", catalogId: "safety-robot", supportVersion: "0.3.0", catalogHash: `sha256:${"a".repeat(64)}`,
    commands: [{ id: "robot.Commands#score", label: "Score", ownerType: "robot.Commands", member: "score", kind: "factory", confidence: "confirmed", runtimeReady: true, parameters: [], source: { file: "Commands.java", line: 1 } }],
    conditions: [{ id: "robot.Conditions#ready", label: "Ready", ownerType: "robot.Conditions", member: "ready", source: { file: "Conditions.java", line: 1 } }],
    builtIns: [{ id: "bordeaux.wait", kind: "wait", label: "Wait", description: "Pause the routine before its next step.", parameters: [{ name: "durationS", label: "Duration", description: "Time to wait before continuing the routine.", unit: "s", defaultValue: 1, min: 0.02, max: 15, role: "argument", javaType: "double", schema: { kind: "number", javaType: "double" } }] }],
    warnings: [],
  };
}

describe("routine export safety", () => {
  it("authors only paths, decisions, commands, and an available Wait", () => {
    expect(AUTO.authorableSteps(catalog()).map((step: { id: string }) => step.id)).toEqual(["path", "decision", "command", "wait"]);
    expect(AUTO.authorableSteps({ ...catalog(), generatedSchemaVersion: "1.1", builtIns: [] }).map((step: { id: string }) => step.id)).toEqual(["path", "decision", "command"]);
    expect(AUTO.newNode("function", "command")).toMatchObject({ type: "function", cat: "command" });
    expect(AUTO.nodeDeploymentState({ id: "legacy", type: "function", cat: "generate" })).toMatchObject({ deployable: false, legacy: true });
    expect(() => AUTO.nodeTitle({ id: "unknown", type: "future" }, [])).not.toThrow();
  });

  it("reports every active legacy and malformed node across both decision branches", () => {
    const project = createDemoProject();
    project.routines[0].nodes = [{
      id: "gate", type: "decision", cond: "robot.Conditions#ready", thenLabel: "yes", elseLabel: "no",
      then: [{ id: "legacy", type: "function", cat: "generate" }],
      else: [
        { id: "unknown", type: "future" },
        { id: "bad-path", type: "path", ref: "missing-path" },
        { id: "bad-wait", type: "builtin", builtinId: "bordeaux.wait", arguments: { durationS: 0.01 } },
      ],
    }] as never;

    const issues = validateProjectJavaInvocations(project, catalog());
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "$.routines[0].nodes[0].then[0]",
      "$.routines[0].nodes[0].else[0]",
      "$.routines[0].nodes[0].else[1].ref",
      "$.routines[0].nodes[0].else[2].arguments",
    ]));
    expect(() => buildJavaTrajectory(project, catalog())).toThrow(/nodes\[0\]\.then\[0\][\s\S]*nodes\[0\]\.else\[2\]\.arguments/);
  });

  it("does not let an inactive legacy routine block the routine selected for export", () => {
    const project = createDemoProject();
    project.routines[0].nodes = [{ id: "legacy", type: "function", cat: "sequence" }] as never;
    project.routines.push({ id: "active", name: "Safe", nodes: [{ id: "path", type: "path", ref: project.paths[0].id }] });
    project.activeRoutineId = "active";

    expect(validateProjectJavaInvocations(project, catalog())).toEqual([]);
    expect(buildJavaTrajectory(project, catalog()).document.routine?.name).toBe("Safe");
  });

  it("keeps the chooser closed and marks unsupported nodes as migration work", () => {
    const panel = fs.readFileSync(path.join(process.cwd(), "src/renderer/components/RoutinePanel.jsx"), "utf8");
    const inspector = fs.readFileSync(path.join(process.cwd(), "src/renderer/components/RoutineInspector.jsx"), "utf8");

    expect(panel).toContain("A.AUTHORABLE_STEPS");
    expect(panel).toContain("waitAvailable");
    expect(inspector).toContain("Legacy — cannot deploy");
  });
});
