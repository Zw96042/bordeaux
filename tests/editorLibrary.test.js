import { describe, expect, it } from 'vitest';
import { referencingRoutines, selectedPathIds } from '../src/renderer/components/EditorLibrary';

describe('library path references', () => {
  it('blocks deletion for either decision route and generated fallback branches', () => {
    const routines = [
      { id: 'first', nodes: [{ type: 'decision', then: [{ type: 'path', ref: 'A' }], else: [{ type: 'path', ref: 'B' }] }] },
      { id: 'fallback', nodes: [{ type: 'generatedTrajectory', fallback: { type: 'branch', nodes: [{ type: 'decision', then: [], else: [{ type: 'path', ref: 'A' }] }] } }] },
      { id: 'stop', nodes: [{ type: 'generatedTrajectory', fallback: { type: 'safeStop' } }] },
    ];
    expect(referencingRoutines(routines, 'A').map((routine) => routine.id)).toEqual(['first', 'fallback']);
    expect(referencingRoutines(routines, 'B').map((routine) => routine.id)).toEqual(['first']);
    expect(referencingRoutines(routines, 'unreferenced')).toEqual([]);
  });
});

describe('batch selection', () => {
  it('preserves identity across reorder, rename, and filtering while dropping deleted paths', () => {
    const paths = [{ id: 'B', name: 'Renamed B' }, { id: 'A', name: 'Hidden by search' }, { id: 'C', name: 'C' }];
    expect(selectedPathIds(paths, ['A', 'B', 'deleted', 'B'])).toEqual(['B', 'A']);
    expect(selectedPathIds(paths.filter((path) => path.id !== 'A'), ['A', 'B'])).toEqual(['B']);
  });
});
