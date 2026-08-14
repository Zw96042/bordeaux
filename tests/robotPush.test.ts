import { describe, expect, it } from "vitest";
import { createRobotPushOperation, type RobotPushTransport } from "../src/electron/robotPush";
import {
  ROBOT_DEPLOYMENT_NAMESPACE,
  ROBOT_PUSH_PROTOCOL_VERSION,
  type RobotPairing,
  type RobotRuntimeStatus,
} from "../src/electron/robotSftpTransport";
import { buildJavaTrajectory } from "../src/shared/export/javaTrajectory";
import { createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog } from "../src/shared/types";

const catalog: JavaCommandCatalog = {
  projectName: "CompetitionRobot",
  sourceFileCount: 1,
  scannedAt: "2026-08-14T00:00:00.000Z",
  source: "generated",
  runtimeCommandCount: 0,
  generatedSchemaVersion: "1.0",
  catalogId: "competition-robot",
  supportVersion: "0.1.0",
  catalogHash: `sha256:${"a".repeat(64)}`,
  authoritative: true,
  warnings: [],
  commands: [],
};

const pairing: RobotPairing = {
  id: "robot-2468-a0d7440d",
  teamNumber: 2468,
  endpoint: { host: "10.24.68.2", port: 22 },
  hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
  runtimeId: "a0d7440d-d346-4ae4-a58b-7efd622b71d0",
  protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
  deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
  pairedAt: "2026-08-14T00:00:00.000Z",
};

function status(overrides: Partial<RobotRuntimeStatus> = {}): RobotRuntimeStatus {
  const field = createDemoProject().field!;
  return {
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
    teamNumber: pairing.teamNumber,
    runtimeId: pairing.runtimeId,
    disabled: true,
    catalogId: catalog.catalogId!,
    catalogHash: catalog.catalogHash!,
    supportVersion: catalog.supportVersion!,
    fieldId: field.id,
    fieldRevision: field.revision,
    fieldCoordinateSchemaId: field.coordinateSchemaId,
    activeRevisionId: null,
    activePayloadSha256: null,
    health: ["ready: no active Bordeaux revision"],
    ...overrides,
  };
}

describe("manual robot push operation", () => {
  it("builds an immutable review preview with every required identity", () => {
    const trajectory = buildJavaTrajectory(createDemoProject(), catalog);
    const operation = createRobotPushOperation({
      operationId: "operation-1",
      nonce: "push-1",
      projectName: "Center Auto",
      pairing,
      status: status(),
      trajectory,
    });

    expect(operation.preview).toEqual({
      operationId: "operation-1",
      state: "review",
      robot: "Team 2468 · 10.24.68.2:22",
      project: "Center Auto",
      catalog: "competition-robot",
      revision: operation.revision.revisionId,
      payloadHash: `sha256:${trajectory.sha256}`,
      size: Buffer.byteLength(operation.revision.contents, "utf8"),
      transport: "SFTP over SSH",
    });
    expect(operation.revision.document.activation).toEqual({ nonce: "push-1", expectedActiveRevisionId: null });
  });

  it.each([
    ["enabled robot", { disabled: false }, /disabled/i],
    ["catalog", { catalogHash: `sha256:${"b".repeat(64)}` }, /catalog/i],
    ["field", { fieldRevision: "different-field" }, /field/i],
  ])("rejects an incompatible %s before creating a review", (_name, overrides, message) => {
    expect(() => createRobotPushOperation({
      operationId: "operation-1",
      nonce: "push-1",
      projectName: "Center Auto",
      pairing,
      status: status(overrides as Partial<RobotRuntimeStatus>),
      trajectory: buildJavaTrajectory(createDemoProject(), catalog),
    })).toThrow(message);
  });

  it("reports uploaded, staged, then active without rebuilding the reviewed bytes", async () => {
    const operation = createRobotPushOperation({
      operationId: "operation-1",
      nonce: "push-1",
      projectName: "Center Auto",
      pairing,
      status: status(),
      trajectory: buildJavaTrajectory(createDemoProject(), catalog),
    });
    const states: string[] = [];
    let stagedBytes: Buffer | null = null;
    const transport: RobotPushTransport = {
      inspect: async () => status(),
      stageRevision: async (_pairing, _credentials, revision, options) => {
        stagedBytes = Buffer.from(revision.contents);
        options.onState?.("uploaded");
        options.onState?.("staged");
        return { state: "staged", nonce: revision.nonce, sha256: revision.sha256, size: revision.contents.length };
      },
      waitForActivation: async (_pairing, _credentials, expected) => ({
        state: "active",
        acknowledgement: {
          protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
          state: "active",
          ...expected,
          runtimeId: pairing.runtimeId,
          teamNumber: pairing.teamNumber,
        },
      }),
    };

    const result = await operation.execute(transport, (progress) => states.push(progress.state));

    expect(states).toEqual(["uploaded", "staged", "active"]);
    expect(result.state).toBe("active");
    expect(stagedBytes).toEqual(Buffer.from(operation.revision.contents, "utf8"));
  });

  it("does not collapse a rejection or missing acknowledgment into active", async () => {
    const operation = createRobotPushOperation({
      operationId: "operation-1",
      nonce: "push-1",
      projectName: "Center Auto",
      pairing,
      status: status(),
      trajectory: buildJavaTrajectory(createDemoProject(), catalog),
    });
    const transport: RobotPushTransport = {
      inspect: async () => status(),
      stageRevision: async (_pairing, _credentials, revision, options) => {
        options.onState?.("staged");
        return { state: "staged", nonce: revision.nonce, sha256: revision.sha256, size: revision.contents.length };
      },
      waitForActivation: async () => ({
        state: "rejected",
        acknowledgement: {
          protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
          nonce: "push-1",
          state: "rejected",
          boundary: "activation",
          message: "Robot became enabled",
          runtimeId: pairing.runtimeId,
          teamNumber: pairing.teamNumber,
        },
      }),
    };

    await expect(operation.execute(transport)).resolves.toMatchObject({ state: "rejected", boundary: "activation" });
    transport.waitForActivation = async () => ({
      state: "rejected",
      acknowledgement: {
        protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
        nonce: "push-1",
        state: "rejected",
        boundary: "mailbox",
        message: "A retention control already uses this nonce",
        runtimeId: pairing.runtimeId,
        teamNumber: pairing.teamNumber,
      },
    });
    await expect(operation.execute(transport)).resolves.toMatchObject({ state: "rejected", boundary: "mailbox" });
    transport.waitForActivation = async () => ({
      state: "staged",
      boundary: "acknowledgement",
      message: "Acknowledgment timed out",
    });
    await expect(operation.execute(transport)).resolves.toMatchObject({ state: "staged", boundary: "acknowledgement" });
  });
});
