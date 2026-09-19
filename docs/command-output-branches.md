# Command output branches

Routine commands can optionally branch on a declared output after completion. The inspector offers Boolean routes, one route per named enum value, or ordered numeric comparisons with a final Otherwise route. Users add steps under each route and choose a route for desktop preview. Routes rejoin the next sibling step.

This is GUI authoring and local persistence only. The desktop preview does not execute commands or evaluate real output values. Routine export must reject any command with `outputBranch` until a versioned robot execution contract exists. Path-only BDX export remains independent. Do not make these routines deployable by dropping their branch metadata.

`RobotCommandDescriptor.outputs` comes from verified NI connector metadata for supported top-level scalar output terminals. `Command Status Info.ctl` terminals remain lifecycle plumbing. Unsupported outputs are reported independently, preserving supported command inputs and outputs. Live NI inspection requires Windows with LabVIEW; supported cached metadata can be read on other hosts.

`RoutineFunctionNode.outputBranch` stores the selected output name, its schema snapshot, and ordered routes. Each route has a stable ID, label, comparison, optional typed value, and nested routine nodes. Boolean routes cover True and False. Enum/numeric routes include exactly one final Otherwise route. Comparisons are first-match; exact 64-bit thresholds stay strings. At most 256 routes are accepted. Preview outcomes use the parent command node ID and selected route ID.

Changing a command or output preserves work until the user confirms removal of populated routes. Missing outputs and changed schemas stay visible for recovery. Existing condition decisions and event gates load as legacy data; new condition authoring is removed. No automatic predicate-to-command migration is assumed.

Verification:

- `npm test -- tests`: repository tests, including branch persistence, traversal, legacy migration, NI parsing, and export rejection.
- `npm run typecheck` and `npm run build`.
- `node scripts/verify-command-branches-ui.mjs`: built-app checks with an isolated project, mocked catalog/filesystem, pointer and keyboard input, route editing, save/reload, and screenshots at 1440×900 and 1100×720. It does not verify live NI or robot execution.

See `.plans/2026-09-19_command_output_branches_and_robot_execution.html` for the future execution contract, scheduler semantics, migration, and acceptance criteria.
