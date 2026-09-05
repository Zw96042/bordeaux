    const draft = path();
    draft.ranges[0].w0 = 1; draft.ranges[0].w1 = 3;
    duplicateWaypoint(draft, 0);
    expect(draft.ranges[0]).toMatchObject({ w0: 2, w1: 4 });
    removeWaypoint(draft, 2);
    expect(draft.ranges[0]).toMatchObject({ w0: 2, w1: 3 });
    removeWaypoint(draft, 0); removeWaypoint(draft, 0);
    const before = structuredClone(draft);
    removeWaypoint(draft, 0);
    expect(draft).toEqual(before);
  });

  it("shares handle alignment with load normalization without changing already-aligned saved values", () => {
    const project = createDemoProject();
    project.paths[0] = path();
    const waypoint = project.paths[0].waypoints[1];
    waypoint.prevC = { x: 3, y: 3 }; waypoint.nextC = { x: 4, y: 5 };
    alignWaypointHandles(waypoint);
    expect(Math.hypot(waypoint.x - waypoint.prevC.x, waypoint.y - waypoint.prevC.y)).toBeCloseTo(1, 12);
    expect(Math.hypot(waypoint.nextC.x - waypoint.x, waypoint.nextC.y - waypoint.y)).toBeCloseTo(2, 12);
    expect(waypoint).toMatchObject({ linked: true, corner: false });
    const normalized = normalizeProject(project);
    expect(normalized).toMatchObject({ paths: [{ waypoints: [expect.anything(), waypoint, expect.anything(), expect.anything()] }] });
    expect(normalizeProject(normalized)).toEqual(normalized);
  });
});

describe("editor project defaults and routine identity", () => {
  it("uses the shared initial robot/path defaults and selects the generated identities", () => {
    const actual = freshProject(), expected = createDemoProject();
    expect(actual.robot).toEqual(expected.robot);
    expect({ ...actual.paths[0], id: "same" }).toEqual({ ...expected.paths[0], id: "same" });
    expect(actual.editor).toMatchObject({ activePathId: actual.paths[0].id, unitSystem: "metric" });
    expect(actual.activeRoutineId).toBe(actual.routines[0].id);
  });

  it("normalizes routine selection without changing valid routine identity", () => {
    const project = freshProject(), other = blankRoutine("Other");
    const state = routineState({ routines: [project.routines[0], other], activeRoutineId: "missing" });
    expect(state.activeRoutineId).toBe(project.activeRoutineId);
    expect(withRoutineState(project, { ...state, activeRoutineId: other.id }).activeRoutineId).toBe(other.id);
    expect(routineState({ routines: [], activeRoutineId: "missing" }).routines).toHaveLength(1);
  });

  it("uses one case-insensitive suffix policy for paths, routines, and folders", () => {
    expect(uniqueItemName([{ name: "New path" }, { name: "NEW PATH 2" }], "New path")).toBe("New path 3");
    expect(uniqueItemName([{ name: "New folder 2" }], "New folder")).toBe("New folder");
  });
});
