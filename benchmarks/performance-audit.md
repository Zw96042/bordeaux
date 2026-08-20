# Performance regression checks

Run these from the current working tree with Node >=22.12. The microbenchmarks
measure CPU work and Java source discovery; they do not establish end-to-end UI
speedups or safe robot operation. Run them sequentially on an otherwise idle
machine, preserve the source state for both variants, and compare warmed medians.
Absolute timing assertions are deliberately excluded from the correctness suite.

```sh
npm run build:electron
node scripts/performance-planner-hotpaths.mjs
node scripts/performance-renderer.mjs
node scripts/performance-geometry.mjs
node scripts/performance-electron-java-discovery.mjs
npx vitest run tests/performancePlannerHotpaths.test.ts tests/performanceRenderer.test.ts tests/performanceGeometry.test.ts tests/performanceElectronJavaProject.test.ts
```

The planner script optionally accepts another compiled output tree. The Java
script optionally accepts another compiled `javaProject` module. The geometry
script accepts a saved source module through `BORDEAUX_GEOMETRY_MODULE`, resolved
by Vite from the repository root. Preserve compatible dependencies when comparing
old modules. The renderer script always measures the current source tree.

| Script | Workloads | Correctness boundary |
| --- | --- | --- |
| `performance-planner-hotpaths.mjs` | Dense heading anchors, long stationary runs, curved reachability, captured rotation-target turn | Sorted anchor ties, distinct-distance neighbors and explicit heading breaks, unchanged trajectory samples |
| `performance-renderer.mjs` | Dense final projection, long routine playback, accepted-artifact worker dispatch, repeated fallback path steps | Fraction/position tolerances and nonmonotonic fallback, earliest step at boundaries, final artifact retention, cache lifetime |
| `performance-geometry.mjs` | 10,000 field-clearance and portal observations | Signed overlapping clearance, exact polygon fallback, original closest-sample tie behavior |
| `performance-electron-java-discovery.mjs` | 4,000 methods, 6,000 types, 800 files | Source locations, Java type precedence/ambiguity, deterministic order, bounded concurrent I/O and source-byte budgets |

The new regression tests enforce operation bounds and output semantics rather
than machine-specific milliseconds. For browser behavior also build with
`npm run verify:renderer` and follow `docs/agents/ui-review.md`. The separate
`benchmark:renderer:browser` command archives Git refs: it does **not** include
uncommitted changes. Its result must not be presented as working-tree evidence.
