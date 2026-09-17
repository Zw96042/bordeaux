import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OptimizationPanel } from '../src/renderer/components/OptimizationPanel';

const render = (patch) => renderToStaticMarkup(React.createElement(OptimizationPanel, {
  path: { id: 'path', optimization: {} }, paths: [], state: { paths: {}, running: false },
  unitSystem: 'metric', mode: 'selected', ...patch,
}));

describe('optimizer planning failure', () => {
  it('offers editing instead of an indefinitely disabled search when planning fails', () => {
    const markup = render({ pending: true, error: new Error('Entry speed exceeds the limit <4 m/s>.') });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Entry speed exceeds the limit &lt;4 m/s&gt;.');
    expect(markup).toMatch(/<button[^>]*class="optimizer-main"[^>]*>Edit path<\/button>/);
    expect(markup).not.toContain('disabled');
    expect(markup).not.toContain('Preparing path');
    expect(markup).not.toContain('Trajectory comparison');
  });

  it('keeps pending work quiet and enables search after planning succeeds', () => {
    const loading = render({ pending: true });
    expect(loading).toContain('<progress');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain('Preparing path…');
    expect(loading).toMatch(/class="optimizer-main primary" disabled=""/);
    expect(loading).not.toContain('role="alert"');
    const ready = render({ pending: false, baselineTime: 3 });
    expect(ready).toContain('3.00 s');
    expect(ready).toMatch(/class="optimizer-main primary">Optimize<\/button>/);
  });

  it('shows cancellable progress without a ticking status message during search', () => {
    const markup = render({ state: { running: true, paths: { path: { status: 'searching', startedAt: 0 } } } });
    expect(markup).toContain('aria-label="Optimizing path"');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).not.toContain('Optimizing…');
  });
});


describe('optimization job ownership', () => {
  const background = {
    paths: [{ id: 'other', name: 'Scoring approach' }],
    state: { running: true, paths: { other: { status: 'searching' } } },
    pending: false, baselineTime: 4,
  };
  it('names the other path without claiming its progress or result for the selected path', () => {
    const markup = render(background);
    expect(markup).toContain('Search in progress');
    expect(markup).toContain('<strong>Scoring approach</strong>');
    expect(markup).toContain('aria-label="Cancel optimization for Scoring approach"');
    expect(markup).toContain('aria-busy="false"');
    expect(markup).not.toContain('aria-label="Optimizing path"');
    expect(markup).toMatch(/class="optimizer-main primary" disabled="">Optimize<\/button>/);
    expect(markup).toContain('4.00 s');
  });
  it('preserves an explicit current-path Apply while another path is searching', () => {
    const markup = render({ ...background, candidate: { finalTrajectory: { totalTimeS: 3 } } });
    expect(markup).toContain('1.00 s faster, 25.0%');
    expect(markup).toMatch(/class="optimizer-main primary">Apply optimized<\/button>/);
    expect(markup).toContain('Cancel optimization for Scoring approach');
  });
  it('labels batch cancellation honestly and keeps it available if current-path planning fails', () => {
    const markup = render({ ...background, state: { ...background.state, batch: { completed: 0, total: 2 } }, error: new Error('Invalid geometry') });
    expect(markup).toContain('aria-label="Cancel all optimization searches"');
    expect(markup).toContain('Cancel all');
    expect(markup).toContain('Invalid geometry');
  });
});
