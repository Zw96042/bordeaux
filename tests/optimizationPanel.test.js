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

  it('keeps ordinary loading distinct from failure and enables search after planning succeeds', () => {
    const loading = render({ pending: true });
    expect(loading).toContain('Preparing path');
    expect(loading).toMatch(/class="optimizer-main primary" disabled=""/);
    expect(loading).not.toContain('role="alert"');
    const ready = render({ pending: false, baselineTime: 3 });
    expect(ready).toContain('3.00 s');
    expect(ready).toMatch(/class="optimizer-main primary">Optimize<\/button>/);
  });
});
