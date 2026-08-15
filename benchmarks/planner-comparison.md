# Reproducible planner comparison

Run the complete Bordeaux-authored synthetic corpus with the pinned Java 17 and Choreo 2026.0.3 runtimes:

```sh
JAVA_HOME=/absolute/path/to/jdk-17 \
BORDEAUX_CHOREO_CLI=/absolute/path/to/choreo-cli \
npm run benchmark:planners
```

The default protocol runs every fixed-geometry and corridor fixture three times, sequentially in frozen corpus order, with no discarded warmup. Pass `-- --repetitions 5 --warmups 1 --output /absolute/report.json` to request more measured trials and an explicit warmup. The command hashes every corpus input, the complete executed `dist-electron` tree, this runner, the PathPlanner harness and Gradle wrapper, and the resolved Java executable. It also verifies the Choreo binary and version, records the Git revision and hardware/runtime manifest, retains raw inputs, outputs, invocations, and process streams, and requires repeated normalized trajectory-and-event digests to match. These artifact hashes identify the exact executed code even when unrelated workspace files are dirty.

Unsupported concepts are reported and excluded from success-rate denominators. Generated-but-invalid output is disqualified before trajectory time is compared and fails the quality gate. The default end-to-end invocation latency gate is 30 seconds p95 per planner; override it with `-- --latency-gate-ms N` only when the benchmark environment has a documented reason. The JSON report is written atomically to `.benchmark-results/planners.json` even when a gate fails, and this command never enables competitive language; issue #123 owns that decision.

Latency is an operational per-tool metric. The tools use different process lifecycles, so these measurements must not be presented as a cross-planner speed comparison.
