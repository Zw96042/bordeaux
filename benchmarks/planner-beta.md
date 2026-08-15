# Planner external-beta verdict

Generate both raw inputs on the same idle machine, then evaluate the published gates:

```sh
JAVA_HOME=/absolute/path/to/jdk-17 \
BORDEAUX_CHOREO_CLI=/absolute/path/to/choreo-cli \
npm run benchmark:planners

npm run benchmark:renderer:browser
npm run benchmark:planner-beta
```

The verdict command writes `verdict.json` beside byte-identical `planner-raw.json`
and `renderer-raw.json` attachments under `.benchmark-results/planner-beta/`. The
verdict records their SHA-256 digests and embeds the hardware, runtimes, fixtures,
adapter versions, executed-artifact manifest, and raw measured runs needed to audit
the decision.

The gate fails closed unless the frozen comparison has zero invalid outputs, a
median competitor-relative Bordeaux deficit at or below 2%, a p95 deficit at or
below 5%, and Bordeaux wins strictly more than half of comparable cases. It also
requires display-backed raw input-to-correct-paint p95 evidence at or below 30 ms
for the common fixture and 100 ms for the stress fixture. Bordeaux final-planning
runs must stay within 5 seconds for fixed-geometry common cases, 15 seconds for
corridor stress cases, and the 30-second hard timeout.

A rejected verdict exits nonzero and keeps `competitiveClaimsAllowed` false. Do not
change fixtures, omit invalid runs, override thresholds, or use headless-software
renderer timings to turn a rejection into an acceptance.
