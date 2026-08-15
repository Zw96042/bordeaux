import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
const benchmark = path.join(repository, "scripts", "benchmark-renderer-browser.mjs");
const preInstrumentationBaseline = "672332a6a2540a14109f540b84eb9cf34a3826ab";

test("browser benchmark compares a pre-instrumentation baseline without requiring its worker observer", { timeout: 120_000 }, async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-browser-benchmark-regression-"));
  const output = path.join(temporaryDirectory, "report.json");
  const benchmarkArgs = [
    benchmark,
    "--baseline", preInstrumentationBaseline,
    "--candidate", "HEAD",
    "--comparison-only",
    "--trials", "2",
    "--latency-samples", "1",
    "--stress-ms", "100",
    "--variant-timeout-ms", "45000",
    "--output", output,
  ];
  const useXvfb = process.platform === "linux" && !process.env.DISPLAY && existsSync("/usr/bin/xvfb-run");
  const executable = useXvfb ? "/usr/bin/xvfb-run" : process.execPath;
  const args = useXvfb ? ["-a", process.execPath, ...benchmarkArgs] : benchmarkArgs;

  try {
    await execute(executable, args, {
      cwd: repository,
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 115_000,
    });

    const report = JSON.parse(await fs.readFile(output, "utf8"));
    assert.equal(report.revisions.upstream, preInstrumentationBaseline.slice(0, 12));
    assert.ok(report.variants.upstream.rawTrials.length > 0);
    assert.ok(report.variants.candidate.rawTrials.length > 0);
    assert.equal(report.variants.candidate.correctness, null);
    assert.equal(report.variants.candidate.interactivePlanning.common.rawSamples.length, 2);
    assert.equal(report.variants.candidate.interactivePlanning.stress.rawSamples.length, 2);

    for (const trial of report.variants.upstream.rawTrials) {
      assert.equal(trial.commonLatency.transport.preflightWorkerTransport, null);
      assert.equal(trial.commonLatency.applicationWorkerTransport, null);
      assert.equal(trial.latency.transport.preflightWorkerTransport, null);
      assert.equal(trial.latency.applicationWorkerTransport, null);
      assert.equal(trial.stress.transport.preflightWorkerTransport, null);
      assert.equal(trial.stress.applicationWorkerTransport, null);
    }

    for (const trial of report.variants.candidate.rawTrials) {
      assert.equal(trial.commonLatency.transport.preflightWorkerTransport, true);
      assert.equal(trial.commonLatency.applicationWorkerTransport, true);
      assert.equal(trial.latency.transport.preflightWorkerTransport, true);
      assert.equal(trial.latency.applicationWorkerTransport, true);
      assert.equal(trial.stress.transport.preflightWorkerTransport, true);
      assert.equal(trial.stress.applicationWorkerTransport, true);
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
