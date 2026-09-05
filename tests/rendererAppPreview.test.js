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

  it("requests a maximum-size insertion preview without deriving synchronously", () => {
    const project = createDemoProject();
    const path = structuredClone(project.paths[0]);
    path.waypoints = buildWaypoints(Array.from({ length: 4_096 }, (_, index) => ({
      x: 1 + index * 0.003,
      y: 4,
    })));
    const request = { doc: path, message: "Review insertion" };
    const previewer = { request: vi.fn(() => 7) };
    const derivePath = vi.spyOn(PM, "derivePath");

    try {
      expect(requestWaypointPreview(previewer, request, project.robot, project.plannerId)).toBe(7);
      expect(previewer.request).toHaveBeenCalledWith({
        key: request,
        path,
        robot: project.robot,
        plannerId: project.plannerId,
        quality: "final",
      });
      expect(derivePath).not.toHaveBeenCalled();
    } finally {
      derivePath.mockRestore();
    }
  });

  it("accepts only the exact insertion preview request", () => {
    const request = { doc: { id: "candidate" }, message: "Review insertion" };
    const stale = { doc: request.doc, message: "Older insertion" };
    const derived = { sample: { pts: [] } };
    const error = { message: "preview failed" };

    expect(waypointPreviewResult({ status: "ready", key: stale, path: request.doc, value: derived }, request)).toMatchObject({ pending: true, derived: null });
    expect(waypointPreviewResult({ status: "pending", key: request, path: request.doc, value: derived }, request)).toMatchObject({ pending: true, derived: null });
    expect(waypointPreviewResult({ status: "ready", key: request, path: request.doc, value: derived }, request)).toMatchObject({ pending: false, derived });
    expect(waypointPreviewResult({ status: "error", errorKey: request, errorPath: request.doc, error }, request)).toMatchObject({ pending: false, derived: null, error });
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


describe("late path edits", () => {
  it("preserves path identities when an edit finishes after selecting another path", () => {
    const source = { ...createDemoProject().paths[0], id: "source", name: "Opening move" };
    const destination = { ...structuredClone(source), id: "destination", name: "Collect second" };
    const project = { ...createDemoProject(), paths: [source, destination], pathLinks: [], editor: { activePathId: destination.id } };
    const edited = structuredClone(source);
    edited.waypoints[1].x += 0.25;
    const next = replaceEditedPath(project, edited);
    expect(next.paths.map((item) => item.id)).toEqual(["source", "destination"]);
    expect(next.paths[0]).toEqual(edited);
    expect(next.paths[1]).toBe(destination);
    expect(next.editor.activePathId).toBe(destination.id);
    const reordered = replaceEditedPath({ ...project, paths: [destination, source] }, edited);
    expect(reordered.paths[0]).toBe(destination);
    expect(reordered.paths[1]).toEqual(edited);
    expect(replaceEditedPath(project, { ...edited, id: "removed" })).toBe(project);
  });
});
