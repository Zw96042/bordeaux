import { describe, expect, it } from "vitest";
import { generateRouteCandidates } from "../src/shared/agent/routeCandidates";
import { createDemoProject } from "../src/shared/project/defaults";

describe("agent route candidates", () => {
  it("generates a bounded set and ranks only planner-scored paths", () => {
    const project = createDemoProject();
    const candidates = generateRouteCandidates(project, {
      intent: "Cross the field efficiently",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "compare",
      maximumCandidates: 3,
      minimumClearanceM: 0.05,
    });
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.analysis.sampleCount > 0)).toBe(true);
    expect(candidates.some((candidate) => candidate.valid)).toBe(true);
    expect(candidates[0].metrics.totalTimeS).toBeGreaterThan(0);
    expect(candidates[0].path.targets).toEqual([]);
    expect(candidates.filter((candidate) => candidate.traversal.startsWith("trench-")).every((candidate) => candidate.analysis.findings.every((finding) => !finding.id.startsWith("geometry:trench-height-unverified")))).toBe(true);
    expect(candidates.find((candidate) => candidate.traversal === "direct")?.valid).toBe(true);
  });

  it("rejects raw coordinates outside the field instead of clamping them", () => {
    const project = createDemoProject();
    expect(() => generateRouteCandidates(project, {
      intent: "Do not rewrite my coordinate",
      alliance: "blue",
      start: { x: -1, y: 1 },
      goals: [{ x: 3, y: 1 }],
    })).toThrow(/never silently clamped/);
  });

  it("certifies a requested trench only when the footprint and height fit", () => {
    const project = createDemoProject();
    const candidates = generateRouteCandidates(project, {
      intent: "Go under the trench",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "trench",
      robotHeightM: 0.5,
      maximumCandidates: 2,
    });
    expect(candidates.some((candidate) => candidate.valid)).toBe(true);
    project.robot.heightM = 0.7;
    expect(() => generateRouteCandidates(project, {
      intent: "Too tall",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "trench",
      robotHeightM: 0.7,
    })).not.toThrow();
    expect(generateRouteCandidates(project, {
      intent: "Too tall",
      alliance: "blue",
      start: { x: 1.5, y: 0.64 },
      goals: [{ x: 7, y: 0.64 }],
      traversal: "trench",
      robotHeightM: 0.5,
    }).every((candidate) => !candidate.valid)).toBe(true);
  });

  it("fits a long narrow rectangle through a portal using its oriented footprint", () => {
    const project = createDemoProject();
    project.robot.l = 1.2;
    project.robot.w = 0.6;
    project.robot.heightM = 0.5;
    const candidates = generateRouteCandidates(project, {
      intent: "Drive the long robot straight under the trench",
      alliance: "blue",
      start: { x: 1.5, y: 0.64, headingDeg: 0 },
      goals: [{ x: 7, y: 0.64, headingDeg: 0 }],
      traversal: "trench",
      maximumCandidates: 2,
    });
    expect(candidates.some((candidate) => candidate.valid), candidates.map((candidate) => candidate.rejectionReason).join("; ")).toBe(true);
  });

  it("requires an actual typed crossing and adds a speed range for every BUMP route", () => {
    const project = createDemoProject();
    const missing = generateRouteCandidates(project, { intent: "Use trench without crossing", alliance: "blue", start: { x: 1, y: 1 }, goals: [{ x: 3, y: 1 }], traversal: "trench", robotHeightM: 0.5 });
    expect(missing.every((candidate) => !candidate.valid && candidate.rejectionReason?.includes("does not cross"))).toBe(true);
    const direct = generateRouteCandidates(project, { intent: "Cross the bump directly", alliance: "blue", start: { x: 1.5, y: 2.59 }, goals: [{ x: 7, y: 2.59 }], traversal: "compare", maximumCandidates: 5 });
    const bumpRoutes = direct.filter((candidate) => candidate.valid && (candidate.traversal.startsWith("bump-") || candidate.traversal === "direct"));
    expect(bumpRoutes.length).toBeGreaterThan(0);
    expect(bumpRoutes.every((candidate) => candidate.path.ranges.some((range) => range.name?.startsWith("BUMP traversal") && range.maxVel <= 2))).toBe(true);
