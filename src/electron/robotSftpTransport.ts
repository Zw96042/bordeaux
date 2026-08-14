import { createHash, randomBytes } from "node:crypto";

export const ROBOT_PUSH_PROTOCOL_VERSION = "bordeaux-robot-push/1.0" as const;
export const ROBOT_DEPLOYMENT_NAMESPACE = "/home/lvuser/deploy/bordeaux/push-v1" as const;

export interface RobotEndpoint {
  host: string;
  port: number;
}

export interface RobotRuntimeStatus {
  protocolVersion: typeof ROBOT_PUSH_PROTOCOL_VERSION;
  deploymentNamespace: typeof ROBOT_DEPLOYMENT_NAMESPACE;
  teamNumber: number;
  runtimeId: string;
  disabled: boolean;
  catalogId: string;
  catalogHash: string;
  supportVersion: string;
  fieldId: string;
  fieldRevision: string;
  fieldCoordinateSchemaId: string;
  activeRevisionId: string | null;
  activePayloadSha256: string | null;
  health: string[];
}

export interface RobotProbe {
  endpoint: RobotEndpoint;
  hostKeyFingerprint: string;
  status: RobotRuntimeStatus;
}

export interface RobotPairing {
  id: string;
  teamNumber: number;
  endpoint: RobotEndpoint;
  hostKeyFingerprint: string;
  runtimeId: string;
  protocolVersion: typeof ROBOT_PUSH_PROTOCOL_VERSION;
  deploymentNamespace: typeof ROBOT_DEPLOYMENT_NAMESPACE;
  pairedAt: string;
}

export interface RobotActivationExpectation {
  nonce: string;
  revisionId: string;
  payloadSha256: string;
  catalogId: string;
  catalogHash: string;
  supportVersion: string;
}

export interface RobotActiveAcknowledgement extends RobotActivationExpectation {
  protocolVersion: typeof ROBOT_PUSH_PROTOCOL_VERSION;
  state: "active";
  runtimeId: string;
  teamNumber: number;
}

export interface RobotRejectedAcknowledgement {
  protocolVersion: typeof ROBOT_PUSH_PROTOCOL_VERSION;
  nonce: string;
  state: "rejected";
  boundary: "activation";
  message: string;
  runtimeId: string;
  teamNumber: number;
}

export type RobotActivationResult =
  | { state: "active"; acknowledgement: RobotActiveAcknowledgement }
  | { state: "rejected"; acknowledgement: RobotRejectedAcknowledgement }
  | { state: "staged"; boundary: "acknowledgement"; message: string };

export type RobotRemoteFile =
  | { kind: "status" }
  | { kind: "incomingTemporary"; nonce: string; token: string }
  | { kind: "incomingRevision"; nonce: string }
  | { kind: "acknowledgement"; nonce: string };

export interface RobotSftpSession {
  readonly hostKeyFingerprint: string;
  read(file: RobotRemoteFile, maxBytes: number, signal: AbortSignal): Promise<Buffer>;
  write(file: RobotRemoteFile, contents: Buffer, signal: AbortSignal): Promise<void>;
  exists(file: RobotRemoteFile, signal: AbortSignal): Promise<boolean>;
  renameSameDirectory(from: RobotRemoteFile, to: RobotRemoteFile, signal: AbortSignal): Promise<void>;
  remove(file: RobotRemoteFile, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export interface RobotCredentials {
  password?: string;
  privateKey?: string | Buffer;
  passphrase?: string;
}

export interface RobotConnectRequest {
  endpoint: RobotEndpoint;
  credentials: RobotCredentials;
  expectedHostKeyFingerprint?: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export type RobotSftpSessionFactory = (request: RobotConnectRequest) => Promise<RobotSftpSession>;

export type RobotTransportErrorCode =
  | "invalid_request"
  | "re_pair_required"
  | "unavailable"
  | "cancelled"
  | "timed_out"
  | "transfer_failed";

export class RobotTransportError extends Error {
  constructor(readonly code: RobotTransportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RobotTransportError";
  }
}

const MAX_STATUS_BYTES = 64 * 1024;
const MAX_ACKNOWLEDGEMENT_BYTES = 64 * 1024;
const MAX_REVISION_BYTES = 24 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{20,128}$/;
const RUNTIME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, name: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`Robot status ${name} is invalid`);
  }
  return value;
}

