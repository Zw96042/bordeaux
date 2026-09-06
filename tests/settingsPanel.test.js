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
    expect(markup).toContain('Save project');
    expect(markup).toContain('Optimize');
    expect(markup).not.toMatch(/Connect robot|Display units|Export JSON/);
  });

  it.each([
    [{ pairing: null, busy: false, connectionLabel: 'Connect robot' }, 'Connect robot'],
    [{ pairing: { teamNumber: 2468 }, busy: false, connectionLabel: 'Team 2468' }, 'Manage connection'],
    [{ pairing: { teamNumber: 2468 }, busy: true, connectionLabel: 'Awaiting robot' }, 'Push progress'],
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
