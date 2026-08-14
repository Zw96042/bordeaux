import type { BuiltJavaRevision } from "../shared/export/javaRevision";
import { buildJavaRevision } from "../shared/export/javaRevision";
import type { BuiltJavaTrajectory } from "../shared/export/javaTrajectory";
import type {
  RobotActivationExpectation,
  RobotActivationResult,
  RobotCredentials,
  RobotPairing,
  RobotRuntimeStatus,
} from "./robotSftpTransport";

export interface RobotPushPreview {
  operationId: string;
  state: "review";
  robot: string;
  project: string;
  catalog: string;
  revision: string;
  payloadHash: string;
  size: number;
  transport: "SFTP over SSH";
}

export type RobotPushProgress =
  | { operationId: string; state: "uploaded" | "staged" }
  | { operationId: string; state: "active" }
  | { operationId: string; state: "rejected"; boundary: "activation"; message: string };

export type RobotPushResult =
  | { operationId: string; state: "active"; acknowledgement: Extract<RobotActivationResult, { state: "active" }>["acknowledgement"] }
  | { operationId: string; state: "rejected"; boundary: "activation"; message: string }
  | { operationId: string; state: "staged"; boundary: "acknowledgement"; message: string };

export interface RobotPushTransport {
  inspect(pairing: RobotPairing, credentials: RobotCredentials, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<RobotRuntimeStatus>;
  stageRevision(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    revision: { nonce: string; contents: Buffer; sha256: string },
    options: { signal?: AbortSignal; timeoutMs?: number; onState?: (state: "uploaded" | "staged") => void },
  ): Promise<{ state: "staged"; nonce: string; sha256: string; size: number }>;
  waitForActivation(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    expected: RobotActivationExpectation,
    options?: { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<RobotActivationResult>;
}

export interface RobotPushOperation {
  readonly preview: RobotPushPreview;
  readonly revision: BuiltJavaRevision;
  execute(
    transport: RobotPushTransport,
    onProgress?: (progress: RobotPushProgress) => void,
    options?: { signal?: AbortSignal },
  ): Promise<RobotPushResult>;
}

interface RobotPushInput {
  operationId: string;
  nonce: string;
  projectName: string;
  pairing: RobotPairing;
  status: RobotRuntimeStatus;
  trajectory: BuiltJavaTrajectory;
}

function assertRuntimeMatches(
  status: RobotRuntimeStatus,
  pairing: RobotPairing,
  trajectory: BuiltJavaTrajectory,
  expectedActiveRevisionId: string | null,
): void {
  if (status.teamNumber !== pairing.teamNumber || status.runtimeId !== pairing.runtimeId) {
    throw new Error("The paired robot identity changed; explicitly re-pair it before pushing");
  }
  if (!status.disabled) throw new Error("The robot must be disabled before Bordeaux can stage an activation");
  const catalog = trajectory.document.catalog;
  if (status.catalogId !== catalog.catalogId || status.catalogHash !== catalog.catalogHash
    || status.supportVersion !== catalog.supportVersion) {
    throw new Error("The robot command catalog or Bordeaux support version does not match this project");
  }
  const field = trajectory.document.field;
  if (status.fieldId !== field.id || status.fieldRevision !== field.revision
    || status.fieldCoordinateSchemaId !== field.coordinateSchemaId) {
    throw new Error("The robot field identity does not match this Bordeaux project");
  }
  if (status.activeRevisionId !== expectedActiveRevisionId) {
    throw new Error("The robot active revision changed; prepare and review the push again");
  }
}

export function createRobotPushOperation(input: RobotPushInput): RobotPushOperation {
  if (typeof input.operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.operationId)) {
    throw new Error("Robot push operation ID is invalid");
  }
  if (typeof input.projectName !== "string" || input.projectName.trim().length === 0 || input.projectName.length > 256) {
    throw new Error("Robot push project name is invalid");
  }
  assertRuntimeMatches(input.status, input.pairing, input.trajectory, input.status.activeRevisionId);
  const revision = buildJavaRevision(input.trajectory, {
    nonce: input.nonce,
    expectedActiveRevisionId: input.status.activeRevisionId,
  });
  const expected: RobotActivationExpectation = {
    nonce: input.nonce,
    revisionId: revision.revisionId,
    payloadSha256: revision.document.revision.payloadSha256,
    catalogId: revision.document.revision.catalog.catalogId,
    catalogHash: revision.document.revision.catalog.catalogHash,
    supportVersion: revision.document.revision.catalog.supportVersion,
  };
  const preview: RobotPushPreview = {
    operationId: input.operationId,
    state: "review",
    robot: `Team ${input.pairing.teamNumber} · ${input.pairing.endpoint.host}:${input.pairing.endpoint.port}`,
    project: input.projectName,
    catalog: expected.catalogId,
    revision: revision.revisionId,
    payloadHash: expected.payloadSha256,
    size: Buffer.byteLength(revision.contents, "utf8"),
    transport: "SFTP over SSH",
  };

  return {
    preview,
    revision,
    async execute(transport, onProgress = () => undefined, options = {}) {
      const credentials = { password: "" };
      const latest = await transport.inspect(input.pairing, credentials, { signal: options.signal });
      assertRuntimeMatches(latest, input.pairing, input.trajectory, revision.document.activation.expectedActiveRevisionId);
      await transport.stageRevision(input.pairing, credentials, {
        nonce: input.nonce,
        contents: Buffer.from(revision.contents, "utf8"),
        sha256: revision.sha256,
      }, {
        signal: options.signal,
        onState: (state) => onProgress({ operationId: input.operationId, state }),
      });
      const activation = await transport.waitForActivation(input.pairing, credentials, expected, { signal: options.signal });
      if (activation.state === "active") {
        onProgress({ operationId: input.operationId, state: "active" });
        return { operationId: input.operationId, state: "active", acknowledgement: activation.acknowledgement };
      }
      if (activation.state === "rejected") {
        const result = {
          operationId: input.operationId,
          state: "rejected" as const,
          boundary: "activation" as const,
          message: activation.acknowledgement.message,
        };
        onProgress(result);
        return result;
      }
      return { operationId: input.operationId, ...activation };
    },
  };
}
