import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { RoutineTransport, StepInspector } from '../src/renderer/components/RoutineInspector';
import { routinePathChoices, routinePathUses } from '../src/renderer/lib/routinePathChoices';
import { AUTO } from '../src/renderer/lib/routineModel';

const h = React.createElement;
const timedRun = () => ({
  total: 6, timedPlayable: true, issues: [], duration: { maxS: 6, unknownCount: 0, usesLimits: false },
  steps: [
    { kind: 'path', t0: 0, t1: 4, label: 'Leave the zone', node: { id: 'a', type: 'path' }, occurrenceId: 'a' },
    { kind: 'wait', t0: 4, t1: 6, label: 'Wait', node: { id: 'b', type: 'builtin' }, occurrenceId: 'b' },
  ],
});
const slider = (html) => html.match(/<div[^>]*role="slider"[^>]*>/)[0];

describe('routine transport scrubber', () => {
  it('is a slider whose value names the step playing there', () => {
    const html = renderToStaticMarkup(h(RoutineTransport, { run: timedRun(), time: 2, playing: false, running: true, controls: {} }));
    const element = slider(html);
    expect(element).toContain('aria-label="Routine playback position"');
    expect(element).toContain('aria-valuemax="6"'); expect(element).toContain('aria-valuenow="2"');
    expect(element).toContain('aria-valuetext="2.00 s of 6.00 s, Leave the zone"');
    expect(element).toContain('tabindex="0"'); expect(element).not.toContain('aria-disabled');
    expect(html).toContain('class="rt-timeline-now">Leave the zone<'); expect(html).toContain('>1 of 2<');
    expect(html).toContain('class="rt-timeline-playhead"');
    expect(html).toMatch(/class="rt-timeline-span on"[^>]*title="Leave the zone"/);
  });

  it('shows the run size before playback and no handle when nothing is timed', () => {
    const idle = renderToStaticMarkup(h(RoutineTransport, { run: timedRun(), time: 0, playing: false, running: false, controls: {} }));
    expect(idle).toContain('<small>2 steps</small>'); expect(idle).not.toContain('rt-timeline-now');
    const run = AUTO.buildRun({ nodes: [{ id: 'cmd', type: 'function', cat: 'command', invocation: { commandId: 'x', arguments: {} } }] }, [], {}, {});
    const untimed = renderToStaticMarkup(h(RoutineTransport, { run, time: 0, playing: false, running: false, controls: {} }));
    expect(slider(untimed)).toContain('aria-disabled="true"'); expect(slider(untimed)).toContain('tabindex="-1"');
    expect(untimed).toContain('Nothing to scrub: no step in this preview has a duration');
    expect(untimed).not.toContain('rt-timeline-playhead');
  });
});

describe('routine path choices', () => {
  const paths = [
    { id: 'p1', name: 'Collect', folderId: 'f', waypoints: [{}, {}] },
    { id: 'p2', name: 'Score', waypoints: [{}, {}] },
    { id: 'p3', name: 'Draft', waypoints: [{}] },
  ];
  const routine = { nodes: [{ id: 'a', type: 'path', ref: 'p1' }, { id: 'r', type: 'repeat', times: 2, nodes: [{ id: 'b', type: 'path', ref: 'p1' }, { id: 'c', type: 'path', ref: 'p2' }] }] };

  it('describes folder, library time and use in this routine', () => {
    const uses = routinePathUses(routine);
    expect([...uses]).toEqual([['p1', 2], ['p2', 1]]);
    const choices = routinePathChoices(paths, { folders: [{ id: 'f', name: 'Collection' }], times: { p1: { status: 'ready', seconds: 4 }, p2: { status: 'pending' } }, uses });
    expect(choices.map((choice) => choice.meta)).toEqual(['Collection · 4.00 s · Used 2× in this routine', 'In this routine', 'Not timed yet']);
  });

  it('shows the chosen path as a card with Change path, and keeps the list open for a deleted path', () => {
    const acq = { set: vi.fn(), select() {}, del() {}, openInEditor() {} };
    const render = (ref) => renderToStaticMarkup(h(StepInspector, { node: { id: 'a', type: 'path', ref }, routine, paths, pathFolders: [{ id: 'f', name: 'Collection' }], pathTimes: {}, acq, run: { segs: [], issues: [] } }));
    const chosen = render('p1');
    expect(chosen).toMatch(/class="choice-current"[\s\S]*<strong>Collect<\/strong><small>Collection · Used 2× in this routine<\/small>/);
    expect(chosen).toContain('>Change path<'); expect(chosen).not.toContain('routine-bound-path-results');
    const missing = render('gone');
    expect(missing).not.toContain('choice-current');
    expect(missing).toContain('id="routine-bound-path-results"'); expect(missing).toContain('placeholder="Search paths or folders"');
  });
});
