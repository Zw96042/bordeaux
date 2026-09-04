import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FieldStatus } from '../src/renderer/components/FieldStatus';

const render = (notices) => renderToStaticMarkup(React.createElement(FieldStatus, { notices }));
const summary = (markup) => markup.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];

const preparing = { id: 'loading', label: 'Preparing trajectory…', detail: 'Preview timing is provisional until planning finishes.' };
const stale = { id: 'optimization', label: 'Optimization out of date', detail: 'The path changed after optimization.', action: { label: 'Optimize', onClick() {} } };

describe('compact field status', () => {
  it('does not leave a status surface on a healthy field', () => {
    expect(render([])).toBe('');
  });

  it('shows one summary while keeping concurrent messages in initially collapsed details', () => {
    const markup = render([preparing, stale]);
    expect(summary(markup)).toContain('Preparing trajectory…');
    expect(summary(markup)).toContain('Details (2)');
    expect(summary(markup)).not.toContain('Optimization out of date');
    expect(markup).toContain('<details>');
    expect(markup).not.toMatch(/<details[^>]*\bopen/);
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).toContain(preparing.detail);
    expect(markup).toContain(stale.detail);
    // Planning stays automatic; a useful action on another notice remains reachable without expanding.
    expect(markup).toMatch(/<\/details><button[^>]*class="field-status-action"[^>]*>Optimize<\/button>/);
  });

  it('announces the primary failure once and retains full escaped diagnostics and secondary actions', () => {
    const detail = 'Cannot export <path>: speed > limit & trajectory unavailable. '.repeat(20);
    const markup = render([{ id: 'export', error: true, label: 'Export failed', detail,
      action: { label: 'Dismiss', onClick() {} } }, preparing, stale]);
    expect(summary(markup)).toContain('Export failed');
    expect(summary(markup)).not.toContain('Preparing trajectory');
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).not.toContain('role="status"');
    expect(markup).toContain('&lt;path&gt;');
    expect(markup).toContain('limit &amp; trajectory');
    expect(markup).not.toContain('<path>');
    expect(markup).toMatch(/<\/details><button[^>]*class="field-status-action"[^>]*>Dismiss<\/button>/);
    expect(markup).toContain('>Optimize</button>');
  });

  it('distinguishes an unavailable trajectory from a usable interactive preview', () => {
    for (const [error, label, role] of [[true, 'Trajectory unavailable', 'alert'], [false, 'Interactive preview', 'status']]) {
      const markup = render([{ id: 'planning', error, label, detail: 'Planner diagnostic.' }]);
      expect(summary(markup)).toContain(label);
      expect(summary(markup)).toContain('role="' + role + '"');
      expect(markup).not.toContain('field-status-action');
    }
  });
});
