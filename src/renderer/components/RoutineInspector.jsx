import * as React from "react";
import { AUTO } from "../lib/routineModel";
import { UnitPrefs } from "../lib/unitPreferences";
import { CommandParameterEditor, commandArguments, parameterValueError, safeControlId } from "./ContextInspector";
import { UI } from "./ui";

// Autonomous Routine — step inspector (RIGHT rail) + run transport (bottom).
// One inspector system, shared with the Plan page (.ctxinsp shell + form primitives).
  const h = React.createElement;
  const { Icon, Dropdown, Seg } = UI;
  const A = AUTO;
  const fmt = (t) => (t || 0).toFixed(2) + 's';

  function FieldLabel(t, right) { return h('div', { className: 'fieldlabel' }, h('span', null, t), right || null); }

  // ---- parameter (key/value) editor for Generate ----
  function Params({ params, onChange }) {
    const list = params || [];
    const setRow = (i, patch) => { const next = list.map((p, k) => k === i ? { ...p, ...patch } : p); onChange(next); };
    const add = () => onChange([...list, { k: '', v: '' }]);
    const del = (i) => onChange(list.filter((_, k) => k !== i));
    return h('div', { className: 'rt-params' },
      list.length === 0 && h('div', { className: 'rt-param-empty' }, 'No parameters passed to the function.'),
      list.map((p, i) => h('div', { className: 'rt-param-row', key: i },
        h('input', { className: 'textinput k', 'aria-label': 'Parameter ' + (i + 1) + ' key', value: p.k, placeholder: 'key', spellCheck: false, onChange: (e) => setRow(i, { k: e.target.value }) }),
        h('input', { className: 'textinput v', 'aria-label': 'Parameter ' + (i + 1) + ' value', value: p.v, placeholder: 'value', spellCheck: false, onChange: (e) => setRow(i, { v: e.target.value }) }),
        h('button', { className: 'rt-param-del', type: 'button', title: 'Remove', 'aria-label': 'Remove parameter ' + (i + 1), onClick: () => del(i) }, h(Icon, { name: 'x', size: 13 })))),
      h('button', { className: 'rt-param-add', type: 'button', onClick: add }, h(Icon, { name: 'plus', size: 13 }), 'Add parameter'));
  }

  function StepInspector(props) {
    const { node, paths, acq, run, javaProject, conditionOptions = [] } = props;
    if (!node) return null;
    const deployment = A.nodeDeploymentState(node, javaProject && javaProject.catalog);
    if (!deployment.deployable) {
      const title = deployment.legacy ? (deployment.label || 'Legacy step') : 'Unsupported step';
      return h('div', { className: 'ctxinsp' },
        h('div', { className: 'ctxinsp-hd' },
          h('span', { className: 'ctxinsp-ic', style: { background: 'color-mix(in srgb, #d2655f 16%, transparent)', color: '#d2655f' } }, h(Icon, { name: 'info', size: 15 })),
          h('span', { className: 'ctxinsp-t', title }, title),
          h('span', { className: 'ctxinsp-tag' }, 'Legacy — cannot deploy'),
          h('button', { className: 'ctxinsp-x', type: 'button', title: 'Close', 'aria-label': 'Close step inspector', onClick: () => acq.select(null) }, h(Icon, { name: 'x', size: 14 }))),
        h('div', { className: 'ctxinsp-body' },
          h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'This saved step has no Bordeaux beta export contract. Replace it with a Path, Decision, Command, or available Wait, or remove it before export.'),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Remove unsupported step')));
    }
    const set = (patch) => acq.set(node.id, patch);
    const seg = run.segs.find((s) => s.nodeId === node.id);
    let icon = 'dot', title = '', tag = null, accent = 'var(--accent)', body = null;

    if (node.type === 'path') {
      icon = 'route'; title = 'Path'; tag = 'step';
      body = h(React.Fragment, null,
        h(Dropdown, { id: 'routine-bound-path', label: 'Bound path', value: node.ref, icon: 'route',
          items: paths.map((path) => ({ value: path.id, label: path.name })),
          onChange: (value) => set({ ref: value }) }),
        seg && h('div', { className: 'rt-stat' },
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, fmt(seg.t1 - seg.t0)), h('span', { className: 'rt-stat-k' }, 'duration')),
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, UnitPrefs.format(seg.deriv.sample.length, 'm', 2)), h('span', { className: 'rt-stat-k' }, 'distance')),
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, '#' + seg.idxLabel), h('span', { className: 'rt-stat-k' }, 'run order'))),
        h('button', { className: 'rt-openbtn', type: 'button', onClick: () => acq.openInEditor(node.ref) }, h(Icon, { name: 'route', size: 14 }), 'Open in path editor'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Remove from routine'));

    } else if (node.type === 'builtin') {
      icon = 'pause'; title = 'Wait'; tag = 'built-in'; accent = '#cf962f';
      const durationS = node.arguments && node.arguments.durationS;
      body = h(React.Fragment, null,
        FieldLabel('Duration', h('span', { className: 'rt-scaleval' }, 's')),
        h('input', { className: 'textinput', type: 'number', min: 0.02, max: 15, step: 0.01, 'aria-label': 'Wait duration in seconds', value: durationS,
          onChange: (event) => set({ arguments: { durationS: Number(event.target.value) } }) }),
        h('div', { className: 'seg-hint' }, 'Pause the routine for 0.02 to 15 seconds before the next step.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete wait'));

    } else if (node.type === 'generatedTrajectory') {
      icon = 'route'; title = deployment.label || 'Generated trajectory'; tag = 'runtime dynamic'; accent = '#cf962f';
      body = h(React.Fragment, null,
        h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'This segment is generated and validated on the robot at runtime. Bordeaux does not fabricate desktop geometry, duration, distance, or clearance for it.'),
        h('div', { className: 'seg-hint' }, 'Fallback: ' + (node.fallback && node.fallback.type === 'branch' ? 'validated static branch' : 'safe stop')),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Remove generated trajectory'));

    } else if (node.type === 'decision') {
      icon = 'branch'; title = 'Decision'; tag = 'branch'; accent = '#9aa3b0';
      const out = acq.outcomes[node.id] || 'then';
      body = h(React.Fragment, null,
        h(Dropdown, { id: 'routine-condition', label: 'Condition ID', value: node.cond,
          items: A.conditionPickerItems(conditionOptions, node.cond), placeholder: 'Choose a registered condition', icon: 'branch',
          onChange: (value) => set({ cond: value }) }),
        h('div', { className: 'grid2', style: { marginTop: '10px' } },
          h('div', null, FieldLabel('If true'), h('input', { className: 'textinput', 'aria-label': 'True branch label', value: node.thenLabel, spellCheck: false, onChange: (e) => set({ thenLabel: e.target.value }) })),
          h('div', null, FieldLabel('If false'), h('input', { className: 'textinput', 'aria-label': 'False branch label', value: node.elseLabel, spellCheck: false, onChange: (e) => set({ elseLabel: e.target.value }) }))),
        FieldLabel('Simulated outcome'),
        h(Seg, { value: out, options: [{ v: 'then', label: node.thenLabel || 'true' }, { v: 'else', label: node.elseLabel || 'false' }], onChange: (v) => acq.setOutcome(node.id, v) }),
        h('div', { className: 'seg-hint' }, 'Robot code registers this stable ID. The simulated outcome only controls the editor preview.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete decision'));

    } else {
      const C = A.CATS[node.cat]; icon = C.icon; accent = C.color; tag = C.label;
      title = 'Function';
      if (node.cat === 'command') {
        const commands = javaProject && javaProject.catalog ? javaProject.catalog.commands || [] : [];
        const invocationId = node.invocation && node.invocation.commandId || '';
        const selected = commands.find((command) => command.id === invocationId);
        const parameters = selected ? (selected.parameters || []).filter((parameter) => parameter.role === 'argument') : [];
        const saved = node.invocation && node.invocation.arguments || {};
        const argumentsValue = selected ? Object.fromEntries(parameters.map((parameter) => {
          const value = Object.prototype.hasOwnProperty.call(saved, parameter.name) ? saved[parameter.name] : undefined;
          return [parameter.name, parameterValueError(value, parameter) ? commandArguments(selected)[parameter.name] : value];
        })) : saved;
        body = h(React.Fragment, null,

    }

    return h('div', { className: 'ctxinsp' },
      h('div', { className: 'ctxinsp-hd' },
        h('span', { className: 'ctxinsp-ic', style: { background: 'color-mix(in srgb,' + accent + ' 16%, transparent)', color: accent } }, h(Icon, { name: icon, size: 15 })),
        h('span', { className: 'ctxinsp-t', title }, title),
        tag && h('span', { className: 'ctxinsp-tag' }, tag),
        h('button', { className: 'ctxinsp-x', type: 'button', title: 'Close', 'aria-label': 'Close step inspector', onClick: () => acq.select(null) }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'ctxinsp-body' }, body));
  }

  // ---- bottom transport: the same persistent timeline model used by Plan ----
  function RoutineTransport(props) {
    const { run, time, playing, controls, running } = props;
    const nSteps = run.steps.length;
    const activeIdx = nSteps ? A.stepAt(run, time) : -1;
    const pct = run.total > 0 ? Math.max(0, Math.min(1, time / run.total)) : 0;
    const spans = run.steps.filter((step) => step.t1 > step.t0).map((step) => ({
      key: step.node.id,
      left: run.total ? step.t0 / run.total * 100 : 0,
      width: run.total ? (step.t1 - step.t0) / run.total * 100 : 0,
      color: step.kind === 'path' ? 'var(--accent)' : step.kind === 'gen' ? A.CATS.generate.color : (step.node.cat && A.CATS[step.node.cat] ? A.CATS[step.node.cat].color : 'var(--txt-3)'),
      label: step.label || A.nodeTitle(step.node),
    }));
    const instants = run.steps.filter((step) => step.t1 <= step.t0).map((step) => ({
      key: step.node.id,
      left: run.total ? step.t0 / run.total * 100 : 0,
      label: step.label || A.nodeTitle(step.node),
    }));

    return h('div', { className: 'rt-transport timeline' + (running ? ' running' : '') },
      h('div', { className: 'rt-timeline-toolbar' },
        h('div', { className: 'rt-tp-ctl' },
          h('button', { className: 'rt-tp-btn', type: 'button', title: 'Restart routine', 'aria-label': 'Restart routine', onClick: controls.reset }, h(Icon, { name: 'rewind', size: 14 })),
          h('button', { className: 'rt-tp-btn play', type: 'button', disabled: nSteps === 0, title: 'Play / pause routine', 'aria-label': playing ? 'Pause routine playback' : 'Play routine', onClick: controls.toggle }, h(Icon, { name: playing ? 'pause' : 'play', size: 15, fill: !playing }))),
        h('span', { className: 'rt-timeline-title' }, 'Routine'),
        h('span', { className: 'rt-timeline-time' }, time.toFixed(2), h('small', null, ' / ' + run.total.toFixed(2) + 's')),
        h('span', { className: 'rt-timeline-summary' }, nSteps + (nSteps === 1 ? ' preview step' : ' preview steps')),
        h('div', { className: 'rt-timeline-step' }, activeIdx >= 0 ? String(activeIdx + 1).padStart(2, '0') : '–', h('small', null, '/' + String(nSteps).padStart(2, '0')))),
      h('div', { className: 'rt-timeline-editor', style: { '--routine-progress': pct } },
        h('span', { className: 'rt-timeline-track' }),
        spans.map((span) => h('span', { key: span.key, className: 'rt-timeline-span', title: span.label, style: { left: span.left + '%', width: span.width + '%', '--step-color': span.color } })),
        instants.map((instant) => h('span', { key: instant.key, className: 'rt-timeline-event', title: instant.label, style: { left: instant.left + '%' } })),
        h('input', { className: 'rt-tp-scrub', type: 'range', 'aria-label': 'Routine playback position', min: 0, max: 1000, value: Math.round(pct * 1000), onChange: (event) => controls.seek((event.target.value / 1000) * run.total) })));
  }

export { StepInspector, RoutineTransport };
