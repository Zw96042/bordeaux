import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ContextInspector, parameterValueError } from '../src/renderer/components/ContextInspector';
import { UI } from '../src/renderer/components/ui';
import { createDemoProject } from '../src/shared/project/defaults';
import { PM } from '../src/renderer/lib/pathMath';

const h = React.createElement;
describe('LabVIEW inspector', () => {
  it.each([
    ['U8', 'integer', 255, 256], ['I8', 'integer', -128, -129],
    ['U16', 'integer', 65535, -1], ['U32', 'integer', 4294967295, 4294967296],
    ['I64', 'integerString', '-9223372036854775808', '-9223372036854775809'],
    ['U64', 'integerString', '18446744073709551615', '18446744073709551616'],
    ['SGL', 'number', 1e30, 1e40],
  ])('preserves the %s numeric boundary', (valueType, kind, valid, invalid) => {
    const parameter = { name: 'Value', schema: { valueType, kind } };
    expect(parameterValueError(valid, parameter)).toBe('');
    expect(parameterValueError(invalid, parameter)).not.toBe('');
  });
  it('shows the selected command without a floating dropdown', () => {
    const markup = renderToStaticMarkup(h(UI.ChoiceBrowser, { id: 'command', label: 'Command', value: 'intake', items: [{ value: 'intake', label: 'Start intake', meta: 'Speed, timeout' }], onChange() {} }));
    expect(markup).toContain('Start intake');
    expect(markup).toContain('Speed, timeout');
    expect(markup).toContain('Change');
    expect(markup).not.toContain('cmd-picker-trigger');
  });
  it('offers distance anchoring for new proportional constraint ranges', () => {
    const project = createDemoProject(); const doc = project.paths[0];
    doc.ranges = [{ f0: .2, f1: .6, maxVel: 1, anchor: 'param' }];
    const derived = PM.derivePath(doc, project.robot, project.perSegmentConstraints, project.plannerId);
    const html = renderToStaticMarkup(h(ContextInspector, { project, doc, derived, sel: { kind: 'cr', idx: 0 }, actions: {}, robot: project.robot }));
    expect(html).toContain('Proportional'); expect(html).toContain('Distance');
    expect(html).not.toContain('>Local<'); expect(html).not.toContain('Legacy distance');
  });
  it('resolves the linked waypoint name for segment headings', () => {
    const project = createDemoProject(); const doc = project.paths[0];
    doc.waypoints[0].positionLink = 'shared';
    project.paths.push({ ...structuredClone(doc), id: 'other', waypoints: [{ ...doc.waypoints[0], positionName: 'Intake staging', positionLink: 'shared' }, doc.waypoints[1]] });
    const derived = PM.derivePath(doc, project.robot, project.perSegmentConstraints, project.plannerId);
    const html = renderToStaticMarkup(h(ContextInspector, { project, doc, derived, sel: { kind: 'seg', idx: 0 }, actions: {}, robot: project.robot }));
    expect(html).toContain('Intake staging →'); expect(html).not.toContain('>Default<');
  });
});

describe('planning recovery inspector', () => {
  it('makes stale anchor controls inert while leaving the inspector close button available', () => {
    const project = createDemoProject(), doc = project.paths[0];
    doc.targets = [{ f: .5, deg: 90 }];
    const derived = PM.derivePath(doc, project.robot, project.perSegmentConstraints, project.plannerId);
    const html = renderToStaticMarkup(h(ContextInspector, { project, doc, derived, pending: true,
      sel: { kind: 'rt', idx: 0 }, actions: {}, robot: project.robot }));
    expect(html).toContain('class="ctxinsp-body" inert=""');
    expect(html).toContain('Anchor position');
    const header = html.slice(0, html.indexOf('class="ctxinsp-body"'));
    expect(header).toContain('aria-label="Hide inspector"');
    expect(header).not.toContain('inert=');
  });

  it('offers authored range repair without reading failed trajectory geometry', () => {
    const project = createDemoProject(), doc = project.paths[0];
    doc.ranges = [{ f0: .2, f1: .6, maxVel: 0, anchor: 'param' }];
    const derived = new Proxy({}, { get() { throw new Error('Failed geometry must not be used for repair'); } });
    const html = renderToStaticMarkup(h(ContextInspector, { project, doc, derived, repairMode: true,
      sel: { kind: 'cr', idx: 0 }, actions: {}, robot: project.robot }));
    expect(html).toContain('Max velocity');
    expect(html).toContain('Delete range');
    expect(html).not.toContain('inert=');
    expect(html).not.toContain('Anchor position');
    expect(html).not.toContain('>Distance<');
  });
});
