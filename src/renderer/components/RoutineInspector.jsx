import * as React from "react";
import { AUTO } from "../lib/routineModel";
import { UnitPrefs } from "../lib/unitPreferences";
import { CommandParameterEditor, commandArguments, parameterValueError, safeControlId } from "./ContextInspector";
import { UI } from "./ui";
import { LabviewCommandInspection, LabviewProjectSources } from "./LabviewProjectSources";

// Autonomous Routine — step inspector (RIGHT rail) + run transport (bottom).
// One inspector system, shared with the Plan page (.ctxinsp shell + form primitives).
  const h = React.createElement;
  const { Icon, Dropdown, ChoiceBrowser, Seg } = UI;
  const A = AUTO;
  const fmt = (t) => (t || 0).toFixed(2) + 's';

  function FieldLabel(t, right) { return h('div', { className: 'fieldlabel' }, h('span', null, t), right || null); }

  function StepInspector(props) {
    const { node, paths, acq, run, robotProject, conditionOptions = [] } = props;
    if (!node) return null;
    const deployment = A.nodeDeploymentState(node, robotProject && robotProject.catalog);
    if (!deployment.deployable) {
      const title = deployment.legacy ? (deployment.label || 'Legacy step') : 'Unsupported step';
      return h('div', { className: 'ctxinsp inspector-refresh' },
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
        h(Dropdown, { id: 'routine-bound-path', label: 'Path', value: node.ref, icon: 'route',
          items: paths.map((path) => ({ value: path.id, label: path.name })),
          onChange: (value) => set({ ref: value }) }),
        seg && h('div', { className: 'rt-stat' },
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, fmt(seg.t1 - seg.t0)), h('span', { className: 'rt-stat-k' }, 'Duration')),
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, UnitPrefs.format(seg.deriv.sample.length, 'm', 2)), h('span', { className: 'rt-stat-k' }, 'Distance')),
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, '#' + seg.idxLabel), h('span', { className: 'rt-stat-k' }, 'Run order'))),
        h('button', { className: 'rt-openbtn', type: 'button', onClick: () => acq.openInEditor(node.ref) }, h(Icon, { name: 'route', size: 14 }), 'Open in path editor'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Remove from routine'));

    } else if (node.type === 'builtin') {
      icon = 'pause'; title = 'Wait'; tag = 'built-in'; accent = '#cf962f';
      const durationS = node.arguments && node.arguments.durationS;
      body = h(React.Fragment, null,
        FieldLabel('Duration', h('span', { className: 'rt-scaleval' }, 's')),
        h('input', { className: 'textinput', type: 'number', min: 0.02, max: 15, step: 0.01, 'aria-label': 'Wait duration in seconds', value: durationS,
          onChange: (event) => set({ arguments: { durationS: Number(event.target.value) } }) }),
        h('div', { className: 'seg-hint' }, 'Continue to the next step after this delay.'),
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
        h(Dropdown, { id: 'routine-condition', label: 'Condition', value: node.cond,
          items: A.conditionPickerItems(conditionOptions, node.cond), placeholder: 'Choose a registered condition', icon: 'branch',
          onChange: (value) => set({ cond: value }) }),
        h('div', { className: 'grid2', style: { marginTop: '10px' } },
          h('div', null, FieldLabel('If true'), h('input', { className: 'textinput', 'aria-label': 'True branch label', value: node.thenLabel, spellCheck: false, onChange: (e) => set({ thenLabel: e.target.value }) })),
          h('div', null, FieldLabel('If false'), h('input', { className: 'textinput', 'aria-label': 'False branch label', value: node.elseLabel, spellCheck: false, onChange: (e) => set({ elseLabel: e.target.value }) }))),
        FieldLabel('Preview branch'),
        h(Seg, { value: out, options: [{ v: 'then', label: node.thenLabel || 'true' }, { v: 'else', label: node.elseLabel || 'false' }], onChange: (v) => acq.setOutcome(node.id, v) }),
        h('div', { className: 'seg-hint' }, 'Choose a branch to preview. The robot evaluates the condition when running.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete decision'));

    } else {
      const C = A.CATS[node.cat]; icon = C.icon; accent = C.color; tag = C.label;
      title = 'Command';
      const commands = robotProject && robotProject.catalog ? robotProject.catalog.commands || [] : [];
      const invocationId = node.invocation && node.invocation.commandId || '';
      const selected = commands.find((command) => command.id === invocationId);
      const parameters = selected ? (selected.parameters || []).filter((parameter) => parameter.role === 'argument') : [];
      const saved = node.invocation && node.invocation.arguments || {};
      const argumentsValue = selected ? Object.fromEntries(parameters.map((parameter) => {
        const value = Object.prototype.hasOwnProperty.call(saved, parameter.name) ? saved[parameter.name] : undefined;
        return [parameter.name, parameterValueError(value, parameter) ? commandArguments(selected)[parameter.name] : value];
      })) : saved;
      body = h(React.Fragment, null,
        h('div', { className: 'seg-hint' }, 'Runs between the surrounding steps.'),
        robotProject && robotProject.catalog
          ? h(ChoiceBrowser, { id: 'routine-command', resetKey: node.id, label: 'Command', value: invocationId,
              items: [{ value: '', label: 'Choose a command', meta: 'No command selected' }, ...commands.map((command) => ({
                value: command.id, label: command.label, meta: (command.parameters || []).filter((parameter) => parameter.role === 'argument').map((parameter) => parameter.label || parameter.name).join(', ') || command.member,
                searchText: command.id + ' ' + command.member,
              }))], placeholder: 'Search commands', emptyText: 'No commands found in this project', icon: 'bolt', onChange: (value) => {
              const command = commands.find((candidate) => candidate.id === value);
              set({ title: command ? command.label : 'Robot command', invocation: command ? { commandId: command.id, arguments: commandArguments(command) } : null });
            } })
          : h(React.Fragment, null, FieldLabel('Robot command'),
              h('button', { className: 'cmd-primary-action', type: 'button', onClick: robotProject && robotProject.link }, 'Choose robot project')),
        invocationId && !selected && h('div', { className: 'cmd-project-error', role: 'status' }, 'This saved command is missing from the linked catalog.'),
        selected && !selected.labviewConnector && h('div', { className: 'cmd-project-error', role: 'status' }, 'Inspect this command’s types before exporting.'),
        selected && h('form', { className: 'cmd-parameters', onSubmit: (event) => event.preventDefault() },
          parameters.length === 0 ? h('div', { className: 'cmd-empty-params' }, 'No parameters')
            : parameters.map((parameter) => h(CommandParameterEditor, {
                key: parameter.name,
                id: 'routine-command-param-' + safeControlId(parameter.name),
                label: parameter.label || parameter.name,
                schema: parameter.schema,
                parameter,
                value: argumentsValue[parameter.name],
                onChange: (value) => set({ invocation: { commandId: selected.id, arguments: { ...argumentsValue, [parameter.name]: value } } }),
              }))),
        h('details', { className: 'inspector-details' }, h('summary', null, 'LabVIEW project'),
        robotProject && robotProject.catalog && robotProject.catalog.runtime === 'labview' && h(LabviewCommandInspection, { catalog: robotProject.catalog, onInspect: robotProject.inspect, operation: robotProject.operation }),
        robotProject && robotProject.catalog && robotProject.catalog.runtime === 'labview' && robotProject.error && h('div', { className: 'cmd-project-error', role: 'alert' }, robotProject.error),
        robotProject && robotProject.catalog && robotProject.catalog.runtime === 'labview' && h(LabviewProjectSources, { catalog: robotProject.catalog })),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete command'));

    }

    return h('div', { className: 'ctxinsp inspector-refresh' },
      h('div', { className: 'ctxinsp-hd' },
        h('span', { className: 'ctxinsp-ic', style: { background: 'color-mix(in srgb,' + accent + ' 16%, transparent)', color: accent } }, h(Icon, { name: icon, size: 15 })),
        h('span', { className: 'ctxinsp-t', title }, title),
        tag && null,
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
