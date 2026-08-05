import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const task = process.argv[2];
if (task !== "build" && task !== "test") {
  console.error("Usage: node scripts/build-java.mjs <build|test>");
  process.exit(2);
}

const projectRoot = process.cwd();
const javaRoot = path.join(projectRoot, "java");
const wrapper = path.join(javaRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const gradleArguments = [task, "--no-daemon", "--console=plain"];
const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : wrapper;
if (process.platform === "win32" && /[&|<>^%!]/.test(wrapper)) {
  console.error("Repository path contains characters that cannot be launched safely by cmd.exe.");
  process.exit(1);
}
const commandArguments = process.platform === "win32"
  ? ["/d", "/s", "/c", `"${wrapper}" ${gradleArguments.join(" ")}`]
  : gradleArguments;

const child = spawn(command, commandArguments, { cwd: javaRoot, stdio: "inherit", windowsHide: true });
child.once("error", (error) => {
  console.error(`Could not start the Bordeaux Java build: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Bordeaux Java build stopped by ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