function nullableHash(value: unknown, name: string): string | null {
  if (value === null) return null;
  const text = requiredText(value, name, 71);
  if (!SHA256.test(text)) throw new Error(`Robot status ${name} is invalid`);
  return text;
}

function parseRobotStatus(contents: Buffer): RobotRuntimeStatus {
  let raw: unknown;
  try { raw = JSON.parse(contents.toString("utf8")); }
  catch (error) { throw new Error("Robot status is not valid JSON", { cause: error }); }
  if (!isRecord(raw)) throw new Error("Robot status must be a JSON object");
  if (raw.protocolVersion !== ROBOT_PUSH_PROTOCOL_VERSION) throw new Error("Robot push protocol is not supported");
  if (raw.deploymentNamespace !== ROBOT_DEPLOYMENT_NAMESPACE) throw new Error("Robot deployment namespace does not match Bordeaux");
  if (!Number.isSafeInteger(raw.teamNumber) || (raw.teamNumber as number) <= 0 || (raw.teamNumber as number) > 99_999) {
    throw new Error("Robot status teamNumber is invalid");
  }
  const runtimeId = requiredText(raw.runtimeId, "runtimeId", 64);
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Robot status runtimeId is invalid");
  if (typeof raw.disabled !== "boolean") throw new Error("Robot status disabled is invalid");
  const catalogHash = requiredText(raw.catalogHash, "catalogHash", 71);
  if (!SHA256.test(catalogHash)) throw new Error("Robot status catalogHash is invalid");
  const activeRevisionId = nullableHash(raw.activeRevisionId, "activeRevisionId");
  const activePayloadSha256 = nullableHash(raw.activePayloadSha256, "activePayloadSha256");
  if ((activeRevisionId === null) !== (activePayloadSha256 === null)) {
    throw new Error("Robot status active revision identity is incomplete");
  }
  if (!Array.isArray(raw.health) || raw.health.length > 8
    || raw.health.some((item) => typeof item !== "string" || item.length === 0 || item.length > 512)) {
    throw new Error("Robot status health is invalid");
  }
  return {
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
    teamNumber: raw.teamNumber as number,
    runtimeId,
    disabled: raw.disabled,
    catalogId: requiredText(raw.catalogId, "catalogId"),
    catalogHash,
    supportVersion: requiredText(raw.supportVersion, "supportVersion", 64),
    fieldId: requiredText(raw.fieldId, "fieldId"),
    fieldRevision: requiredText(raw.fieldRevision, "fieldRevision"),
    fieldCoordinateSchemaId: requiredText(raw.fieldCoordinateSchemaId, "fieldCoordinateSchemaId"),
    activeRevisionId,
    activePayloadSha256,
    health: [...raw.health] as string[],
  };
}

