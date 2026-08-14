import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  createRobotRetentionOperation,
  type RobotRetentionTransport,
} from "../src/electron/robotRetention";
import {
  ROBOT_DEPLOYMENT_NAMESPACE,
  ROBOT_PUSH_PROTOCOL_VERSION,
  type RobotPairing,
  type RobotRuntimeStatus,
} from "../src/electron/robotSftpTransport";

const currentRevision = `sha256:${"a".repeat(64)}`;
const currentPayload = `sha256:${"b".repeat(64)}`;
const retainedRevision = `sha256:${"c".repeat(64)}`;
const retainedPayload = `sha256:${"d".repeat(64)}`;

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
  return {
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
    teamNumber: pairing.teamNumber,
    runtimeId: pairing.runtimeId,
    disabled: true,
    catalogId: "competition-robot",
    catalogHash: `sha256:${"e".repeat(64)}`,
    supportVersion: "0.1.0",
    fieldId: "frc-2026-rebuilt",
    fieldRevision: "official-2026.1",
    fieldCoordinateSchemaId: "wpilib-blue-origin-v1",
    activeRevisionId: currentRevision,
    activePayloadSha256: currentPayload,
    health: ["ready"],
    retention: {
      recentLimit: 5,
      revisions: [
        { revisionId: currentRevision, payloadSha256: currentPayload, availability: "retained", pinned: false },
        { revisionId: retainedRevision, payloadSha256: retainedPayload, availability: "retained", pinned: false },
      ],
    },
    ...overrides,
  };
}

describe("robot retention operation", () => {
  it("refreshes retention history on every paired dialog open and after accepted changes", () => {
    const dialog = fs.readFileSync(new URL("../src/renderer/components/RobotPushDialog.jsx", import.meta.url), "utf8");
    expect(dialog).toContain("if (open && pairing) void inspectRetention();");
    expect(dialog).toContain("setRetentionStatus(null); setLocalRevisionId(null);");
    expect(dialog).toContain("if (finished.state === 'active') {");
    expect(dialog).toContain("finished.state === 'active' || finished.state === 'pinned'");
  });

  it("reviews immutable rollback control bytes and only confirms the exact reviewed target", async () => {
    const operation = createRobotRetentionOperation({
      operationId: "retention-1",
      action: "rollback",
      pairing,
      status: status(),
      target: { revisionId: retainedRevision, payloadSha256: retainedPayload },
      nonce: "retention-1",
    });
    expect(operation.preview).toEqual({
      operationId: "retention-1",
      state: "review",
      action: "rollback",
      robot: "Team 2468 · 10.24.68.2:22",
      activeRevision: currentRevision,
      targetRevision: retainedRevision,
      payloadHash: retainedPayload,
      catalog: "competition-robot",
      transport: "SFTP over SSH",
    });
    expect(operation.contents).toBe(JSON.stringify({
      protocolVersion: "bordeaux-retention/1.0",
      action: "rollback",
      nonce: "retention-1",
      expectedActiveRevisionId: currentRevision,
      target: { revisionId: retainedRevision, payloadSha256: retainedPayload },
    }));

    let staged: Buffer | null = null;
    const states: string[] = [];
    const transport: RobotRetentionTransport = {
      inspect: async () => status(),
      stageRetention: async (_pairing, _credentials, control, options) => {
        staged = Buffer.from(control.contents);
        options.onState?.("uploaded");
        options.onState?.("staged");
        return { state: "staged", nonce: control.nonce, sha256: control.sha256, size: control.contents.length };
      },
      waitForRetention: async (_pairing, _credentials, expected) => ({
        state: "active",
        acknowledgement: {
          protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
          state: "active",
          action: "rollback",
          nonce: expected.nonce,
          revisionId: retainedRevision,
          payloadSha256: retainedPayload,
          catalogId: "competition-robot",
          catalogHash: `sha256:${"e".repeat(64)}`,
          supportVersion: "0.1.0",
          runtimeId: pairing.runtimeId,
          teamNumber: pairing.teamNumber,
        },
      }),
    };

    await expect(operation.execute(transport, (progress) => states.push(progress.state))).resolves.toMatchObject({ state: "active" });
    expect(staged).toEqual(Buffer.from(operation.contents));
    expect(states).toEqual(["uploaded", "staged", "active"]);
  });

  it.each([
    ["enabled", { disabled: false }, /disabled/i],
    ["unsupported", { retention: undefined }, /retention/i],
    ["missing", { retention: { recentLimit: 5, revisions: [{ revisionId: retainedRevision, payloadSha256: retainedPayload, availability: "missing", pinned: false }] } }, /missing/i],
  ])("rejects a %s target before it can be reviewed", (_name, overrides, message) => {
    expect(() => createRobotRetentionOperation({
      operationId: "retention-1",
      action: "rollback",
      pairing,
      status: status(overrides as Partial<RobotRuntimeStatus>),
      target: { revisionId: retainedRevision, payloadSha256: retainedPayload },
      nonce: "retention-1",
    })).toThrow(message);
  });

  it("does not stage stale state and keeps rejected or unconfirmed retention distinct", async () => {
    const operation = createRobotRetentionOperation({
      operationId: "retention-1",
      action: "pin",
      pairing,
      status: status(),
      target: { revisionId: retainedRevision, payloadSha256: retainedPayload },
      nonce: "retention-1",
    });
    let staged = false;
    const transport: RobotRetentionTransport = {
      inspect: async () => status({ activeRevisionId: retainedRevision, activePayloadSha256: retainedPayload }),
      stageRetention: async () => {
        staged = true;
        throw new Error("unexpected stage");
      },
      waitForRetention: async () => { throw new Error("unexpected wait"); },
    };
    await expect(operation.execute(transport)).rejects.toThrow(/active revision changed/i);
    expect(staged).toBe(false);

    transport.inspect = async () => status();
    transport.stageRetention = async (_pairing, _credentials, control, options) => {
      options.onState?.("staged");
      return { state: "staged", nonce: control.nonce, sha256: control.sha256, size: control.contents.length };
    };
    transport.waitForRetention = async () => ({
      state: "rejected",
      acknowledgement: {
        protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
        nonce: "retention-1",
        state: "rejected",
        boundary: "retention",
        message: "Robot became enabled",
        runtimeId: pairing.runtimeId,
        teamNumber: pairing.teamNumber,
      },
    });
    await expect(operation.execute(transport)).resolves.toMatchObject({ state: "rejected", boundary: "retention" });
    transport.waitForRetention = async () => ({ state: "staged", boundary: "acknowledgement", message: "Timed out" });
    await expect(operation.execute(transport)).resolves.toMatchObject({ state: "staged", boundary: "acknowledgement" });
  });
});
