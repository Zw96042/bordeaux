import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBdxExport } from "../src/shared/export/bdx";
import { buildLabviewBdx } from "../src/shared/export/labviewBdx";
import { createDemoProject } from "../src/shared/project/defaults";
import type { BordeauxProject, JavaCommandCatalog, JavaCommandDescriptor } from "../src/shared/types";
import { validateProject } from "../src/shared/validation";
import { validateProjectJavaInvocations } from "../src/shared/javaCommands";

describe("Java command marker invocations", () => {
  it("preserves JSON-compatible custom arguments in native planner output", () => {
    const project = createDemoProject();
    project.paths[0].markers = [{
      f: 0.5,
      name: "score",
      invocation: {
        commandId: "frc.robot.Superstructure#score",
        arguments: {
          target: { level: "L4", pose: { x: 2.1, y: 4.8 }, tags: ["auto", "reef"] },
          releaseDelayS: 0.15,
          retry: false,
          fallback: null,
        },
      },
    }];

    expect(validateProject(project).ok).toBe(true);
    expect(buildBdxExport(project).paths[0].markers[0].invocation).toEqual(project.paths[0].markers[0].invocation);
  });

  it("rejects invalid invocation IDs and nonfinite nested arguments", () => {
    const project = createDemoProject() as BordeauxProject;
    project.paths[0].markers = [{
      f: 0.5,
      name: "bad",
      invocation: { commandId: "", arguments: { nested: { value: Number.NaN } } },
    }];

    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.path)).toEqual(expect.arrayContaining([
      "$.paths[0].markers[0].invocation.commandId",
      "$.paths[0].markers[0].invocation.arguments.nested.value",
    ]));
  });

  it("keeps Java invocation metadata out of the LabVIEW binary contract", () => {
    const project = createDemoProject();
    const before = buildLabviewBdx(project).buffer;
    project.paths[0].markers = [{
      f: 0.5,
      name: "score",
      invocation: {
        commandId: "frc.robot.Superstructure#score",
        arguments: { target: { level: "L4" } },
      },
    }];

    expect(buildLabviewBdx(project).buffer).toEqual(before);
  });

  it("keeps a pending action intent editable but blocks Java export", () => {
    const project = createDemoProject();
    project.paths[0].markers = [{
      f: 1,
      name: "shoot into the HUB",
      cmd: "none",
      actionIntent: { semanticTag: "shoot-fuel", description: "shoot into the HUB" },
    }];

    expect(validateProject(project).ok).toBe(true);
    expect(validateProjectJavaInvocations(project, null)).toEqual([
      expect.objectContaining({ path: expect.stringContaining("actionIntent"), severity: "error" }),
    ]);
  });

  it("requires a bound command to advertise the pending action capability", () => {
    const project = createDemoProject();
    project.paths[0].markers = [{
      f: 1,
      name: "shoot into the HUB",
      actionIntent: { semanticTag: "shoot-fuel", description: "shoot into the HUB" },
      invocation: { commandId: "robot.drive", arguments: {} },
    }];
    const command: JavaCommandDescriptor = {
      id: "robot.drive",
      label: "Drive",
      ownerType: "frc.robot.Drive",
      member: "create",
