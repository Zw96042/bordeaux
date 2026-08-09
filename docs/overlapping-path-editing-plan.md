# Editing overlapping visits in one path

## Problem

A single ordered path may drive through the same field location more than once. Those are different **visits** to the same geometry: they can occur at different distances, times, headings, velocities, and constraint ranges even when their screen-space strokes overlap exactly.

The current editor cannot reliably distinguish them:

- segment hit paths overlap in SVG paint order, so the last rendered hit path wins;
- `nearestFraction` returns one globally nearest path sample, so a constraint can jump to the wrong visit;
- coincident waypoints and tangent handles compete for the same pointer target;
- color and line thickness alone cannot explain which occurrence in the path sequence is being edited.

This should be solved inside one path. It should not require duplicating the path or permanently moving geometry away from its real field position.

## Options considered

### 1. Repeated-click cycling

Clicking the same location repeatedly cycles through every segment or path visit under the pointer.

**Good:** small implementation and no persistent UI.

**Bad:** poor discoverability, selection is hard to confirm, and range dragging can still jump after pointer-down. It works as a fallback shortcut, not as the whole model.

### 2. Exploded or offset paths

Temporarily draw overlapping visits in parallel lanes so each can be clicked.

**Good:** makes every visit visible and directly selectable.

**Bad:** the displayed geometry is no longer the authored geometry. Waypoint and tangent dragging becomes ambiguous, field clearances look wrong, and the view shifts when entering or leaving the mode.

This is useful as an optional inspection view, not as the primary editor.

### 3. Persistent user-created layers

Let users assign segments to named layers or passes and choose which layer is editable.

**Good:** predictable for large autonomous routines and can support organization beyond overlap handling.

**Bad:** adds project structure that must be maintained during insertion, deletion, reversal, and import. Users must organize the path before fixing a selection problem, and self-overlap inside one segment still needs another solution.

### 4. Sequence strip or timeline-first editing

Add a full path-distance strip where users select the intended visit by time or distance, then edit it on the field.

**Good:** unambiguous, scales to long paths, and naturally exposes timing and constraints.

**Bad:** consumes permanent screen space and makes simple field edits feel indirect. It is a strong future feature, but too heavy as the only selection mechanism.

### 5. Visit-aware focus with conflict cycling — recommended

Treat every spatial occurrence as a path **visit**, identified by its position in the ordered trajectory, not only by segment number. Resolve all nearby visits under the pointer, select one, then latch editing to that visit until the user changes it.

**Good:** keeps true geometry on the field, works without new persisted project structure, supports self-overlap, and gives constraint dragging a stable path-distance branch.

**Tradeoff:** needs a real candidate resolver and a small amount of selection UI. This is more work than click cycling but fixes the underlying ambiguity instead of hiding it.

## Recommended interaction

### Default view

- Render the complete path normally.
- When the pointer is over one visit, keep current click behavior.
- When it is over multiple visits, show a quiet `1 of 3 visits` indicator near the pointer or inspector header.
- Clicking selects the best candidate. Clicking again, `[` / `]`, or compact previous/next buttons cycles the candidates.
- The selected visit is drawn in the normal accent. Other coincident visits stay visible but are muted and do not steal drag events.
- `Escape` clears visit focus. Selecting a segment in the outline establishes visit focus immediately.

### Waypoints and tangents

- Render the selected waypoint and its handles last so they are always draggable.
- If multiple waypoint nodes occupy the same screen point, use the same visit cycler.
- While a waypoint is selected, overlapping unselected waypoint/handle hit areas become inert; their geometry stays visible.
- Keep tangent coordinates in true field space. Do not offset authored handles to make them selectable.

### Constraint ranges

- Pointer-down resolves and latches a specific path-distance candidate `{segment, localT, distance}`.
- During the drag, choose the nearby candidate closest in ordered path distance to the previous endpoint, with hysteresis that prevents jumping to a distant visit at the same field point.
- Show both range endpoints on the selected visit while dragging.
- Store the result using the existing proportional or segment-local range representation. No new export format is needed.
- If the pointer intentionally crosses to another visit, require cycling the active visit or restarting the drag; never switch silently.

### Rotation targets and event markers

- Place targets and markers on the explicitly selected visit instead of using a global nearest fraction.
- Latch their visit while dragging so an exact overlap cannot silently move the feature to an earlier or later occurrence.
- Keep the existing path-distance storage. Visit-aware projection chooses the correct fraction; it does not require a new feature schema.
- Selecting a target or marker from the outline restores its visit focus on the field.

### Visual treatment

- Do not turn every pass into a different permanent color; velocity and other overlays already use color semantically.
- Use accent thickness/opacity for the active visit and a subtle short tick stack at an overlap conflict.
- Keep the indicator flat and compact—no floating card unless the conflict contains enough candidates to require a searchable list.
- An optional future “spread visits” inspection mode may offset strokes visually, but dragging should remain disabled or projected against the true ghost path in that mode.

## Candidate resolver

The resolver should work on sampled polyline edges rather than only sample points:

1. Project the pointer onto every nearby polyline edge in screen space.
2. Produce candidates containing screen distance, path distance/fraction, segment index, and local segment parameter.
3. Cluster adjacent samples that describe the same visit.
4. Keep candidates separated when their ordered path distances differ, even if their field coordinates and segment index are identical.
5. Rank by screen distance, then current visit/segment affinity, then path order for deterministic ties.

Use a screen-pixel tolerance so selection does not change with zoom.

## Implementation phases

### Phase 1 — visit selection

- Add and test a pure `nearestVisits` geometry helper.
- Add transient `activeVisit` and conflict-candidate state to the field editor.
- Add the compact conflict indicator and keyboard cycling.
- Route segment selection, explicit waypoint insertion, rotation-target placement, and event-marker placement through the chosen visit.

### Phase 2 — stable constraints

- Start constraint drags from an explicit candidate rather than global `nearestFraction`.
- Add continuity-aware endpoint projection and hysteresis.
- Use the same latched projection for dragging rotation targets and event markers.
- Verify proportional and local range anchors through edits and reversal.

### Phase 3 — coincident controls

- Render selected waypoint/control handles last.
- Disable competing hit areas while a visit is focused.
- Add coincident-waypoint cycling and outline-to-field focus synchronization.

### Phase 4 — optional inspection tools

- Evaluate a sequence strip for long routines.
- Evaluate an explicit “spread visits” read-only view.
- Only add persisted named layers if real projects show that automatic visit focus is insufficient for organization.

## Success criteria

- Every overlapping occurrence can be selected without creating another path.
- A range started on one visit never jumps to another visit during a normal drag.
- Rotation targets and event markers remain attached to the chosen visit during placement and dragging.
- Selected coincident waypoints and tangents remain draggable.
- Selection remains deterministic across zoom levels.
- Existing project files and Java trajectory export require no schema change for phases 1–3.
- Simple non-overlapping paths retain the current one-click workflow with no extra UI.
