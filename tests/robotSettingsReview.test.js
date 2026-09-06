import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RobotPage } from '../src/renderer/components/RobotPage';
import { RobotPushDialog } from '../src/renderer/components/RobotPushDialog';
import { UnitPrefs } from '../src/renderer/lib/unitPreferences';
import { createDemoProject } from '../src/shared/project/defaults';

const renderConnection = (patch) => renderToStaticMarkup(React.createElement(RobotPushDialog, {
  controller: { open: true, phase: 'idle', host: 'robot.local', port: '22', ...patch },
}));

describe('robot settings review regressions', () => {
  afterEach(() => UnitPrefs.set('metric'));

  it.each([
    ['metric', '0.254', 'm'],
    ['imperial', '10.000', 'in'],
  ])('shows custom footprint coordinates in %s units', (system, display, unit) => {
    UnitPrefs.set(system);
    const robot = createDemoProject().robot;
    robot.footprintPreset = { kind: 'custom' };
    robot.footprint = { kind: 'polygon', verticesM: [
      { x: 0.254, y: -0.254 }, { x: 0.254, y: 0.254 },
      { x: -0.254, y: 0.254 }, { x: -0.254, y: -0.254 },
    ] };
    const before = structuredClone(robot);
    const markup = renderToStaticMarkup(React.createElement(RobotPage, {
      robot, unitSystem: system, pushController: {},
    }));
    expect(markup).toMatch(new RegExp(`<input(?=[^>]*aria-label="Vertex 1 X")(?=[^>]*step="0[.]01")(?=[^>]*value="${display.replace(".", "[.]")}")[^>]*><span class="u">${unit}</span>`));
    expect(markup).toMatch(new RegExp(`<input(?=[^>]*aria-label="Vertex 1 Y")(?=[^>]*step="0[.]01")(?=[^>]*value="-${display.replace(".", "[.]")}")[^>]*><span class="u">${unit}</span>`));
    expect(robot).toEqual(before);
  });

  it('keeps verified identity visible while pairing without reopening connection fields', () => {
    const markup = renderConnection({
      phase: 'pairing', busy: true,
      probe: { hostKeyFingerprint: 'SHA256:reviewed-key', status: { teamNumber: 2468, runtimeId: 'reviewed-runtime' } },
    });
    expect(markup).toContain('Verify robot identity');
    expect(markup).toContain('SHA256:reviewed-key');
    expect(markup).toContain('reviewed-runtime');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/disabled="">Back<\/button>/);
    expect(markup).toMatch(/disabled="">Pairing…<\/button>/);
    expect(markup).not.toContain('Robot host');
  });

  it('shows an update failure once with recovery actions', () => {
    const markup = renderConnection({ phase: 'failed', error: 'Upload connection closed' });
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup.match(/Upload connection closed/g)).toHaveLength(1);
    expect(markup).toContain('Review current edits');
    expect(markup).not.toContain('Robot host');
  });

  it('preserves a connection failure next to its retry fields', () => {
    const markup = renderConnection({ error: 'Host unavailable' });
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).toContain('Robot host');
    expect(markup).toContain('Host unavailable');
  });

  it('preserves a receipt warning alongside verified acceptance', () => {
    const markup = renderConnection({ phase: 'active', result: { state: 'active' }, error: 'Local receipt could not be saved' });
    expect(markup).toContain('Accepted by robot');
    expect(markup).toContain('Local receipt could not be saved');
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
  });
});
