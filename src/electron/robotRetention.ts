import { createHash } from "node:crypto";
import type {
  RobotCredentials,
  RobotPairing,
  RobotRetentionAction,
  RobotRetentionExpectation,
  RobotRetentionResult,
  RobotRuntimeStatus,
} from "./robotSftpTransport";

export interface RobotRetentionPreview {
  operationId: string;
  state: "review";
  action: RobotRetentionAction;
  robot: string;
  activeRevision: string | null;
  targetRevision: string;
  payloadHash: string;
  catalog: string;
  transport: "SFTP over SSH";
}

export type RobotRetentionProgress =
  | { operationId: string; state: "uploaded" | "staged" }
  | { operationId: string; state: "active" | "pinned" }
  | { operationId: string; state: "rejected"; boundary: "retention" | "mailbox"; message: string };

export type RobotRetentionOperationResult =
  | { operationId: string; state: "active" | "pinned"; acknowledgement: Extract<RobotRetentionResult, { state: "active" | "pinned" }> ["acknowledgement"] }
  | { operationId: string; state: "rejected"; boundary: "retention" | "mailbox"; message: string }
  | { operationId: string; state: "staged"; boundary: "acknowledgement"; message: string };

export interface RobotRetentionTransport {
  inspect(pairing: RobotPairing, credentials: RobotCredentials, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<RobotRuntimeStatus>;
  stageRetention(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    control: { nonce: string; contents: Buffer; sha256: string },
    options: { signal?: AbortSignal; timeoutMs?: number; onState?: (state: "uploaded" | "staged") => void },
  ): Promise<{ state: "staged"; nonce: string; sha256: string; size: number }>;
  waitForRetention(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    expected: RobotRetentionExpectation,
    options?: { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<RobotRetentionResult>;
}

export interface RobotRetentionOperation {
  readonly preview: RobotRetentionPreview;
  readonly contents: string;
  execute(
    transport: RobotRetentionTransport,
    onProgress?: (progress: RobotRetentionProgress) => void,
    options?: { signal?: AbortSignal },
  ): Promise<RobotRetentionOperationResult>;
}

interface RobotRetentionInput {
  operationId: string;
  nonce: string;
  action: RobotRetentionAction;
  pairing: RobotPairing;
  status: RobotRuntimeStatus;
  target: { revisionId: string; payloadSha256: string };
}

function assertOperationId(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error("Robot retention operation ID is invalid");
}

function assertRuntimeMatches(
  status: RobotRuntimeStatus,
  pairing: RobotPairing,
  expected: { activeRevisionId: string | null; activePayloadSha256: string | null; catalogId: string; catalogHash: string; supportVersion: string },
  target: { revisionId: string; payloadSha256: string },
): void {
  if (status.teamNumber !== pairing.teamNumber || status.runtimeId !== pairing.runtimeId) {
    throw new Error("The paired robot identity changed; explicitly re-pair it before changing retention");
  }
  if (!status.disabled) throw new Error("The robot must be disabled before Bordeaux can change revision retention");
  if (!status.retention) throw new Error("This paired runtime does not support Bordeaux revision retention");
  if (status.catalogId !== expected.catalogId || status.catalogHash !== expected.catalogHash || status.supportVersion !== expected.supportVersion) {
    throw new Error("The robot command catalog or Bordeaux support version changed; review retention again");
  }
  if (status.activeRevisionId !== expected.activeRevisionId || status.activePayloadSha256 !== expected.activePayloadSha256) {
    throw new Error("The robot active revision changed; prepare and review retention again");
  }
  const remoteTarget = status.retention.revisions.find((entry) => entry.revisionId === target.revisionId);
  if (!remoteTarget || remoteTarget.payloadSha256 !== target.payloadSha256) {
    throw new Error("The reviewed retained revision changed; prepare and review retention again");
  }
  if (remoteTarget.availability !== "retained") throw new Error("The reviewed revision is missing on the robot and cannot be changed");
}

export function createRobotRetentionOperation(input: RobotRetentionInput): RobotRetentionOperation {
  assertOperationId(input.operationId);
  assertOperationId(input.nonce);
  if (input.action !== "rollback" && input.action !== "pin") throw new Error("Robot retention action is invalid");
  const expected = {
    activeRevisionId: input.status.activeRevisionId,
    activePayloadSha256: input.status.activePayloadSha256,
    catalogId: input.status.catalogId,
    catalogHash: input.status.catalogHash,
    supportVersion: input.status.supportVersion,
  };
  assertRuntimeMatches(input.status, input.pairing, expected, input.target);
  const contents = JSON.stringify({
    protocolVersion: "bordeaux-retention/1.0",
    action: input.action,
    nonce: input.nonce,
    expectedActiveRevisionId: expected.activeRevisionId,
    target: { revisionId: input.target.revisionId, payloadSha256: input.target.payloadSha256 },
  });
  const sha256 = createHash("sha256").update(contents, "utf8").digest("hex");
  const retentionExpectation: RobotRetentionExpectation = {
    nonce: input.nonce,
    action: input.action,
    expectedActiveRevisionId: expected.activeRevisionId,
    target: { ...input.target },
    catalogId: expected.catalogId,
    catalogHash: expected.catalogHash,
    supportVersion: expected.supportVersion,
  };
  const preview: RobotRetentionPreview = {
    operationId: input.operationId,
    state: "review",
    action: input.action,
    robot: `Team ${input.pairing.teamNumber} · ${input.pairing.endpoint.host}:${input.pairing.endpoint.port}`,
    activeRevision: expected.activeRevisionId,
    targetRevision: input.target.revisionId,
    payloadHash: input.target.payloadSha256,
    catalog: expected.catalogId,
    transport: "SFTP over SSH",
  };

  return {
    preview,
    contents,
    async execute(transport, onProgress = () => undefined, options = {}) {
      const credentials = { password: "" };
      const latest = await transport.inspect(input.pairing, credentials, { signal: options.signal });
      assertRuntimeMatches(latest, input.pairing, expected, input.target);
      await transport.stageRetention(input.pairing, credentials, {
        nonce: input.nonce,
        contents: Buffer.from(contents, "utf8"),
        sha256,
      }, {
        signal: options.signal,
        onState: (state) => onProgress({ operationId: input.operationId, state }),
      });
      const result = await transport.waitForRetention(input.pairing, credentials, retentionExpectation, { signal: options.signal });
      if (result.state === "active" || result.state === "pinned") {
        onProgress({ operationId: input.operationId, state: result.state });
        return { operationId: input.operationId, state: result.state, acknowledgement: result.acknowledgement };
      }
      if (result.state === "rejected") {
        const rejected = {
          operationId: input.operationId,
          state: "rejected" as const,
          boundary: result.acknowledgement.boundary as "retention" | "mailbox",
          message: result.acknowledgement.message,
        };
        onProgress(rejected);
        return rejected;
      }
      return { operationId: input.operationId, ...result };
    },
  };
}
