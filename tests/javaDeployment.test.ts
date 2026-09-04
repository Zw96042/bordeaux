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
