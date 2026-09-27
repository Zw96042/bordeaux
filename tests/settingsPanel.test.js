import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Panels } from '../src/renderer/components/Panels';
import { RobotPage } from '../src/renderer/components/RobotPage';
import { createDemoProject } from '../src/shared/project/defaults';

describe('settings workspace', () => {
  it('keeps file and editing actions in the toolbar and exposes Settings', () => {
    const markup = renderToStaticMarkup(React.createElement(Panels.Toolbar, { page: 'plan', editorPage: 'plan' }));
    expect(markup).toContain('Settings');
    expect(markup).toContain('aria-label="Project menu"');
    expect(markup).toContain('Optimize');
    expect(markup).not.toMatch(/Connect robot|Display units|Export JSON/);
  });

  it.each([
    [null, null], [{ phase: 'upToDate', version: null }, null], [{ phase: 'checking', version: null }, null],
    [{ phase: 'available', version: '0.3.0' }, 'Update available'],
    [{ phase: 'downloading', version: '0.3.0', progress: { percent: 41.6 } }, 'Downloading 42%'],
    [{ phase: 'downloaded', version: '0.3.0' }, 'Restart to update'],
    [{ phase: 'error', version: '0.3.0', errorStage: 'download' }, 'Update failed'],
  ])('shows update status quietly in the toolbar: %j', (updateState, label) => {
    const markup = renderToStaticMarkup(React.createElement(Panels.Toolbar, { page: 'plan', editorPage: 'plan', updateState }));
    expect(markup.includes('update-chip')).toBe(Boolean(label));
    if (label) expect(markup).toContain('</span>' + label + '</button>');
  });

  it.each([
    [{ pairing: null, busy: false, connectionLabel: 'Connect robot' }, 'Set up'],
    [{ pairing: { teamNumber: 2468 }, busy: false, connectionLabel: 'Team 2468' }, 'Edit'],
    [{ pairing: { teamNumber: 2468 }, busy: true, connectionLabel: 'Awaiting robot' }, 'Show progress'],
  ])('keeps connection and units available with the robot configuration', (pushController, label) => {
    const markup = renderToStaticMarkup(React.createElement(RobotPage, {
      robot: createDemoProject().robot, unitSystem: 'imperial', pushController,
    }));
    expect(markup).toContain(label);
    expect(markup).toContain('aria-label="Display units"');
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Imperial/);
    expect(markup).toContain('Drivetrain');
    expect(markup).not.toContain('<dialog');
  });
});