function parseActivationAcknowledgement(
  contents: Buffer,
  pairing: RobotPairing,
  expected: RobotActivationExpectation,
): RobotActiveAcknowledgement | RobotRejectedAcknowledgement {
  let raw: unknown;
  try { raw = JSON.parse(contents.toString("utf8")); }
  catch (error) { throw new RobotTransportError("transfer_failed", "Robot activation acknowledgment is not valid JSON", { cause: error }); }
  if (!isRecord(raw) || raw.protocolVersion !== ROBOT_PUSH_PROTOCOL_VERSION) {
    throw new RobotTransportError("transfer_failed", "Robot activation acknowledgment protocol is invalid");
  }
  const nonce = requiredText(raw.nonce, "acknowledgment nonce");
  const runtimeId = requiredText(raw.runtimeId, "acknowledgment runtimeId", 64);
  if (!RUNTIME_ID.test(runtimeId) || runtimeId !== pairing.runtimeId
    || raw.teamNumber !== pairing.teamNumber || nonce !== expected.nonce) {
    throw new RobotTransportError("transfer_failed", "Robot activation acknowledgment identity does not match this push");
  }
  if (raw.state === "rejected") {
    if (raw.boundary !== "activation") {
      throw new RobotTransportError("transfer_failed", "Robot rejection did not identify the activation boundary");
    }
    return {
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      nonce,
      state: "rejected",
      boundary: "activation",
      message: requiredText(raw.message, "acknowledgment message", 512),
      runtimeId,
      teamNumber: pairing.teamNumber,
    };
  }
  if (raw.state !== "active") {
    throw new RobotTransportError("transfer_failed", "Robot activation acknowledgment state is invalid");
  }
  const actual = {
    revisionId: requiredText(raw.revisionId, "acknowledgment revisionId", 71),
    payloadSha256: requiredText(raw.payloadSha256, "acknowledgment payloadSha256", 71),
    catalogId: requiredText(raw.catalogId, "acknowledgment catalogId"),
    catalogHash: requiredText(raw.catalogHash, "acknowledgment catalogHash", 71),
    supportVersion: requiredText(raw.supportVersion, "acknowledgment supportVersion", 64),
  };
  if (!SHA256.test(actual.revisionId) || !SHA256.test(actual.payloadSha256) || !SHA256.test(actual.catalogHash)
    || actual.revisionId !== expected.revisionId || actual.payloadSha256 !== expected.payloadSha256
    || actual.catalogId !== expected.catalogId || actual.catalogHash !== expected.catalogHash
    || actual.supportVersion !== expected.supportVersion) {
    throw new RobotTransportError("transfer_failed", "Robot active acknowledgment does not match the reviewed revision");
  }
  return {
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    nonce,
    state: "active",
    ...actual,
    runtimeId,
    teamNumber: pairing.teamNumber,
  };
}

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new RobotTransportError("cancelled", "Waiting for robot activation was cancelled"));
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      reject(new RobotTransportError("cancelled", "Waiting for robot activation was cancelled"));
    }
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

function validateEndpoint(endpoint: RobotEndpoint): void {
  if (typeof endpoint.host !== "string" || endpoint.host.length === 0 || endpoint.host.length > 253
    || !/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(endpoint.host)) {
    throw new Error("Robot endpoint must be a hostname or IP address without a URL, user name, or path");
  }
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65_535) {
    throw new Error("Robot SFTP port must be between 1 and 65535");
  }
}

export class BordeauxRobotTransport {
  constructor(
    private readonly connect: RobotSftpSessionFactory,
    private readonly temporaryToken: () => string = () => randomBytes(12).toString("hex"),
  ) {}

