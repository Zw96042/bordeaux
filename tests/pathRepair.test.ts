import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";

const analyzePath = vi.hoisted(() => vi.fn());

vi.mock("../src/shared/agent/pathAnalysis", () => ({ analyzePath }));

import { generateRepairCandidates } from "../src/shared/agent/pathRepair";

describe("path repair ranking", () => {
  beforeEach(() => analyzePath.mockReset());

  it("never accepts a target finding that worsens from a warning to an error", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 1, y: 1 },
      { x: 4, y: 4 },
      { x: 7, y: 1 },
    ]);
    const finding = {
      id: "geometry:field-obstacle-clearance",
      severity: "warning",
      kind: "geometry",
      measured: 0,
      limit: 0.15,
      sample: { nearestWaypointIndex: 1 },
    };
    analyzePath
      .mockReturnValueOnce({ findings: [finding] })
      .mockReturnValue({ findings: [{ ...finding, severity: "error", measured: -0.01 }] });

    const candidates = generateRepairCandidates(project, path.id, [finding.id], 0.15);

    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => !candidate.valid)).toBe(true);
    expect(candidates.every((candidate) => candidate.rejectionReason === "The target finding did not improve by at least 25%.")).toBe(true);
  });
});
