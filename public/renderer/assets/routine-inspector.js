// Autonomous Routine — step inspector (RIGHT rail) + run transport (bottom).
// One inspector system, shared with the Plan page (.ctxinsp shell + form primitives).
// Needs React + window.UI + window.AUTO. Exports window.StepInspector, window.RoutineTransport
(function () {
  const { useState } = React;
  const h = React.createElement;
  const { Icon, Dropdown, Num, Seg } = window.UI;
  const A = window.AUTO;
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
    const { node, paths, acq, run, javaProject } = props;
    if (!node) return null;
    const set = (patch) => acq.set(node.id, patch);
    const seg = run.segs.find((s) => s.nodeId === node.id);
    let icon = 'dot', title = '', tag = null, accent = 'var(--accent)', body = null;

    if (node.type === 'path') {
      const doc = paths.find((path) => path.id === node.ref);
      icon = 'route'; title = 'Path'; tag = 'step';
      body = h(React.Fragment, null,
        h(Dropdown, { id: 'routine-bound-path', label: 'Bound path', value: node.ref, icon: 'route',
          items: paths.map((path) => ({ value: path.id, label: path.name })),
          onChange: (value) => set({ ref: value }) }),
        seg && h('div', { className: 'rt-stat' },
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, fmt(seg.t1 - seg.t0)), h('span', { className: 'rt-stat-k' }, 'duration')),
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, seg.deriv.sample.length.toFixed(2) + ' m'), h('span', { className: 'rt-stat-k' }, 'distance')),
          h('div', { className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v' }, '#' + seg.idxLabel), h('span', { className: 'rt-stat-k' }, 'run order'))),
        h('button', { className: 'rt-openbtn', type: 'button', onClick: () => acq.openInEditor(node.ref) }, h(Icon, { name: 'route', size: 14 }), 'Open in path editor'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Remove from routine'));

    } else if (node.type === 'decision') {
      icon = 'branch'; title = 'Decision'; tag = 'branch'; accent = '#9aa3b0';
      const out = acq.outcomes[node.id] || 'then';
      body = h(React.Fragment, null,
        h(Dropdown, { id: 'routine-condition', label: 'Condition ID', value: node.cond,
          items: A.pickerItems(A.CONDITIONS, node.cond), placeholder: 'Choose a registered condition', icon: 'branch',
          allowCustom: true, customLabel: 'Enter exact decision condition ID', customPlaceholder: 'Exact condition ID',
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
        const editor = window.BordeauxCommandEditor;
        const commands = javaProject && javaProject.catalog ? javaProject.catalog.commands || [] : [];
        const invocationId = node.invocation && node.invocation.commandId || '';
        const selected = commands.find((command) => command.id === invocationId);
        const parameters = selected ? (selected.parameters || []).filter((parameter) => parameter.role === 'argument') : [];
        const saved = node.invocation && node.invocation.arguments || {};
        const argumentsValue = selected ? Object.fromEntries(parameters.map((parameter) => {
          const value = Object.prototype.hasOwnProperty.call(saved, parameter.name) ? saved[parameter.name] : undefined;
          return [parameter.name, editor.parameterValueError(value, parameter) ? editor.commandArguments(selected)[parameter.name] : value];
        })) : saved;
        body = h(React.Fragment, null,
          h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'Runs after the previous path and before the next path is selected.'),
          javaProject && javaProject.catalog
            ? h(Dropdown, { id: 'routine-command', label: 'Java command', value: invocationId,
                items: [{ value: '', label: 'Choose a command', meta: 'No command selected' }, ...commands.map((command) => ({
                  value: command.id, label: command.label, meta: command.description || command.id,
                  badge: command.runtimeReady === true ? 'ready' : 'build',
                }))], placeholder: 'Choose a command', icon: 'bolt', onChange: (value) => {
                const command = commands.find((candidate) => candidate.id === value);
                set({ title: command ? command.label : 'Robot command', invocation: command ? { commandId: command.id, arguments: editor.commandArguments(command) } : null });
              } })
            : h(React.Fragment, null, FieldLabel('Java command'),
                h('button', { className: 'cmd-primary-action', type: 'button', onClick: javaProject && javaProject.link }, 'Choose Java project')),
          invocationId && !selected && h('div', { className: 'cmd-project-error', role: 'status' }, 'This saved command is missing from the linked catalog.'),
          selected && selected.runtimeReady !== true && h('div', { className: 'cmd-project-error', role: 'status' }, 'Build the annotated command catalog before export.'),
          selected && h('form', { className: 'cmd-parameters', onSubmit: (event) => event.preventDefault() },
            parameters.length === 0 ? h('div', { className: 'cmd-empty-params' }, 'No parameters')
              : parameters.map((parameter) => h(editor.CommandParameterEditor, {
                  key: parameter.name,
                  id: 'routine-command-param-' + editor.safeControlId(parameter.name),
                  label: parameter.label || parameter.name,
                  schema: parameter.schema,
                  parameter,
                  value: argumentsValue[parameter.name],
                  onChange: (value) => set({ invocation: { commandId: selected.id, arguments: { ...argumentsValue, [parameter.name]: value } } }),
                }))),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete command'));

      } else if (node.cat === 'generate') {
        body = h(React.Fragment, null,
          h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'Autonomous Routine invokes this function at runtime. Your robot code decides what trajectory it returns.'),
          h(Dropdown, { id: 'routine-function', label: 'Function reference', value: node.funcRef,
            items: A.pickerItems(A.FUNCTIONS, node.funcRef), placeholder: 'Choose a runtime function', icon: 'compass',
            allowCustom: true, customLabel: 'Enter exact function reference', customPlaceholder: 'Exact function reference',
            onChange: (value) => set({ funcRef: value }) }),
          h(Dropdown, { id: 'routine-generate-trigger', label: 'Trigger', value: node.trigger,
            items: A.pickerItems(A.TRIGGERS, node.trigger), placeholder: 'Choose when it runs', icon: 'bolt',
            allowCustom: true, customLabel: 'Enter exact function trigger', customPlaceholder: 'Exact trigger',
            onChange: (value) => set({ trigger: value }) }),
          FieldLabel('Parameters'),
          h(Params, { params: node.params, onChange: (p) => set({ params: p }) }),
          FieldLabel('Sim preview', node.preview ? h('button', { className: 'rt-mini-clear', type: 'button', onClick: () => set({ preview: null }) }, 'clear') : null),
          node.preview
            ? h('div', { className: 'rt-genbadge' }, h(Icon, { name: 'compass', size: 13 }), 'Dashed preview trajectory shown on the field — illustration only, not the deployed path.')
            : h('div', { className: 'seg-hint' }, 'No preview attached. This step shows as a runtime marker in the simulation.'),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', 'aria-label': 'Function notes', value: node.note || '', placeholder: 'What this generated path is for\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));

      } else if (node.cat === 'sequence') {
        const op = A.seqOp(node.op);
        body = h(React.Fragment, null,
          h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'Sequence ops re-order the routine itself at runtime — independent of any robot.'),
          h(Dropdown, { id: 'routine-sequence-operation', label: 'Operation', value: node.op,
            items: A.SEQ_OPS.map((operation) => ({ value: operation.id, label: operation.label, meta: operation.blurb })),
            onChange: (value) => set({ op: value }) }),
          h('div', { className: 'seg-hint' }, op.blurb),
          (node.op !== 'reorder') && h(React.Fragment, null,
            h(Dropdown, { id: 'routine-sequence-target', label: 'Target path', value: node.target || '', icon: 'route',
              items: [{ value: '', label: 'Choose a path' }, ...paths.map((path) => ({ value: path.name, label: path.name }))],
              onChange: (value) => set({ target: value }) })),
          h(Dropdown, { id: 'routine-sequence-trigger', label: 'Trigger', value: node.trigger,
            items: A.pickerItems(A.TRIGGERS, node.trigger), placeholder: 'Choose when it runs', icon: 'bolt',
            allowCustom: true, customLabel: 'Enter exact sequence trigger', customPlaceholder: 'Exact trigger',
            onChange: (value) => set({ trigger: value }) }),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', 'aria-label': 'Sequence notes', value: node.note || '', placeholder: 'Why this re-sequences the run\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));

      } else if (node.cat === 'velocity') {
        const pct = Math.round((node.scale != null ? node.scale : 0.5) * 100);
        body = h(React.Fragment, null,
          FieldLabel('Title'),
          h('input', { className: 'textinput', 'aria-label': 'Velocity rule title', value: node.title, spellCheck: false, onChange: (e) => set({ title: e.target.value }) }),
          h(Dropdown, { id: 'routine-velocity-trigger', label: 'Trigger', value: node.trigger,
            items: A.pickerItems(A.TRIGGERS, node.trigger), placeholder: 'Choose when it runs', icon: 'bolt',
            allowCustom: true, customLabel: 'Enter exact velocity trigger', customPlaceholder: 'Exact trigger',
            onChange: (value) => set({ trigger: value }) }),
          FieldLabel('Velocity scale', h('span', { className: 'rt-scaleval' }, pct + '%')),
          h('input', { className: 'rt-slider', type: 'range', 'aria-label': 'Velocity scale', min: 5, max: 100, step: 5, value: pct, onChange: (e) => set({ scale: +e.target.value / 100 }) }),
          h('div', { className: 'seg-hint' }, 'Caps drive speed to ' + pct + '% of the active constraints while this is held.'),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', 'aria-label': 'Velocity rule notes', value: node.note || '', placeholder: 'When and why to slow down\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));

      } else { // terminate
        body = h(React.Fragment, null,
          FieldLabel('Title'),
          h('input', { className: 'textinput', 'aria-label': 'Terminate rule title', value: node.title, spellCheck: false, onChange: (e) => set({ title: e.target.value }) }),
          h(Dropdown, { id: 'routine-terminate-trigger', label: 'Trigger', value: node.trigger,
            items: A.pickerItems(A.TRIGGERS, node.trigger), placeholder: 'Choose when it runs', icon: 'bolt',
            allowCustom: true, customLabel: 'Enter exact termination trigger', customPlaceholder: 'Exact trigger',
            onChange: (value) => set({ trigger: value }) }),
          h('div', { className: 'seg-hint' }, 'Ends the running path the moment the trigger fires and advances to the next step.'),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', 'aria-label': 'Terminate rule notes', value: node.note || '', placeholder: 'What this ends and why\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));
      }
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
      label: A.nodeTitle(step.node),
    }));
    const instants = run.steps.filter((step) => step.t1 <= step.t0).map((step) => ({
      key: step.node.id,
      left: run.total ? step.t0 / run.total * 100 : 0,
      label: A.nodeTitle(step.node),
    }));

    return h('div', { className: 'rt-transport timeline' + (running ? ' running' : '') },
      h('div', { className: 'rt-timeline-toolbar' },
        h('div', { className: 'rt-tp-ctl' },
          h('button', { className: 'rt-tp-btn', type: 'button', title: 'Restart routine', 'aria-label': 'Restart routine', onClick: controls.reset }, h(Icon, { name: 'rewind', size: 14 })),
          h('button', { className: 'rt-tp-btn play', type: 'button', disabled: nSteps === 0, title: 'Play / pause routine', 'aria-label': playing ? 'Pause routine playback' : 'Play routine', onClick: controls.toggle }, h(Icon, { name: playing ? 'pause' : 'play', size: 15, fill: !playing }))),
        h('span', { className: 'rt-timeline-title' }, 'Routine'),
        h('span', { className: 'rt-timeline-time' }, time.toFixed(2), h('small', null, ' / ' + run.total.toFixed(2) + 's')),
        h('span', { className: 'rt-timeline-summary' }, nSteps + (nSteps === 1 ? ' step' : ' steps')),
        h('div', { className: 'rt-timeline-step' }, activeIdx >= 0 ? String(activeIdx + 1).padStart(2, '0') : '–', h('small', null, '/' + String(nSteps).padStart(2, '0')))),
      h('div', { className: 'rt-timeline-editor', style: { '--routine-progress': pct } },
        h('span', { className: 'rt-timeline-track' }),
        spans.map((span) => h('span', { key: span.key, className: 'rt-timeline-span', title: span.label, style: { left: span.left + '%', width: span.width + '%', '--step-color': span.color } })),
        instants.map((instant) => h('span', { key: instant.key, className: 'rt-timeline-event', title: instant.label, style: { left: instant.left + '%' } })),
        h('input', { className: 'rt-tp-scrub', type: 'range', 'aria-label': 'Routine playback position', min: 0, max: 1000, value: Math.round(pct * 1000), onChange: (event) => controls.seek((event.target.value / 1000) * run.total) })));
  }

  window.StepInspector = StepInspector;
  window.RoutineTransport = RoutineTransport;
})();
