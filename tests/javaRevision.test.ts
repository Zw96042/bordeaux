import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { buildJavaRevision } from "../src/shared/export/javaRevision";
import { buildJavaTrajectory } from "../src/shared/export/javaTrajectory";
import { createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog } from "../src/shared/types";

function generatedCatalog(): JavaCommandCatalog {
  return {
    projectName: "CompetitionRobot",
    sourceFileCount: 1,
    scannedAt: "2026-08-05T00:00:00.000Z",
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
}

describe("Java revision export", () => {
  it("preserves the exact trajectory bytes and binds compatibility metadata", () => {
    const trajectory = buildJavaTrajectory(createDemoProject(), generatedCatalog());
    const built = buildJavaRevision(trajectory, { nonce: "activation-1", expectedActiveRevisionId: null });

    expect(Buffer.from(built.document.revision.payload, "base64").toString("utf8")).toBe(trajectory.contents);
    expect(built.payloadContents).toBe(trajectory.contents);
    expect(built.document).toMatchObject({
      protocolVersion: "bordeaux-revision/1.0",
      revision: {
        revisionId: built.revisionId,
        payloadSha256: `sha256:${trajectory.sha256}`,
        catalog: {
          catalogId: trajectory.document.catalog.catalogId,
          catalogHash: trajectory.document.catalog.catalogHash,
          supportVersion: trajectory.document.catalog.supportVersion,
        },
        field: trajectory.document.field,
        payloadEncoding: "base64",
      },
      activation: { nonce: "activation-1", expectedActiveRevisionId: null },
    });
    expect(built.revisionId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("keeps revision identity stable when only the activation request changes", () => {
    const trajectory = buildJavaTrajectory(createDemoProject(), generatedCatalog());
    const first = buildJavaRevision(trajectory, { nonce: "activation-1", expectedActiveRevisionId: null });
    const second = buildJavaRevision(trajectory, { nonce: "activation-2", expectedActiveRevisionId: first.revisionId });

    expect(second.revisionId).toBe(first.revisionId);
    expect(second.document.activation).toEqual({ nonce: "activation-2", expectedActiveRevisionId: first.revisionId });
    expect(second.contents).not.toBe(first.contents);
  });

  it.each(["", " space", "x".repeat(257), "slash/not-allowed"])("rejects invalid activation nonce %j", (nonce) => {
    const trajectory = buildJavaTrajectory(createDemoProject(), generatedCatalog());
    expect(() => buildJavaRevision(trajectory, { nonce, expectedActiveRevisionId: null })).toThrow(/nonce/i);
  });

  it("rejects an invalid expected revision and modified trajectory bytes", () => {
    const trajectory = buildJavaTrajectory(createDemoProject(), generatedCatalog());
    expect(() => buildJavaRevision(trajectory, { nonce: "activation-1", expectedActiveRevisionId: "revision-1" })).toThrow(/expected active revision/i);
    expect(() => buildJavaRevision(
      { ...trajectory, contents: `${trajectory.contents} ` },
      { nonce: "activation-1", expectedActiveRevisionId: null },
    )).toThrow(/payload hash/i);
  });
});
