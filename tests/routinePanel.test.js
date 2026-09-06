import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoutinePanel } from '../src/renderer/components/RoutinePanel';
import { AUTO } from '../src/renderer/lib/routineModel';
import { createDemoProject } from '../src/shared/project/defaults';
import { getPlanner } from '../src/shared/planners';

function renderMetadata(project, routine, planning, outcomes = {}) {
  const run = AUTO.buildRun(routine, project.paths, project.robot, outcomes, project.plannerId, undefined, planning);
  const markup = renderToStaticMarkup(React.createElement(RoutinePanel, {
    routine, paths: project.paths, run, time: 0, running: false, acq: { outcomes },
  }));
  return (id) => markup.match(new RegExp('data-id="' + id + '"[\\s\\S]*?class="rt-step-meta">([^<]*)'))?.[1];
}

describe('routine path preview status', () => {
  it('shows preparation, then timing when a path is added or its reference changes', () => {
    const project = createDemoProject();
    project.paths.push({ ...structuredClone(project.paths[0]), id: 'replacement', name: 'Replacement path' });
    for (const path of project.paths) {
      const routine = { name: 'Routine', nodes: [{ id: 'drive', type: 'path', ref: path.id }] };
      expect(renderMetadata(project, routine, { status: 'pending', values: {} })('drive')).toBe('Preparing preview…');
      const trajectory = getPlanner('profiledSpline').generate({ path, robot: project.robot, samplesPerSegment: 14 });
      const ready = { status: 'ready', values: { [path.id]: { finalTrajectory: trajectory, sample: { length: trajectory.totalDistanceM } } } };
      expect(renderMetadata(project, routine, ready)('drive')).toMatch(/^\d+\.\d{2}s/);
    }
  });

  it.each(['pending', 'error'])('keeps unchosen and nested unchosen branches skipped while planning is %s', (status) => {
    const project = createDemoProject();
    const pathNode = (id) => ({ id, type: 'path', ref: project.paths[0].id });
    const routine = { name: 'Routine', nodes: [{ id: 'decision', type: 'decision', then: [pathNode('true-path')], else: [
      { id: 'nested', type: 'decision', then: [pathNode('nested-true')], else: [pathNode('nested-false')] },
    ] }] };
    const metadata = renderMetadata(project, routine, { status, values: {}, error: status === 'error' ? 'Planning failed' : '' });
    expect(metadata('true-path')).toBe(status === 'pending' ? 'Preparing preview…' : 'Preview unavailable');
    expect(metadata('nested-true')).toBe('Skipped in this preview');
    expect(metadata('nested-false')).toBe('Skipped in this preview');
    const alternate = renderMetadata(project, routine, { status, values: {} }, { decision: 'else', nested: 'else' });
    expect(alternate('true-path')).toBe('Skipped in this preview');
    expect(alternate('nested-true')).toBe('Skipped in this preview');
    expect(alternate('nested-false')).toBe(status === 'pending' ? 'Preparing preview…' : 'Preview unavailable');
  });

  it('distinguishes an unavailable selected trajectory from an unbound path', () => {
    const project = createDemoProject();
    const routine = { name: 'Routine', nodes: [
      { id: 'drive', type: 'path', ref: project.paths[0].id },
      { id: 'missing', type: 'path', ref: 'deleted-path' },
    ] };
    const metadata = renderMetadata(project, routine, { status: 'ready', values: {} });
    expect(metadata('drive')).toBe('No trajectory available');
    expect(metadata('missing')).toBe('Choose a path');
  });
});
