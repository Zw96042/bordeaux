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
      kind: "factory" as const,
      confidence: "confirmed" as const,
      runtimeReady: true,
      parameters: [],
      source: { file: "Drive.java", line: 1 },
    };
    const catalog: JavaCommandCatalog = {
      projectName: "Robot",
      sourceFileCount: 1,
      scannedAt: new Date(0).toISOString(),
      warnings: [],
      commands: [command],
    };

    expect(validateProjectJavaInvocations(project, catalog)).toEqual([
      expect.objectContaining({ path: expect.stringContaining("actionIntent"), severity: "error" }),
    ]);

    command.semanticTags = ["shoot-fuel"];
    expect(validateProjectJavaInvocations(project, catalog)).toEqual([]);
  });

  it("wires desktop discovery and accessible custom parameter controls into the canonical renderer", () => {
    const styles = fs.readFileSync(path.join(process.cwd(), "public/renderer/styles.css"), "utf8");
    const app = fs.readFileSync(path.join(process.cwd(), "public/renderer/assets/app.js"), "utf8");
    const inspector = fs.readFileSync(path.join(process.cwd(), "public/renderer/assets/context-inspector.js"), "utf8");
    const primitives = fs.readFileSync(path.join(process.cwd(), "public/renderer/assets/ui-primitives.js"), "utf8");
    expect(app).toContain("window.bordeauxAPI.linkJavaProject()");
    expect(app).toContain("window.bordeauxAPI.refreshJavaProject()");
    expect(app).toContain("window.bordeauxAPI.listRecentJavaProjects()");
    expect(app).toContain("window.bordeauxAPI.openRecentJavaProject(id)");
    expect(app).toContain("status: current.catalog ? 'stale' : 'error'");
    expect(inspector).toContain("function CommandParameterEditor");
    expect(inspector).toContain("function schemaValueError");
    expect(inspector).toContain("function exactIntegerStringError");
    expect(inspector).toContain("cannot contain more than 1024 items");
    expect(inspector).toContain("cannot contain more than 256 entries");
    expect(inspector).toContain("9223372036854775807");
    expect(inspector).toContain("function IntegerStringValueEditor");
    expect(inspector).toContain("Use current defaults");
    expect(primitives).toContain("function Dropdown");
    expect(primitives).toContain("role: 'combobox'");
    expect(primitives).toContain("role: 'listbox'");
    expect(primitives).toContain("role: 'option'");
    expect(primitives).toContain("items.length > searchThreshold");
    expect(primitives).toContain("const MAX_RENDERED_PICKER_ITEMS = 80");
    expect(primitives).toContain("filteredItems.slice(0, MAX_RENDERED_PICKER_ITEMS)");
    expect(primitives).toContain("Keep typing to narrow results");
    expect(primitives).toContain("allowCustom = false");
    expect(primitives).toContain("customDraft.trim()");
    expect(primitives).toContain("document.addEventListener('pointerdown', closeFromOutside)");
    expect(inspector).not.toContain("const showCommandSearch");
    expect(inspector).not.toContain("(preview)");
    expect(inspector).toContain("htmlFor: id");
    expect(inspector).toContain("className: 'cmd-choice-grid'");
    expect(inspector).toContain("options.length <= 4");
    expect(inspector).toContain("h('span', { title: option }, option)");
    expect(inspector).toContain("searchThreshold: 7");
    expect(inspector).toContain("items: options.map((option) => ({ value: option, label: option }))");
    expect(inspector).toContain("id: 'event-command-cancel'");
    expect(inspector).toContain("className: 'cmd-toggle-track'");
    expect(inspector).toContain("Generated annotations remain authoritative");
    expect(inspector).toContain("Pending action:");
    expect(inspector).toContain("Matches action");
    expect(inspector).toContain("supportInstalled && (!catalogReady || integration.supportVersion === catalog.supportVersion)");
    expect(inspector).not.toContain("supportInstalled && catalog && integration.supportVersion === catalog.supportVersion");
    expect(inspector).toContain("Build command catalog");
    expect(inspector).not.toContain("Recent Java project");
    expect(inspector).not.toContain("Export JSON");
    expect(inspector).not.toContain("const COMMANDS =");
    expect(styles).toContain(".cmd-iconbtn{width:40px;height:40px;");
    expect(styles).toContain(".cmd-choice span{height:40px;");
    expect(styles).toContain(".cmd-iconbtn{width:44px;height:44px}.cmd-primary-action{min-height:44px}");
    expect(styles).toContain(".cmd-toggle-input:focus-visible+.cmd-toggle-track");
    expect(styles).toContain(".cmd-choice input:focus-visible+span");
    expect(styles).toContain(".cmd-picker-list{max-height:224px;overflow:auto");
    expect(styles).toContain(".cmd-picker-trigger[aria-expanded=\"true\"]");
    expect(styles).toContain(".cmd-picker-search>input:focus-visible");
    expect(styles).toContain(".cmd-picker-custom input,.cmd-picker-custom button{min-height:44px}");
  });
});
