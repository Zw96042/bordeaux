import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import {
  BordeauxRobotTransport,
  ROBOT_DEPLOYMENT_NAMESPACE,
  ROBOT_PUSH_PROTOCOL_VERSION,
  confirmRobotPairing,
  type RobotRemoteFile,
  type RobotProbe,
  type RobotSftpSession,
} from "../src/electron/robotSftpTransport";
import { connectRobotSftp } from "../src/electron/robotSsh2Session";

const probe: RobotProbe = {
  endpoint: { host: "10.24.68.2", port: 22 },
  hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
  status: {
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
    teamNumber: 2468,
    runtimeId: "a0d7440d-d346-4ae4-a58b-7efd622b71d0",
    disabled: true,
    catalogId: "CompetitionRobot",
    catalogHash: `sha256:${"a".repeat(64)}`,
    supportVersion: "0.1.0",
    fieldId: "frc-2026-rebuilt",
    fieldRevision: "official-2026.1",
    fieldCoordinateSchemaId: "wpilib-blue-origin-v1",
    activeRevisionId: null,
    activePayloadSha256: null,
    health: ["ready: no active Bordeaux revision"],
  },
};

describe("constrained robot SFTP transport", () => {
    const field = { id: probe.status.fieldId, revision: probe.status.fieldRevision, coordinateSchemaId: probe.status.fieldCoordinateSchemaId };
    const contents = JSON.stringify({ schemaVersion: scenario === "schema" ? "unknown" : "bordeaux-trajectory/1.0", catalog, field, paths: [], routine: null });
    const payloadSha256 = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
    const revisionId = `sha256:${createHash("sha256").update(JSON.stringify({ protocolVersion: "bordeaux-revision/1.0", payloadSha256, catalog, field })).digest("hex")}`;
    const empty = scenario === "empty" || scenario === "empty-race";
    const status = { ...probe.status, activeRevisionRead: scenario === "unsupported" ? undefined : scenario === "unknown-version" ? "bordeaux-active-revision/9.0" : ROBOT_ACTIVE_REVISION_READ_VERSION,
      activeRevisionId: empty ? null : scenario === "identity" ? `sha256:${"b".repeat(64)}` : revisionId, activePayloadSha256: empty ? null : payloadSha256 };
    const pairing = confirmRobotPairing({ probe, acceptedHostKeyFingerprint: probe.hostKeyFingerprint, acceptedRuntimeId: probe.status.runtimeId });
    const reads: RobotRemoteFile[] = [];
    let closed = false;
    let statusReads = 0;
    const session: RobotSftpSession = {
      hostKeyFingerprint: probe.hostKeyFingerprint,
      read: async (file, maxBytes) => {
        reads.push(file);
        if (file.kind === "status") {
          statusReads += 1;
          const changed = statusReads === 2;
          return Buffer.from(JSON.stringify({ ...status,
            ...(changed && (scenario === "race" || scenario === "empty-race") ? { activeRevisionId: `sha256:${"c".repeat(64)}`, activePayloadSha256: payloadSha256 } : {}),
            ...(changed && scenario === "context-race" ? { catalogHash: `sha256:${"d".repeat(64)}` } : {}),
          }));
        }
        expect(file).toEqual({ kind: "activeTrajectory" });
        expect(maxBytes).toBe(16 * 1024 * 1024);
        if (scenario === "missing") throw new Error("missing retained baseline");
        if (scenario === "oversized") return Buffer.alloc(maxBytes + 1);
        return Buffer.from(scenario === "corrupt" ? "corrupt" : contents);
      },
      write: async () => { throw new Error("unexpected write"); },
      exists: async () => { throw new Error("unexpected exists"); },
      renameSameDirectory: async () => { throw new Error("unexpected rename"); },
      remove: async () => { throw new Error("unexpected remove"); },
      close: async () => { closed = true; },
    };
    const transport = new BordeauxRobotTransport(async () => session);
    if (scenario === "active" || scenario === "empty") {
      await expect(transport.readActiveRevision(pairing, {})).resolves.toEqual({ status, contents: empty ? null : contents });
      expect(reads).toEqual(empty ? [{ kind: "status" }, { kind: "status" }] : [{ kind: "status" }, { kind: "activeTrajectory" }, { kind: "status" }]);
    } else {
      await expect(transport.readActiveRevision(pairing, {})).rejects.toThrow();
    }
    expect(closed).toBe(true);
  });

  it("binds an explicitly accepted host key and runtime identity", () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
      pairedAt: "2026-08-14T18:30:00.000Z",
    });

    expect(pairing).toEqual({
      id: "robot-2468-a0d7440d",
      teamNumber: 2468,
      endpoint: probe.endpoint,
      hostKeyFingerprint: probe.hostKeyFingerprint,
      runtimeId: probe.status.runtimeId,
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
      pairedAt: "2026-08-14T18:30:00.000Z",
    });
  });

  it("probes only the fixed status file and returns the observed SSH identity", async () => {
    const reads: RobotRemoteFile[] = [];
    let closed = false;
    const session: RobotSftpSession = {
      hostKeyFingerprint: probe.hostKeyFingerprint,
      read: async (file) => {
        reads.push(file);
        return Buffer.from(JSON.stringify(probe.status));
      },
      write: async () => { throw new Error("unexpected write"); },
      exists: async () => false,
      renameSameDirectory: async () => { throw new Error("unexpected rename"); },
      remove: async () => undefined,
      close: async () => { closed = true; },
    };
    const transport = new BordeauxRobotTransport(async () => session);

    await expect(transport.probe(probe.endpoint, { password: "" })).resolves.toEqual(probe);
    expect(reads).toEqual([{ kind: "status" }]);
    expect(closed).toBe(true);
  });

  it.each([
    {
      name: "SSH host key",
      fingerprint: `SHA256:${"B".repeat(43)}`,
      status: probe.status,
    },
    {
      name: "Bordeaux runtime",
      fingerprint: probe.hostKeyFingerprint,
      status: { ...probe.status, runtimeId: "ec9a6647-01c9-4bb1-a238-018f085ad33f" },
    },
    {
      name: "team number",
      fingerprint: probe.hostKeyFingerprint,
      status: { ...probe.status, teamNumber: 1234 },
    },
  ])("requires explicit re-pairing after the $name identity changes", async ({ fingerprint, status }) => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    let closed = 0;
    const session: RobotSftpSession = {
      hostKeyFingerprint: fingerprint,
      read: async (file) => {
        expect(file).toEqual({ kind: "status" });
        return Buffer.from(JSON.stringify(status));
      },
      write: async () => { throw new Error("unexpected write"); },
      exists: async () => { throw new Error("unexpected acknowledgement read"); },
      renameSameDirectory: async () => { throw new Error("unexpected rename"); },
      remove: async () => { throw new Error("unexpected cleanup"); },
      close: async () => { closed += 1; },
    };
    const transport = new BordeauxRobotTransport(async (request) => {
      expect(request.expectedHostKeyFingerprint).toBe(pairing.hostKeyFingerprint);
      return session;
    });

    const credentials = { password: "" };
    const envelope = {
      nonce: "push-identity-check",
      contents: Buffer.from("revision-envelope\n"),
      sha256: "9e65848c141c882c831950e7093275b6406a9e9d1b0c214d4f6b2ba341ef1ca7",
    };
    const expected = {
      nonce: envelope.nonce,
      revisionId: `sha256:${"b".repeat(64)}`,
      payloadSha256: `sha256:${"c".repeat(64)}`,
      catalogId: probe.status.catalogId,
      catalogHash: probe.status.catalogHash,
      supportVersion: probe.status.supportVersion,
    };
    const operations = [
      () => transport.inspect(pairing, credentials),
      () => transport.readActiveRevision(pairing, credentials),
      () => transport.stageRevision(pairing, credentials, envelope),
      () => transport.stageRetention(pairing, credentials, envelope),
      () => transport.waitForActivation(pairing, credentials, expected),
      () => transport.waitForRetention(pairing, credentials, {
        ...expected, action: "pin", expectedActiveRevisionId: null, target: expected,
      }),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: "re_pair_required" });
    }
    expect(closed).toBe(operations.length);
  });

  it("reads back the exact temporary upload before a same-directory rename", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    const operations: string[] = [];
    let uploaded: Buffer | undefined;
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => {
        operations.push(`read:${file.kind}`);
        if (file.kind === "status") return Buffer.from(JSON.stringify(probe.status));
        if (file.kind === "incomingTemporary" && uploaded) return uploaded;
        throw new Error("unexpected read");
      },
      write: async (file, contents) => {
        operations.push(`write:${file.kind}`);
        uploaded = Buffer.from(contents);
      },
      exists: async (file) => {
        operations.push(`exists:${file.kind}`);
        return false;
      },
      renameSameDirectory: async (from, to) => {
        operations.push(`rename:${from.kind}->${to.kind}`);
      },
      remove: async (file) => { operations.push(`remove:${file.kind}`); },
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session, () => "feedface");
    const states: string[] = [];

    await expect(transport.stageRevision(pairing, { password: "" }, {
      nonce: "push-2026-08-14",
      contents: Buffer.from("revision-envelope\n"),
      sha256: "9e65848c141c882c831950e7093275b6406a9e9d1b0c214d4f6b2ba341ef1ca7",
    }, { onState: (state) => states.push(state) })).resolves.toMatchObject({ state: "staged", nonce: "push-2026-08-14" });
    expect(states).toEqual(["uploaded", "staged"]);
    expect(operations).toEqual([
      "read:status",
      "write:incomingTemporary",
      "read:incomingTemporary",
      "exists:incomingRevision",
      "rename:incomingTemporary->incomingRevision",
    ]);
  });

  it("validates optional bounded retention status without treating an older runtime as empty", async () => {
    const session = (status: unknown): RobotSftpSession => ({
      hostKeyFingerprint: probe.hostKeyFingerprint,
      read: async () => Buffer.from(JSON.stringify(status)),
      write: async () => undefined,
      exists: async () => false,
      renameSameDirectory: async () => undefined,
      remove: async () => undefined,
      close: async () => undefined,
    });
    const legacy = await new BordeauxRobotTransport(async () => session(probe.status)).probe(probe.endpoint, { password: "" });
    expect(legacy.status.retention).toBeUndefined();

    const malformed = { ...probe.status, retention: { recentLimit: 5, revisions: [{ revisionId: `sha256:${"b".repeat(64)}`, payloadSha256: `sha256:${"c".repeat(64)}`, availability: "retained", pinned: true }, { revisionId: `sha256:${"d".repeat(64)}`, payloadSha256: `sha256:${"c".repeat(64)}`, availability: "retained", pinned: true }] } };
    await expect(new BordeauxRobotTransport(async () => session(malformed)).probe(probe.endpoint, { password: "" })).rejects.toThrow(/retention/i);

    const duplicateRevision = { ...probe.status, retention: { recentLimit: 5, revisions: [{ revisionId: `sha256:${"b".repeat(64)}`, payloadSha256: `sha256:${"c".repeat(64)}`, availability: "retained", pinned: false }, { revisionId: `sha256:${"b".repeat(64)}`, payloadSha256: `sha256:${"d".repeat(64)}`, availability: "retained", pinned: false }] } };
    await expect(new BordeauxRobotTransport(async () => session(duplicateRevision)).probe(probe.endpoint, { password: "" })).rejects.toThrow(/retention/i);

    const activeMismatch = { ...probe.status, activeRevisionId: `sha256:${"b".repeat(64)}`, activePayloadSha256: `sha256:${"c".repeat(64)}`, retention: { recentLimit: 5, revisions: [{ revisionId: `sha256:${"b".repeat(64)}`, payloadSha256: `sha256:${"d".repeat(64)}`, availability: "retained", pinned: false }] } };
    await expect(new BordeauxRobotTransport(async () => session(activeMismatch)).probe(probe.endpoint, { password: "" })).rejects.toThrow(/retention.*active/i);

    const overLimit = { ...probe.status, retention: { recentLimit: 5, revisions: Array.from({ length: 7 }, (_, index) => ({ revisionId: `sha256:${String(index).repeat(64)}`, payloadSha256: `sha256:${String(index).repeat(64)}`, availability: "retained", pinned: false })) } };
    await expect(new BordeauxRobotTransport(async () => session(overLimit)).probe(probe.endpoint, { password: "" })).rejects.toThrow(/retention/i);
  });

  it("stages exact retention control bytes through a separate fixed inbox file", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    const operations: string[] = [];
    let uploaded: Buffer | undefined;
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => {
        operations.push(`read:${file.kind}`);
        if (file.kind === "status") return Buffer.from(JSON.stringify(probe.status));
        if (file.kind === "incomingRetentionTemporary" && uploaded) return uploaded;
        throw new Error("unexpected read");
      },
      write: async (file, contents) => { operations.push(`write:${file.kind}`); uploaded = Buffer.from(contents); },
      exists: async (file) => { operations.push(`exists:${file.kind}`); return false; },
      renameSameDirectory: async (from, to) => { operations.push(`rename:${from.kind}->${to.kind}`); },
      remove: async () => undefined,
      close: async () => undefined,
    };
    const control = Buffer.from('{"protocolVersion":"bordeaux-retention/1.0"}');
    const transport = new BordeauxRobotTransport(async () => session, () => "feedface");
    await expect(transport.stageRetention(pairing, { password: "" }, {
      nonce: "retention-2026-08-14",
      contents: control,
      sha256: "37fce6c7b66f56310a6a679d31009048733686dd0730af7ef9d6e3ee2c9b05d0",
    })).resolves.toMatchObject({ state: "staged", nonce: "retention-2026-08-14" });
    expect(operations).toEqual([
      "read:status",
      "write:incomingRetentionTemporary",
      "read:incomingRetentionTemporary",
      "exists:incomingRetention",
      "rename:incomingRetentionTemporary->incomingRetention",
    ]);
  });

  it("rejects a retention control above the runtime's 16 KiB limit before opening SFTP", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    let connected = false;
    const transport = new BordeauxRobotTransport(async () => {
      connected = true;
      throw new Error("unexpected connection");
    });
    await expect(transport.stageRetention(pairing, { password: "" }, {
      nonce: "retention-too-large",
      contents: Buffer.alloc(16 * 1024 + 1),
      sha256: "a".repeat(64),
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(connected).toBe(false);
  });

  it("accepts only the exact action-bound retention acknowledgment", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    let acknowledgement: Record<string, unknown> = {
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      nonce: "retention-ack",
      state: "pinned",
      action: "pin",
      revisionId: `sha256:${"b".repeat(64)}`,
      payloadSha256: `sha256:${"c".repeat(64)}`,
      catalogId: probe.status.catalogId,
      catalogHash: probe.status.catalogHash,
      supportVersion: probe.status.supportVersion,
      runtimeId: probe.status.runtimeId,
      teamNumber: probe.status.teamNumber,
    };
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => file.kind === "status" ? Buffer.from(JSON.stringify(probe.status)) : Buffer.from(JSON.stringify(acknowledgement)),
      write: async () => undefined,
      exists: async () => true,
      renameSameDirectory: async () => undefined,
      remove: async () => undefined,
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session);
    const expectation = {
      nonce: acknowledgement.nonce as string,
      action: "pin" as const,
      expectedActiveRevisionId: null,
      target: { revisionId: acknowledgement.revisionId as string, payloadSha256: acknowledgement.payloadSha256 as string },
      catalogId: acknowledgement.catalogId as string,
      catalogHash: acknowledgement.catalogHash as string,
      supportVersion: acknowledgement.supportVersion as string,
    };
    await expect(transport.waitForRetention(pairing, { password: "" }, expectation)).resolves.toEqual({ state: "pinned", acknowledgement });
    await expect(transport.waitForRetention(pairing, { password: "" }, { ...expectation, action: "rollback" })).rejects.toMatchObject({ code: "transfer_failed" });
    acknowledgement = {
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      nonce: expectation.nonce,
      state: "rejected",
      boundary: "mailbox",
      message: "A revision control with this nonce already exists",
      runtimeId: pairing.runtimeId,
      teamNumber: pairing.teamNumber,
    };
    await expect(transport.waitForRetention(pairing, { password: "" }, expectation)).resolves.toMatchObject({ state: "rejected", acknowledgement: { boundary: "mailbox" } });
    acknowledgement = { ...acknowledgement, boundary: "activation" };
    await expect(transport.waitForRetention(pairing, { password: "" }, expectation)).rejects.toMatchObject({ code: "transfer_failed" });
  });

  it("accepts active only from the exact nonce-bound runtime acknowledgment", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    const acknowledgement = {
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      nonce: "push-active",
      state: "active",
      revisionId: `sha256:${"b".repeat(64)}`,
      payloadSha256: `sha256:${"c".repeat(64)}`,
      catalogId: probe.status.catalogId,
      catalogHash: probe.status.catalogHash,
      supportVersion: probe.status.supportVersion,
      runtimeId: probe.status.runtimeId,
      teamNumber: probe.status.teamNumber,
    };
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => file.kind === "status"
        ? Buffer.from(JSON.stringify(probe.status))
        : Buffer.from(JSON.stringify(acknowledgement)),
      write: async () => undefined,
      exists: async (file) => file.kind === "acknowledgement",
      renameSameDirectory: async () => undefined,
      remove: async () => undefined,
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session);

    await expect(transport.waitForActivation(pairing, { password: "" }, {
      nonce: acknowledgement.nonce,
      revisionId: acknowledgement.revisionId,
      payloadSha256: acknowledgement.payloadSha256,
      catalogId: acknowledgement.catalogId,
      catalogHash: acknowledgement.catalogHash,
      supportVersion: acknowledgement.supportVersion,
    })).resolves.toEqual({ state: "active", acknowledgement });
  });

  it("keeps rejected and staged-without-acknowledgment distinct from active", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    let rejected = {
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      nonce: "push-rejected",
      state: "rejected",
      boundary: "activation",
      message: "Robot must remain disabled while activating a Bordeaux revision",
      runtimeId: probe.status.runtimeId,
      teamNumber: probe.status.teamNumber,
    };
    let hasAcknowledgement = true;
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => file.kind === "status"
        ? Buffer.from(JSON.stringify(probe.status))
        : Buffer.from(JSON.stringify(rejected)),
      write: async () => undefined,
      exists: async () => hasAcknowledgement,
      renameSameDirectory: async () => undefined,
      remove: async () => undefined,
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session);
    const expectation = {
      nonce: rejected.nonce,
      revisionId: `sha256:${"b".repeat(64)}`,
      payloadSha256: `sha256:${"c".repeat(64)}`,
      catalogId: probe.status.catalogId,
      catalogHash: probe.status.catalogHash,
      supportVersion: probe.status.supportVersion,
    };

    await expect(transport.waitForActivation(pairing, { password: "" }, expectation))
      .resolves.toEqual({ state: "rejected", acknowledgement: rejected });

    rejected = { ...rejected, boundary: "mailbox" };
    await expect(transport.waitForActivation(pairing, { password: "" }, expectation))
      .resolves.toEqual({ state: "rejected", acknowledgement: rejected });
    rejected = { ...rejected, boundary: "retention" };
    await expect(transport.waitForActivation(pairing, { password: "" }, expectation))
      .rejects.toMatchObject({ code: "transfer_failed" });

    hasAcknowledgement = false;
    await expect(transport.waitForActivation(pairing, { password: "" }, expectation, {
      timeoutMs: 0,
      pollIntervalMs: 0,
    })).resolves.toMatchObject({ state: "staged", boundary: "acknowledgement" });
  });

  it("rejects an active acknowledgment whose revision identity does not match", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    const acknowledgement = {
      protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
      nonce: "push-mismatch",
      state: "active",
      revisionId: `sha256:${"d".repeat(64)}`,
      payloadSha256: `sha256:${"c".repeat(64)}`,
      catalogId: probe.status.catalogId,
      catalogHash: probe.status.catalogHash,
      supportVersion: probe.status.supportVersion,
      runtimeId: probe.status.runtimeId,
      teamNumber: probe.status.teamNumber,
    };
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => file.kind === "status"
        ? Buffer.from(JSON.stringify(probe.status))
        : Buffer.from(JSON.stringify(acknowledgement)),
      write: async () => undefined,
      exists: async () => true,
      renameSameDirectory: async () => undefined,
      remove: async () => undefined,
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session);

    await expect(transport.waitForActivation(pairing, { password: "" }, {
      nonce: acknowledgement.nonce,
      revisionId: `sha256:${"b".repeat(64)}`,
      payloadSha256: acknowledgement.payloadSha256,
      catalogId: acknowledgement.catalogId,
      catalogHash: acknowledgement.catalogHash,
      supportVersion: acknowledgement.supportVersion,
    })).rejects.toMatchObject({ code: "transfer_failed" });
  });

  it("rejects path-like activation nonces before opening SFTP", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    let connected = false;
    const transport = new BordeauxRobotTransport(async () => {
      connected = true;
      throw new Error("unexpected connection");
    });

    await expect(transport.stageRevision(pairing, { password: "" }, {
      nonce: "../../active.json",
      contents: Buffer.from("revision-envelope\n"),
      sha256: "9e65848c141c882c831950e7093275b6406a9e9d1b0c214d4f6b2ba341ef1ca7",
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(connected).toBe(false);
  });

  it("cleans up a temporary upload and redacts a failed atomic rename", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    let removed = false;
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async (file) => file.kind === "status"
        ? Buffer.from(JSON.stringify(probe.status))
        : Buffer.from("revision-envelope\n"),
      write: async () => undefined,
      exists: async () => false,
      renameSameDirectory: async () => { throw new Error("rename failed password=team-secret"); },
      remove: async () => { removed = true; },
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session, () => "feedface");

    const failure = await transport.stageRevision(pairing, { password: "team-secret" }, {
      nonce: "push-rename-failure",
      contents: Buffer.from("revision-envelope\n"),
      sha256: "9e65848c141c882c831950e7093275b6406a9e9d1b0c214d4f6b2ba341ef1ca7",
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "transfer_failed" });
    expect(String((failure as Error).message)).not.toContain("team-secret");
    expect(removed).toBe(true);
  });

  it("cancels before opening a network connection", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(connectRobotSftp({
      endpoint: { host: "127.0.0.1", port: 1 },
      credentials: { password: "" },
      signal: controller.signal,
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("times out a peer that accepts TCP but never completes SSH", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
    try {
      await expect(connectRobotSftp({
        endpoint: { host: "127.0.0.1", port: address.port },
        credentials: { password: "" },
        signal: new AbortController().signal,
        timeoutMs: 25,
      })).rejects.toMatchObject({ code: "timed_out" });
    } finally {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("attempts bounded temp cleanup when cancellation interrupts an upload", async () => {
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint: probe.hostKeyFingerprint,
      acceptedRuntimeId: probe.status.runtimeId,
    });
    const controller = new AbortController();
    let removed = false;
    const session: RobotSftpSession = {
      hostKeyFingerprint: pairing.hostKeyFingerprint,
      read: async () => Buffer.from(JSON.stringify(probe.status)),
      write: async () => {
        controller.abort();
        throw new Error("partial upload password=team-secret");
      },
      exists: async () => false,
      renameSameDirectory: async () => undefined,
      remove: async () => { removed = true; },
      close: async () => undefined,
    };
    const transport = new BordeauxRobotTransport(async () => session, () => "feedface");

    await expect(transport.stageRevision(pairing, { password: "team-secret" }, {
      nonce: "push-cancelled",
      contents: Buffer.from("revision-envelope\n"),
      sha256: "9e65848c141c882c831950e7093275b6406a9e9d1b0c214d4f6b2ba341ef1ca7",
    }, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled", message: "Robot transfer was cancelled" });
    expect(removed).toBe(true);
  });

  it("reports SFTP unavailability without claiming it detected FMS", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    let failure: Error & { code?: string };
    try {
      await connectRobotSftp({
        endpoint: { host: "127.0.0.1", port: address.port },
        credentials: { password: "team-secret" },
        signal: new AbortController().signal,
        timeoutMs: 1_000,
      });
      throw new Error("Expected the closed test endpoint to be unavailable");
    } catch (error) {
      failure = error as Error & { code?: string };
    }
    expect(failure.code).toBe("unavailable");
    expect(failure.message).toContain("SFTP to the robot is unavailable");
    expect(failure.message).toContain("did not detect which network");
    expect(failure.message).not.toContain("team-secret");
  });
});
