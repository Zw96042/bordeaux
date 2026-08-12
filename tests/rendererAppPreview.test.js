import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App, routinePreviewResult, selectedAgentProposalPreview } from "../src/renderer/app/App";
import { PathPreview } from "../src/renderer/assets/path-preview";
import { PM } from "../src/renderer/lib/pathMath";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";

describe("renderer app path preview lifecycle", () => {
  it("waits for the worker instead of rendering a profiled fallback for optimized mode", () => {
    const project = createDemoProject();
    project.plannerId = "optimizedTrajectory";
    const derivePath = vi.spyOn(PM, "derivePath");

    try {
      const html = renderToString(React.createElement(App, { initialProject: project }));

      expect(html).toContain("Preparing path preview");
      expect(derivePath).not.toHaveBeenCalled();
    } finally {
      derivePath.mockRestore();
    }
  });

  it("never presents a routine run derived from stale inputs", () => {
    const currentRequest = {};
    const staleRequest = {};
    const staleRun = { steps: [{ id: "old" }], segs: [], total: 4 };

    expect(routinePreviewResult({ path: staleRequest, value: staleRun }, currentRequest, true)).toMatchObject({
      run: { steps: [], segs: [], total: 0 },
      pending: true,
      error: null,
    });
    expect(routinePreviewResult({ path: currentRequest, value: staleRun }, currentRequest, true)).toMatchObject({
      run: staleRun,
      pending: false,
      error: null,
    });
    const error = { message: "routine failed" };
    expect(routinePreviewResult({ errorPath: currentRequest, error }, currentRequest, true)).toMatchObject({
      run: { steps: [], segs: [], total: 0 },
      pending: false,
      error,
    });
  });

  it("does not derive even a small path during initial render", () => {
    const project = createDemoProject();
    const derivePath = vi.spyOn(PM, "derivePath");

    try {
      const html = renderToString(React.createElement(App, { initialProject: project }));

      expect(html).toContain("Preparing path preview");
      expect(derivePath).not.toHaveBeenCalled();
    } finally {
      derivePath.mockRestore();
    }
  });

  it("shows only the selected candidate after its exact worker result arrives", () => {
    const selected = { id: "candidate_a", label: "Candidate A", valid: true, path: { id: "path_a" } };
    const stale = { id: "candidate_b", label: "Candidate B", valid: true, path: { id: "path_b" } };
    const derived = { sample: { pts: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } };
    const request = {};

    expect(selectedAgentProposalPreview({ key: request, path: stale.path, value: derived }, selected, request)).toEqual([]);
    expect(selectedAgentProposalPreview({ key: {}, path: selected.path, value: derived }, selected, request)).toEqual([]);
    expect(selectedAgentProposalPreview({ key: request, path: selected.path, value: derived }, selected, request)).toEqual([{
      id: selected.id,
      label: selected.label,
      selected: true,
      valid: true,
      derived,
    }]);
  });

  it("does not derive maximum-size proposal candidates during render", () => {
    const project = createDemoProject();
    const candidatePath = structuredClone(project.paths[0]);
    candidatePath.headingMode = "tangent";
    candidatePath.targets = [];
    candidatePath.ranges = [];
    candidatePath.waypoints = buildWaypoints(Array.from({ length: 4_096 }, (_, index) => ({
      x: 1 + index * 0.003,
      y: 4,
    })));
    const proposal = {
      id: "proposal",
      operation: "replace",
      status: "ready",
      intent: "Repair path",
      recommendationReason: "Candidate A",
      recommendedCandidateId: "candidate_a",
      candidates: Array.from({ length: 4 }, (_, index) => ({
        id: `candidate_${index}`,
        label: `Candidate ${index}`,
        valid: true,
        path: structuredClone(candidatePath),
      })),
    };
    const derivePath = vi.spyOn(PM, "derivePath");

    try {
      renderToString(React.createElement(App, { initialProject: project, initialAgentProposal: proposal }));
      expect(derivePath).not.toHaveBeenCalled();
    } finally {
      derivePath.mockRestore();
    }
  });

  it("renders a pending state for an 890-waypoint path without deriving during render", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.targets = [];
    path.ranges = [];
    path.waypoints = buildWaypoints(Array.from({ length: 890 }, (_, index) => ({
      x: 1 + index * 0.01,
      y: 4,
    })));
    expect(PathPreview.directPreviewIsSafe(path, 14)).toBe(false);
    const derivePath = vi.spyOn(PM, "derivePath");

    try {
      const html = renderToString(React.createElement(App, { initialProject: project }));

      expect(html).toContain("Preparing path preview");
      expect(derivePath).not.toHaveBeenCalled();
    } finally {
      derivePath.mockRestore();
    }
  });
});