  async probe(
    endpoint: RobotEndpoint,
    credentials: RobotCredentials,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<RobotProbe> {
    validateEndpoint(endpoint);
    const signal = options.signal ?? new AbortController().signal;
    const session = await this.connect({
      endpoint,
      credentials,
      signal,
      timeoutMs: options.timeoutMs ?? 8_000,
    });
    try {
      if (!SSH_FINGERPRINT.test(session.hostKeyFingerprint)) throw new Error("Robot returned an invalid SSH host-key fingerprint");
      const status = parseRobotStatus(await session.read({ kind: "status" }, MAX_STATUS_BYTES, signal));
      return { endpoint: { ...endpoint }, hostKeyFingerprint: session.hostKeyFingerprint, status };
    } finally {
      await session.close();
    }
  }

  async inspect(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<RobotRuntimeStatus> {
    validateEndpoint(pairing.endpoint);
    const signal = options.signal ?? new AbortController().signal;
    const session = await this.connect({
      endpoint: pairing.endpoint,
      credentials,
      expectedHostKeyFingerprint: pairing.hostKeyFingerprint,
      signal,
      timeoutMs: options.timeoutMs ?? 8_000,
    });
    try {
      if (session.hostKeyFingerprint !== pairing.hostKeyFingerprint) {
        throw new RobotTransportError("re_pair_required", "The robot SSH host key changed; explicitly re-pair this robot before transferring data");
      }
      const status = parseRobotStatus(await session.read({ kind: "status" }, MAX_STATUS_BYTES, signal));
      if (status.runtimeId !== pairing.runtimeId || status.teamNumber !== pairing.teamNumber) {
        throw new RobotTransportError("re_pair_required", "The paired Bordeaux runtime identity changed; explicitly re-pair this robot before transferring data");
      }
      return status;
    } finally {
      await session.close();
    }
  }

  async stageRevision(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    revision: { nonce: string; contents: Buffer; sha256: string },
    options: { signal?: AbortSignal; timeoutMs?: number; onState?: (state: "uploaded" | "staged") => void } = {},
  ): Promise<{ state: "staged"; nonce: string; sha256: string; size: number }> {
    validateEndpoint(pairing.endpoint);
    if (!FILE_TOKEN.test(revision.nonce)) {
      throw new RobotTransportError("invalid_request", "Revision nonce cannot be used as a Bordeaux inbox file name");
    }
    if (!Buffer.isBuffer(revision.contents) || revision.contents.length === 0 || revision.contents.length > MAX_REVISION_BYTES) {
      throw new RobotTransportError("invalid_request", `Revision envelope must contain 1-${MAX_REVISION_BYTES} bytes`);
    }
    if (!SHA256_HEX.test(revision.sha256)
      || createHash("sha256").update(revision.contents).digest("hex") !== revision.sha256) {
      throw new RobotTransportError("invalid_request", "Revision envelope SHA-256 does not match its exact bytes");
    }
    const token = this.temporaryToken();
    if (!/^[a-f0-9]{8,64}$/.test(token)) throw new Error("Temporary upload token source returned an invalid token");
    const temporary: RobotRemoteFile = { kind: "incomingTemporary", nonce: revision.nonce, token };
    const destination: RobotRemoteFile = { kind: "incomingRevision", nonce: revision.nonce };
    const signal = options.signal ?? new AbortController().signal;
    const session = await this.connect({
      endpoint: pairing.endpoint,
      credentials,
      expectedHostKeyFingerprint: pairing.hostKeyFingerprint,
      signal,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
    let uploadAttempted = false;
    let staged = false;
    try {
      if (session.hostKeyFingerprint !== pairing.hostKeyFingerprint) {
        throw new RobotTransportError("re_pair_required", "The robot SSH host key changed; explicitly re-pair this robot before transferring data");
      }
      const status = parseRobotStatus(await session.read({ kind: "status" }, MAX_STATUS_BYTES, signal));
      if (status.runtimeId !== pairing.runtimeId || status.teamNumber !== pairing.teamNumber) {
        throw new RobotTransportError("re_pair_required", "The paired Bordeaux runtime identity changed; explicitly re-pair this robot before transferring data");
      }
      uploadAttempted = true;
      await session.write(temporary, revision.contents, signal);
      const readBack = await session.read(temporary, revision.contents.length, signal);
      const readBackHash = createHash("sha256").update(readBack).digest("hex");
      if (readBack.length !== revision.contents.length || readBackHash !== revision.sha256) {
        throw new RobotTransportError("transfer_failed", "Robot upload read-back did not match the staged revision bytes");
      }
      options.onState?.("uploaded");
      if (await session.exists(destination, signal)) {
        throw new RobotTransportError("transfer_failed", "A robot inbox revision already uses this activation nonce");
      }
      await session.renameSameDirectory(temporary, destination, signal);
      staged = true;
      options.onState?.("staged");
      return { state: "staged", nonce: revision.nonce, sha256: revision.sha256, size: revision.contents.length };
    } catch (error) {
      if (error instanceof RobotTransportError) throw error;
      if (signal.aborted) throw new RobotTransportError("cancelled", "Robot transfer was cancelled", { cause: error });
      throw new RobotTransportError("transfer_failed", "The constrained SFTP transfer failed before the revision was staged", { cause: error });
    } finally {
      if (uploadAttempted && !staged) {
        try { await session.remove(temporary, signal); }
        catch { /* Preserve the primary transfer error; temp files are ignored by the robot runtime. */ }
      }
      await session.close();
    }
  }

  async waitForActivation(
    pairing: RobotPairing,
    credentials: RobotCredentials,
    expected: RobotActivationExpectation,
    options: { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<RobotActivationResult> {
    validateEndpoint(pairing.endpoint);
    if (!FILE_TOKEN.test(expected.nonce) || !SHA256.test(expected.revisionId)
      || !SHA256.test(expected.payloadSha256) || !SHA256.test(expected.catalogHash)) {
      throw new RobotTransportError("invalid_request", "Robot activation expectation is invalid");
    }
    const signal = options.signal ?? new AbortController().signal;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new RobotTransportError("invalid_request", "Robot acknowledgment timing is invalid");
    }
    const session = await this.connect({
      endpoint: pairing.endpoint,
      credentials,
      expectedHostKeyFingerprint: pairing.hostKeyFingerprint,
      signal,
      timeoutMs: Math.max(1_000, timeoutMs),
    });
    const acknowledgement: RobotRemoteFile = { kind: "acknowledgement", nonce: expected.nonce };
    const deadline = Date.now() + timeoutMs;
    try {
      if (session.hostKeyFingerprint !== pairing.hostKeyFingerprint) {
        throw new RobotTransportError("re_pair_required", "The robot SSH host key changed; explicitly re-pair this robot before transferring data");
      }
      const status = parseRobotStatus(await session.read({ kind: "status" }, MAX_STATUS_BYTES, signal));
      if (status.runtimeId !== pairing.runtimeId || status.teamNumber !== pairing.teamNumber) {
        throw new RobotTransportError("re_pair_required", "The paired Bordeaux runtime identity changed; explicitly re-pair this robot before transferring data");
      }
      while (true) {
        if (signal.aborted) throw new RobotTransportError("cancelled", "Waiting for robot activation was cancelled");
        if (await session.exists(acknowledgement, signal)) {
          const parsed = parseActivationAcknowledgement(
            await session.read(acknowledgement, MAX_ACKNOWLEDGEMENT_BYTES, signal), pairing, expected,
          );
          return parsed.state === "active"
            ? { state: "active", acknowledgement: parsed }
            : { state: "rejected", acknowledgement: parsed };
        }
        if (Date.now() >= deadline) {
          return {
            state: "staged",
            boundary: "acknowledgement",
            message: "The revision is staged, but Bordeaux did not receive the nonce-bound robot acknowledgment before the timeout",
          };
        }
        await waitForPoll(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
      }
    } finally {
      await session.close();
    }
  }
}

export function confirmRobotPairing(input: {
  probe: RobotProbe;
  acceptedHostKeyFingerprint: string;
  acceptedRuntimeId: string;
  pairedAt?: string;
}): RobotPairing {
  if (input.acceptedHostKeyFingerprint !== input.probe.hostKeyFingerprint) {
    throw new Error("The robot SSH host key changed; probe the robot again and explicitly re-pair it");
  }
  if (input.acceptedRuntimeId !== input.probe.status.runtimeId) {
    throw new Error("The Bordeaux runtime identity changed; probe the robot again and explicitly re-pair it");
  }
  return {
    id: `robot-${input.probe.status.teamNumber}-${input.probe.status.runtimeId.slice(0, 8)}`,
    teamNumber: input.probe.status.teamNumber,
    endpoint: input.probe.endpoint,
    hostKeyFingerprint: input.probe.hostKeyFingerprint,
    runtimeId: input.probe.status.runtimeId,
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
    pairedAt: input.pairedAt ?? new Date().toISOString(),
  };
}
