import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import electron from "electron";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// The GUI smoke owns machine-wide desktop focus, even across separate clones.
const smokeLockPort = 24968;

async function acquireSmokeLock() {
  const deadline = Date.now() + 60000;
  while (true) {
    const server = net.createServer((socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen({ host: "127.0.0.1", port: smokeLockPort, exclusive: true }, () => {
          server.off("error", onError);
          resolve();
        });
      });
      return server;
    } catch (error) {
      if (error?.code !== "EADDRINUSE" || Date.now() >= deadline) {
        throw new Error("Could not acquire the Bordeaux Electron smoke lock.", { cause: error });
      }
      await delay(100);
    }
  }
}

const smokeLock = await acquireSmokeLock();
let smokeDirectory;
try {
  smokeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-electron-smoke-"));
  const javaSourceDirectory = path.join(smokeDirectory, "java-project", "src", "main", "java", "frc", "robot");
  await fs.mkdir(javaSourceDirectory, { recursive: true });
  await fs.writeFile(path.join(smokeDirectory, "java-project", "build.gradle"), "plugins { id 'java'; id 'edu.wpi.first.GradleRIO' version '2026.2.2' }\n");
  await fs.writeFile(path.join(smokeDirectory, "java-project", "settings.gradle"), "rootProject.name = 'SmokeRobot'\n");
  await fs.writeFile(path.join(javaSourceDirectory, "SmokeCommand.java"), `
package frc.robot;
import edu.wpi.first.wpilibj2.command.CommandBase;
import java.util.List;
public final class SmokeCommand extends CommandBase {
  public SmokeCommand(int count, List<String> tags, long sequence) {}
}
`);
  await fs.writeFile(path.join(javaSourceDirectory, "IdleCommand.java"), `
package frc.robot;
import edu.wpi.first.wpilibj2.command.CommandBase;
public final class IdleCommand extends CommandBase {}
`);

  const canonicalJson = (value) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  };
  const commands = [{
    id: "frc.robot.SmokeCommand",
    label: "Smoke Command",
    description: "Exercises generated command metadata in the desktop smoke test.",
    ownerType: "frc.robot.SmokeCommand",
    member: "<init>",
    kind: "constructor",
    confidence: "confirmed",
    parameters: [
      { name: "count", label: "Count", description: "Number of cycles.", unit: "cycles", defaultValue: 2, min: 1, max: 9, javaType: "int", role: "argument", schema: { kind: "integer", javaType: "int" } },
      { name: "sequence", label: "Sequence", defaultValue: "9007199254740993", min: "0", max: "9223372036854775807", javaType: "long", role: "argument", schema: { kind: "integerString", javaType: "long" } },
      { name: "tags", label: "Tags", defaultValue: ["auto"], javaType: "java.util.List<java.lang.String>", role: "argument", schema: { kind: "array", javaType: "java.util.List<java.lang.String>", element: { kind: "string", javaType: "java.lang.String" } } },
    ],
    source: { file: "src/main/java/frc/robot/SmokeCommand.java", line: 4 },
  }, {
    id: "frc.robot.LargeEnumCommand",
    label: "Choose Autonomous Mode",
    description: "Exercises the searchable large-enum picker.",
    ownerType: "frc.robot.LargeEnumCommand",
    member: "<init>",
    kind: "constructor",
    confidence: "confirmed",
    parameters: [{
      name: "mode",
      label: "Autonomous mode",
      defaultValue: "MODE_001",
      javaType: "frc.robot.AutonomousMode",
      role: "argument",
      schema: {
        kind: "enum",
        javaType: "frc.robot.AutonomousMode",
        enumValues: Array.from({ length: 160 }, (_, index) => `MODE_${String(index + 1).padStart(3, "0")}`),
      },
    }],
    source: { file: "src/main/java/frc/robot/LargeEnumCommand.java", line: 1 },
  }];
  const catalogHash = `sha256:${createHash("sha256").update(canonicalJson(commands), "utf8").digest("hex")}`;
  const smokeCatalog = { schemaVersion: "1.0", catalogId: "SmokeRobot", supportVersion: "0.1.0", catalogHash, commands };
  const supportDirectory = path.join(smokeDirectory, "java-project", ".bordeaux");
  await fs.mkdir(supportDirectory, { recursive: true });
  await fs.writeFile(path.join(supportDirectory, "smoke-catalog.json"), `${JSON.stringify(smokeCatalog, null, 2)}\n`);
  const unixWrapper = `#!/bin/sh\nset -eu\nmkdir -p build/bordeaux\ncp .bordeaux/smoke-catalog.json build/bordeaux/catalog-v1.json\nprintf 'Smoke Bordeaux catalog built\\n'\n`;
  const windowsWrapper = `@echo off\r\nif not exist build\\bordeaux mkdir build\\bordeaux\r\ncopy /Y .bordeaux\\smoke-catalog.json build\\bordeaux\\catalog-v1.json >NUL\r\necho Smoke Bordeaux catalog built\r\n`;
  await fs.writeFile(path.join(smokeDirectory, "java-project", "gradlew"), unixWrapper, { mode: 0o755 });
  await fs.writeFile(path.join(smokeDirectory, "java-project", "gradlew.bat"), windowsWrapper);

  const packagedExecutable = process.env.BORDEAUX_SMOKE_EXECUTABLE;
  const childEnvironment = { ...process.env, BORDEAUX_SMOKE_TEST: "1", BORDEAUX_SMOKE_DIRECTORY: smokeDirectory };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawn(packagedExecutable || electron, packagedExecutable ? ["--enable-mcp-access"] : ["dist-electron/electron/main.js", "--enable-mcp-access"], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });

  const timeout = setTimeout(() => child.kill("SIGTERM"), 30000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }

  if (code !== 0 || !output.includes("BORDEAUX_SMOKE_OK")) {
    throw new Error(`Electron smoke test failed with exit code ${code}`);
  }
} finally {
  try {
    if (smokeDirectory) await fs.rm(smokeDirectory, { recursive: true, force: true });
  } finally {
    await new Promise((resolve, reject) => smokeLock.close((error) => error ? reject(error) : resolve()));
  }
}
