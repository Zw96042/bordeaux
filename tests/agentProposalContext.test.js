import { describe, expect, it } from "vitest";
import { agentProposalMatchesPublishedContext, freshProject } from "../src/renderer/app/App";
import { buildBdxExport } from "../src/shared/export/bdx";
import { createDemoProject } from "../src/shared/project/defaults";
import { validateProject } from "../src/shared/validation";

describe("renderer agent proposal context", () => {
  it("creates an immediately exportable project with the active field reference", () => {
    const project = freshProject();

    expect(validateProject(project)).toEqual({ ok: true, issues: [] });
    expect(project.field).toEqual(createDemoProject().field);
    expect(() => buildBdxExport(project)).not.toThrow();
  });

  it("does not bless an unpublished project that keeps the same revision and active path", () => {
    const publishedProject = { name: "Published project" };
    const published = { revision: 4, project: publishedProject, activePathId: "path_a", editRevision: 8 };
    const proposal = {
      baseSessionId: "session_a",
      baseRevision: 4,
      baseActivePathId: "path_a",
      baseJavaCatalogFingerprint: "catalog_a",
    };
    const current = {
      project: publishedProject,
      activePathId: "path_a",
      editRevision: 8,
      javaCatalogFingerprint: "catalog_a",
      hasDraft: false,
    };

    expect(agentProposalMatchesPublishedContext(proposal, "session_a", published, current)).toBe(true);
    expect(agentProposalMatchesPublishedContext(proposal, "session_a", published, {
      ...current,
      project: { name: "Opened before delayed publication" },
    })).toBe(false);
    expect(agentProposalMatchesPublishedContext({ ...proposal, baseActivePathId: "path_b" }, "session_a", published, current)).toBe(false);
    expect(agentProposalMatchesPublishedContext(proposal, "session_a", published, { ...current, javaCatalogFingerprint: "catalog_b" })).toBe(false);
  });
});
