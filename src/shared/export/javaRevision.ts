import { createHash } from "node:crypto";
import type { FieldReference } from "../types";
import type { BuiltJavaTrajectory } from "./javaTrajectory";

const REVISION_PROTOCOL_VERSION = "bordeaux-revision/1.0" as const;
const MAX_TRAJECTORY_BYTES = 16 * 1024 * 1024;
const MAX_REVISION_BYTES = 24 * 1024 * 1024;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const ACTIVATION_NONCE = /^[A-Za-z0-9._:-]{1,256}$/;

interface RevisionCatalog {
  catalogId: string;
  catalogHash: string;
  supportVersion: string;
}

export interface JavaRevisionDocument {
  protocolVersion: typeof REVISION_PROTOCOL_VERSION;
  revision: {
    revisionId: string;
    payloadSha256: string;
    catalog: RevisionCatalog;
    field: FieldReference;
    payloadEncoding: "base64";
    payload: string;
  };
  activation: {
    nonce: string;
    expectedActiveRevisionId: string | null;
  };
}

export interface JavaRevisionRequest {
  nonce: string;
  expectedActiveRevisionId: string | null;
}

export interface BuiltJavaRevision {
  document: JavaRevisionDocument;
  contents: string;
  sha256: string;
  revisionId: string;
  payloadContents: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function trajectoryMetadata(trajectory: BuiltJavaTrajectory): {
  catalog: RevisionCatalog;
  field: FieldReference;
} {
  const payloadBytes = Buffer.byteLength(trajectory.contents, "utf8");
  if (payloadBytes > MAX_TRAJECTORY_BYTES) {
    throw new Error(`Java trajectory payload exceeds ${MAX_TRAJECTORY_BYTES} bytes`);
  }
  const actualHash = hash(trajectory.contents);
  if (!/^[0-9a-f]{64}$/.test(trajectory.sha256) || actualHash !== trajectory.sha256) {
    throw new Error("Java trajectory payload hash does not match its exact contents");
  }
  let payload: unknown;
  try { payload = JSON.parse(trajectory.contents); }
  catch (error) { throw new Error("Java trajectory payload is not valid JSON", { cause: error }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Java trajectory payload must be a JSON object");
  }
  const document = payload as Record<string, unknown>;
  if (document.schemaVersion !== "bordeaux-trajectory/1.0") {
    throw new Error("Java trajectory payload schema is not supported");
  }
  const catalog = document.catalog as Record<string, unknown> | undefined;
  const field = document.field as Record<string, unknown> | undefined;
  if (!catalog || typeof catalog !== "object"
    || typeof catalog.catalogId !== "string" || !catalog.catalogId
    || typeof catalog.supportVersion !== "string" || !catalog.supportVersion
    || typeof catalog.catalogHash !== "string" || !SHA256_ID.test(catalog.catalogHash)) {
    throw new Error("Java trajectory payload has invalid catalog identity");
  }
  if (!field || typeof field !== "object"
    || typeof field.id !== "string" || !field.id
    || typeof field.revision !== "string" || !field.revision
    || typeof field.coordinateSchemaId !== "string" || !field.coordinateSchemaId) {
    throw new Error("Java trajectory payload has invalid field identity");
  }
  return {
    catalog: {
      catalogId: catalog.catalogId,
      catalogHash: catalog.catalogHash,
      supportVersion: catalog.supportVersion,
    },
    field: {
      id: field.id,
      revision: field.revision,
      coordinateSchemaId: field.coordinateSchemaId,
    },
  };
}

export function buildJavaRevision(trajectory: BuiltJavaTrajectory, request: JavaRevisionRequest): BuiltJavaRevision {
  if (!ACTIVATION_NONCE.test(request.nonce)) {
    throw new Error("Activation nonce must contain 1-256 letters, numbers, dots, underscores, colons, or hyphens");
  }
  if (request.expectedActiveRevisionId !== null && !SHA256_ID.test(request.expectedActiveRevisionId)) {
    throw new Error("Expected active revision ID must be null or sha256:<64 lowercase hex characters>");
  }
  const { catalog, field } = trajectoryMetadata(trajectory);
  const payloadSha256 = `sha256:${trajectory.sha256}`;
  const canonicalRevision = {
    protocolVersion: REVISION_PROTOCOL_VERSION,
    payloadSha256,
    catalog,
    field,
  };
  const revisionId = `sha256:${hash(JSON.stringify(canonicalRevision))}`;
  const document: JavaRevisionDocument = {
    protocolVersion: REVISION_PROTOCOL_VERSION,
    revision: {
      revisionId,
      payloadSha256,
      catalog,
      field,
      payloadEncoding: "base64",
      payload: Buffer.from(trajectory.contents, "utf8").toString("base64"),
    },
    activation: {
      nonce: request.nonce,
      expectedActiveRevisionId: request.expectedActiveRevisionId,
    },
  };
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_REVISION_BYTES) {
    throw new Error(`Java revision envelope exceeds ${MAX_REVISION_BYTES} bytes`);
  }
  return {
    document,
    contents,
    sha256: hash(contents),
    revisionId,
    payloadContents: trajectory.contents,
  };
}
