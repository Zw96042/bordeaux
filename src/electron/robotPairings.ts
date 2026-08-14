import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomically } from "./projectFiles";
import {
  ROBOT_DEPLOYMENT_NAMESPACE,
  ROBOT_PUSH_PROTOCOL_VERSION,
  confirmRobotPairing,
  type RobotPairing,
  type RobotProbe,
} from "./robotSftpTransport";

const STORAGE_VERSION = 1;
const MAX_PAIRING_BYTES = 32 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePairing(value: unknown): RobotPairing {
  if (!isRecord(value) || !isRecord(value.endpoint)) throw new Error("Robot pairing storage is invalid");
  const endpoint = value.endpoint;
  if (!Number.isSafeInteger(value.teamNumber) || (value.teamNumber as number) <= 0 || (value.teamNumber as number) > 99_999
    || typeof endpoint.host !== "string" || endpoint.host.length === 0 || endpoint.host.length > 253
    || !/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(endpoint.host)
    || !Number.isInteger(endpoint.port) || (endpoint.port as number) < 1 || (endpoint.port as number) > 65_535
    || typeof value.runtimeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runtimeId)
    || typeof value.hostKeyFingerprint !== "string" || !/^SHA256:[A-Za-z0-9+/]{20,128}$/.test(value.hostKeyFingerprint)
    || value.protocolVersion !== ROBOT_PUSH_PROTOCOL_VERSION
    || value.deploymentNamespace !== ROBOT_DEPLOYMENT_NAMESPACE
    || typeof value.pairedAt !== "string" || !Number.isFinite(Date.parse(value.pairedAt))) {
    throw new Error("Robot pairing storage is invalid");
  }
  const id = `robot-${value.teamNumber}-${value.runtimeId.slice(0, 8)}`;
  if (value.id !== id) throw new Error("Robot pairing storage identity is invalid");
  return {
    id,
    teamNumber: value.teamNumber as number,
    endpoint: { host: endpoint.host, port: endpoint.port as number },
    hostKeyFingerprint: value.hostKeyFingerprint,
    runtimeId: value.runtimeId,
    protocolVersion: ROBOT_PUSH_PROTOCOL_VERSION,
    deploymentNamespace: ROBOT_DEPLOYMENT_NAMESPACE,
    pairedAt: new Date(value.pairedAt).toISOString(),
  };
}

export async function readRobotPairing(filePath: string): Promise<RobotPairing | null> {
  let stat;
  try { stat = await fs.lstat(filePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Robot pairing storage must be a regular file");
  if (stat.size > MAX_PAIRING_BYTES) throw new Error("Robot pairing storage exceeds its size limit");
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) throw new Error("Robot pairing storage version is unsupported");
  return normalizePairing(parsed.pairing);
}

export async function writeRobotPairing(filePath: string, pairing: RobotPairing): Promise<void> {
  const normalized = normalizePairing(pairing);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomically(filePath, { version: STORAGE_VERSION, pairing: normalized });
}

/** Serializes the deliberate probe/confirm transition without exposing SFTP operations to callers. */
export class RobotPairingController {
  private pairing: RobotPairing | null;
  private pendingProbe: RobotProbe | null = null;
  private probeGeneration = 0;
  private confirming = false;

  constructor(initial: RobotPairing | null = null, private readonly now = () => new Date().toISOString()) {
    this.pairing = initial;
  }

  current(): RobotPairing | null {
    return this.pairing;
  }

  async probe(operation: () => Promise<RobotProbe>): Promise<RobotProbe> {
    if (this.confirming) throw new Error("The current robot pairing confirmation is still being saved");
    const generation = ++this.probeGeneration;
    this.pendingProbe = null;
    const probe = await operation();
    if (generation !== this.probeGeneration) throw new Error("A newer robot probe replaced this result");
    this.pendingProbe = probe;
    return probe;
  }

  async confirm(
    acceptedHostKeyFingerprint: string,
    acceptedRuntimeId: string,
    persist: (pairing: RobotPairing) => Promise<void>,
  ): Promise<RobotPairing> {
    if (this.confirming) throw new Error("The current robot pairing confirmation is still being saved");
    const probe = this.pendingProbe;
    if (!probe) throw new Error("Probe the robot before confirming its identity");
    const pairing = confirmRobotPairing({
      probe,
      acceptedHostKeyFingerprint,
      acceptedRuntimeId,
      pairedAt: this.now(),
    });
    this.confirming = true;
    this.pendingProbe = null;
    this.probeGeneration += 1;
    try {
      await persist(pairing);
      this.pairing = pairing;
      return pairing;
    } catch (error) {
      this.pendingProbe = probe;
      throw error;
    } finally {
      this.confirming = false;
    }
  }
}
