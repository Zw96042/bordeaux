import { describe, expect, it } from 'vitest';
import { AUTO } from '../src/renderer/lib/routineModel';

const path = (id) => ({ id, type: 'path', ref: 'drive' });
const fixture = () => ({ nodes: [path('first'), { id: 'decision', type: 'decision', then: [path('yes-1'), path('yes-2'), path('yes-3')], else: [path('no-1'), path('no-2')] }, path('last')] });

describe('routine reorder feedback and mutation', () => {
  it.each([
    ['first', 'last', false, ['decision', 'last', 'first']],
    ['last', 'first', true, ['last', 'first', 'decision']],
    ['yes-1', 'yes-3', false, ['yes-2', 'yes-3', 'yes-1']],
    ['no-2', 'no-1', true, ['no-2', 'no-1']],
  ])('accepts a meaningful sibling move from %s to %s', (id, target, before, expected) => {
    const original = fixture();
    const snapshot = structuredClone(original);
    expect(AUTO.canReorderRelative(original, id, target, before)).toBe(true);
    const result = AUTO.reorderRelative(original, id, target, before);
    expect(AUTO.siblingNodes(result, id).map((node) => node.id)).toEqual(expected);
    expect(original).toEqual(snapshot);
  });

  it.each([
    ['first', 'yes-1', true], ['yes-1', 'first', false],
    ['yes-1', 'no-1', true], ['yes-1', 'decision', true],
    ['decision', 'yes-1', true], ['yes-1', 'yes-1', false],
    ['yes-1', 'yes-2', true], ['yes-2', 'yes-1', false],
    ['missing', 'first', true], ['first', 'missing', true],
  ])('does not advertise or mutate an invalid/no-op move from %s to %s', (id, target, before) => {
    const routine = fixture();
    expect(AUTO.canReorderRelative(routine, id, target, before)).toBe(false);
    expect(AUTO.reorderRelative(routine, id, target, before)).toBe(routine);
  });
});
