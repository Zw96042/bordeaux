import { describe, expect, it } from "vitest";
import { analyzePath } from "../src/shared/agent/pathAnalysis";
import { createDemoProject, buildWaypoints } from "../src/shared/project/defaults";
import { REBUILT_2026_CROSSINGS } from "../src/shared/field/rebuilt2026";

describe("agent path analysis", () => {
  it("returns bounded raw samples, extrema, and source references from the shared planner", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    const analysis = analyzePath(project, path.id, { sampleLimit: 80 });
    expect(analysis.totalTimeS).toBeGreaterThan(0);
    expect(analysis.sampleCount).toBeGreaterThan(1);
    expect(analysis.rawSamples.length).toBeLessThanOrEqual(80);
    expect(analysis.extrema.map((item) => item.metric)).toContain("velocity");
    expect(analysis.extrema[0].sample.nearestWaypointIndex).toBeGreaterThanOrEqual(0);
  });

  it("reports a measured robot-footprint collision without mutating the authored path", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([{ x: 3.5, y: 4 }, { x: 4.6, y: 4 }, { x: 6, y: 4 }]);
    const before = JSON.stringify(path);
    const analysis = analyzePath(project, path.id, { minimumClearanceM: 0.1 });
    const finding = analysis.findings.find((item) => item.id === "geometry:field-obstacle-clearance");
    expect(finding?.severity).toBe("error");
    expect(finding?.sample?.timeS).toBeTypeOf("number");
    expect(JSON.stringify(path)).toBe(before);
  });

  it("rejects a path endpoint touching an alliance barrier outside a typed portal", () => {
    const project = createDemoProject();
    const barrierX = REBUILT_2026_CROSSINGS.blue.trenchAway.x;
    const path = project.paths[0];
    path.waypoints = buildWaypoints([{ x: barrierX - 0.1, y: 1.8 }, { x: barrierX - 0.1, y: 2 }]);
    const analysis = analyzePath(project, path.id);
    expect(analysis.findings.some((finding) => finding.id.startsWith("geometry:illegal-barrier-touches") && finding.severity === "error")).toBe(true);
  });
});
