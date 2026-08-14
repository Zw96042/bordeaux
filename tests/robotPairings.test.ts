import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRobotPairing, writeRobotPairing } from "../src/electron/robotPairings";
import type { RobotPairing } from "../src/electron/robotSftpTransport";

const temporaryDirectories: string[] = [];

async function temporaryFile(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-pairing-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "robot-pairing.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const pairing: RobotPairing = {
  id: "robot-2468-a0d7440d",
  teamNumber: 2468,
  endpoint: { host: "10.24.68.2", port: 22 },
  hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
  runtimeId: "a0d7440d-d346-4ae4-a58b-7efd622b71d0",
  protocolVersion: "bordeaux-robot-push/1.0",
  deploymentNamespace: "/home/lvuser/deploy/bordeaux/push-v1",
  pairedAt: "2026-08-14T18:30:00.000Z",
};

describe("robot pairing storage", () => {
  it("round-trips the one explicitly trusted robot identity", async () => {
    const file = await temporaryFile();

    await writeRobotPairing(file, pairing);

    await expect(readRobotPairing(file)).resolves.toEqual(pairing);
  });
});
