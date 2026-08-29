import fs from "node:fs/promises";
import { writeBufferAtomically } from "./projectFiles";
import type { RobotRuntimeStatus } from "./robotSftpTransport";

export interface DeploymentReceipt {
  project: string;
  runtimeId: string;
  catalogHash: string;
  revisionId: string;
  verifiedAt: string;
}

function isReceipt(value: unknown): value is DeploymentReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.project === "string" && item.project.length > 0 && item.project.length < 4096
    && typeof item.runtimeId === "string" && item.runtimeId.length > 0 && item.runtimeId.length < 256
    && typeof item.catalogHash === "string" && /^sha256:[a-f0-9]{64}$/.test(item.catalogHash)
    && typeof item.revisionId === "string" && /^sha256:[a-f0-9]{64}$/.test(item.revisionId)
    && typeof item.verifiedAt === "string" && Number.isFinite(Date.parse(item.verifiedAt));
}

export async function readDeploymentReceipts(file: string): Promise<DeploymentReceipt[]> {
  let contents: string;
  try {
    const info = await fs.stat(file);
    if (info.size > 1024 * 1024) throw new Error("Deployment receipt file exceeds its size limit");
    contents = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const value: unknown = JSON.parse(contents);
  if (!Array.isArray(value) || value.length > 100 || !value.every(isReceipt)) {
    throw new Error("Deployment receipt file is invalid");
  }
  return value;
}

export function hasDeploymentReceipt(receipts: readonly DeploymentReceipt[], target: Omit<DeploymentReceipt, "verifiedAt">): boolean {
  return receipts.some((receipt) => receipt.project === target.project && receipt.runtimeId === target.runtimeId
    && receipt.catalogHash === target.catalogHash && receipt.revisionId === target.revisionId);
}

export function sameDeploymentRevision(before: RobotRuntimeStatus, after: RobotRuntimeStatus): boolean {
  return before.runtimeId === after.runtimeId && before.teamNumber === after.teamNumber
    && before.activeRevisionId === after.activeRevisionId && before.activePayloadSha256 === after.activePayloadSha256
    && before.catalogId === after.catalogId && before.catalogHash === after.catalogHash && before.supportVersion === after.supportVersion
    && before.fieldId === after.fieldId && before.fieldRevision === after.fieldRevision && before.fieldCoordinateSchemaId === after.fieldCoordinateSchemaId;
}

export async function saveDeploymentReceipt(file: string, receipt: DeploymentReceipt): Promise<void> {
  if (!isReceipt(receipt)) throw new Error("Deployment receipt is invalid");
  const existing = await readDeploymentReceipts(file);
  const remaining = existing.filter((entry) => !(entry.project === receipt.project && entry.runtimeId === receipt.runtimeId
    && entry.revisionId === receipt.revisionId));
  await writeBufferAtomically(file, Buffer.from(JSON.stringify([...remaining.slice(-99), receipt]) + "\n"));
}
