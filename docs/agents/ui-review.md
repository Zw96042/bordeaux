# UI review before shipping

For renderer changes, review the affected workflow in the built app before calling it complete. Passing source assertions, line-box measurements, and the desktop smoke test do not establish visual quality. The owner should not be the first person to see the changed screen.

## Product conventions

- Use sentence-case labels. Distinguish groups with spacing and weight; avoid uppercase microheaders, repeated badges, and nested containers that do not help a decision.
- Keep primary item names readable. Move secondary metadata below a name or allow wrapping before truncating it. A tooltip does not replace a usable label.
- Align shared content and action columns. Reserve action space so hover, selection, and async values do not move labels. Inspect visible text, not only bounding boxes.
- Give each action one predictable meaning. Plain selection must not delete objects. Shift-click explicitly deletes authored field and outline features; library Shift selection remains a range gesture. Create spatial features through deliberate placement on the field.
- Keep ordinary successful background work quiet. Separate loading, failure, and ready states; errors get one explanation and a usable recovery action.
- Show units consistently wherever the same quantity appears. Convert at the display/input boundary, preserving canonical stored values.
- Reuse the existing menu, dialog, row, and field patterns. Check their actual token definitions and keyboard behavior before introducing another variant.
- Preserve the robot boundary: local Save, explicit scoped Push, immutable revision review, and verified acceptance remain distinct.

## Verification for a UI change

1. Build the renderer with `npm run verify:renderer` and run the focused behavior tests appropriate to the change.
2. Inspect affected screens at 1440×900 and the native minimum 1100×720, with inspector open and closed where applicable. Below-minimum experiments are useful but do not replace supported-size checks.
3. Exercise representative data: long names, multiple digits, badges, expanded sections, a populated routine branch, and both unit systems. Include empty, pending, failure, disabled, and restored-project states where affected.
4. Use real pointer and keyboard input for the changed interaction: Tab, Enter/Space, Escape, applicable arrow keys, focus return, and selection modifiers. Programmatic `.click()` alone does not prove keyboard or pointer behavior.
5. Capture and personally inspect the final rendered result after the last relevant edit. Ensure text/actions are readable and reachable, metadata does not collide, and ordinary work does not accumulate banners.
6. For a changed flow or shared UI primitive, obtain an independent read-only review. Report exact coverage and limitations; do not imply untested platforms, hardware, or states passed.

Existing local harnesses:

- `node scripts/verify-project-folder-ui.mjs`: folder selection/cancel, New, Save and BDX failure/retry, autosave error retention, keyboard navigation, and explicit legacy file command using mocked filesystem dialogs.
- `node scripts/verify-library-ui.mjs`: paths, routines, settings, and mocked push integration.
- `node scripts/verify-robot-push-ui.mjs`: legacy mocked activation controller transitions.
- `node scripts/verify-robot-file-push-ui.mjs`: direct SFTP connection, SSH identity, immutable file review, upload/readback success and failure using mocked transport.
- `node scripts/verify-optimizer-ui.mjs`: optimizer comparison, exact apply/save/reload timing, units, keyboard reorder, and current-normal routine fallback.

Use isolated fixtures and mock robot transports for UI checks. Report a failing check as failing. Do not weaken assertions to get a green result; distinguish an obsolete expectation from a product regression using code and rendered behavior.

## Release evidence

Before a production release, review the whole screen/state matrix: path summary and each feature inspector; routine flow, branch editing and playback; settings and custom footprint; optimizer idle/running/result/failure; connection identity review, push review, upload, acceptance/unconfirmed/rejected outcomes; project open/save and diagnostics.

Record the commit plus any working-tree changes, sizes, screenshots inspected, commands/results, blocking findings, and reviewer. A UI-affecting change after this review requires rechecking the affected states.

Do not sign off with unresolved unintended destructive gestures, incorrect displayed units, inaccessible primary actions, clipped essential content, or failure states presented as indefinite loading. Track lesser consistency issues explicitly.

CI runs these UI harnesses under Xvfb after the build and uploads screenshots and results as `ui-verification`, including artifacts from failed checks. Local runs use isolated temporary directories; set `BORDEAUX_LIBRARY_UI_OUTPUT`, `BORDEAUX_OPTIMIZER_UI_OUTPUT`, or `BORDEAUX_PUSH_UI_OUTPUT` to retain evidence at a chosen location. Use a fresh directory to avoid reusing test preferences. Screenshots still require human or agent visual inspection; passing automated checks alone is not a visual sign-off.
