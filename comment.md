I compared these behaviors against the base branch. The following regressions are introduced by this change:

- Active drags now live only in the temporary edit store until pointer-up, while dirty state, autosave, save, export, and the close guard still read the committed project. Closing during a drag can lose the visible edit without warning, and saving during a drag saves the old path. Before this change, drag updates wrote directly to the project.

- Undo now races the temporary drag state. I held a waypoint drag, pressed Cmd+Z, and released the pointer; the moved point returned, the next undo did nothing, and redo restored the old position. The previous implementation did not write a separate draft back on pointer-up.

- Cached previews are matched by path ID even though that ID does not change between revisions. This can pair old geometry with a newer waypoint list and use it for segment hit-testing, allowing a quick follow-up insertion to target the wrong segment. The preview cache and this mismatch are new in this change.

- The new worker scheduler can starve curve updates during continuous input. It discards a completed result whenever a newer request exists, so if work takes longer than the input interval, every result can be rejected until the pointer stops.

- The new preview schedulers are created during render and permanently destroyed by effect cleanup. StrictMode replays that cleanup in development, leaving the retained scheduler destroyed and later requests as no-ops. I reproduced the waypoint moving while the centerline never updated.

- A runtime failure in the new worker keeps the failed worker and sends later jobs back to it. Those requests can remain pending forever because posting and message-decoding failures are not handled with a fallback or worker replacement.

- The new range helper expands ranges to the sampled point before the start and the sampled point after the end. That makes visible bands and transparent hit targets extend outside their authored bounds. It also creates a new mismatch where a short live preview can be empty and then appear as a much larger committed range.

Separately, the performance claims are not reproducible from the submitted changes. There is no committed benchmark, fixture, trace, hardware or refresh-rate information, warmup policy, or run count. The tests replace the real worker, so they do not exercise the StrictMode lifecycle, worker loading, result copying, or stale preview integration.

The existing tests, typecheck, renderer verification, production build, and Electron smoke test all pass. The worker approach is reasonable, but these regressions should be fixed and covered before merge.
