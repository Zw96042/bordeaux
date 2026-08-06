import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentBridgeClient, AgentBridgeServer } from "../src/electron/agentBridge";
import { AgentSessionService } from "../src/electron/agentSession";
import { createDemoProject } from "../src/shared/project/defaults";

function snapshot(revision = 0) {
  const project = createDemoProject();
  return {
    sessionId: "session_test",
    revision,
    project,
    plannerId: "profiledSpline" as const,
    activePathId: project.paths[0].id,
    allianceView: "blue" as const,
    fieldPack: { id: "2026-rebuilt" as const, revision: "test" },
  };
}

describe("agent session and private bridge", () => {
  it("stages proposals without changing the renderer snapshot and marks them stale on edit", async () => {
    const staged: any[] = [];
    const service = new AgentSessionService((proposal) => { staged.push(proposal); }, () => null);
    const initial = snapshot();
    service.publishSnapshot(initial);
    const proposal: any = await service.request({ method: "plan_path", params: { intent: "Go forward", alliance: "blue", start: { x: 1, y: 1 }, goals: [{ x: 3, y: 1 }], maximumCandidates: 1 } });
    expect(staged).toHaveLength(1);
    expect(service.getActiveProposal()?.id).toBe(proposal.id);
    expect(initial.project.paths).toHaveLength(1);
    service.publishSnapshot({ ...initial, revision: 1 });
    expect(service.getActiveProposal()).toBeNull();
    const stale: any = await service.request({ method: "get_proposal", params: { proposalId: proposal.id } });
    expect(stale.status).toBe("stale");

    const nextSession = { ...initial, sessionId: "session_reopened", revision: 0 };
    service.publishSnapshot(nextSession);
    expect((await service.request({ method: "get_proposal", params: { proposalId: proposal.id } }) as any).status).toBe("stale");
  });

  it("does not retain a ready proposal when the editor cannot receive it", async () => {
    const service = new AgentSessionService(() => { throw new Error("editor closed"); }, () => null);
    service.publishSnapshot(snapshot());
    await expect(service.request({ method: "plan_path", params: { intent: "Go", alliance: "blue", goals: [{ x: 3, y: 1 }], maximumCandidates: 1 } })).rejects.toThrow("editor closed");
    service.clearSnapshot();
    await expect(service.request({ method: "inspect_session" })).rejects.toThrow(/finish loading/);
  });

  it("waits for a renderer receipt before returning a ready proposal", async () => {
    let acknowledge: (() => void) | undefined;
    const service = new AgentSessionService((_proposal, requireReceipt) => requireReceipt ? new Promise<void>((resolve) => { acknowledge = resolve; }) : undefined, () => null);
    service.publishSnapshot(snapshot());
    let completed = false;
    const pending = service.request({ method: "plan_path", params: { intent: "Wait for preview", alliance: "blue", start: { x: 1, y: 1 }, goals: [{ x: 3, y: 1 }], maximumCandidates: 1 } }).then((value) => { completed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);
    acknowledge?.();
    expect((await pending as any).status).toBe("ready");
  });

  it("keeps only the newest proposal ready for the single preview surface", async () => {
    const service = new AgentSessionService(() => {}, () => null);
    service.publishSnapshot(snapshot());
    const first: any = await service.request({ method: "plan_path", params: { intent: "First", alliance: "blue", start: { x: 1, y: 1 }, goals: [{ x: 2, y: 1 }], maximumCandidates: 1 } });
    const second: any = await service.request({ method: "plan_path", params: { intent: "Second", alliance: "blue", start: { x: 1, y: 1 }, goals: [{ x: 3, y: 1 }], maximumCandidates: 1 } });
    expect(second.status).toBe("ready");
    expect((await service.request({ method: "get_proposal", params: { proposalId: first.id } }) as any).status).toBe("stale");
  });

  it("interviews for missing robot facts and stages profile answers without mutating the snapshot", async () => {
    const staged: any[] = [];
    const service = new AgentSessionService((proposal) => { staged.push(proposal); }, () => null);
    const initial = snapshot();
    service.publishSnapshot(initial);
    const inspection: any = await service.request({ method: "inspect_robot_profile" });
    expect(inspection.completeForFuelCollection).toBe(false);
    expect(inspection.questions.join(" ")).toContain("maximum safe collection speed");
    const planning = {
      intake: { name: "Front intake", centerM: { x: 0.42, y: 0 }, directionDeg: 0, captureWidthM: 0.72, maxCollectSpeedMps: 2 },
      shooter: { directionDeg: 0, requiresTargetFacing: true, preferredRangeM: 2.5 },
      notes: "Keep the intake down throughout the collection span.",
    };
    const proposal: any = await service.request({ method: "propose_robot_profile", params: { intent: "Use the team's mechanism details", planning } });
    expect(proposal).toMatchObject({ operation: "configureRobot", planning, status: "ready" });
    expect(staged).toHaveLength(1);
    expect(initial.project.robot.planning).toBeUndefined();
    service.publishSnapshot({ ...initial, revision: 1 });
    expect((await service.request({ method: "get_proposal", params: { proposalId: proposal.id } }) as any).status).toBe("stale");
  });
