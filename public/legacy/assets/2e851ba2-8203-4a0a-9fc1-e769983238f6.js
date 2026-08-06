// Autonomous Routine — step inspector (RIGHT rail) + run transport (bottom).
// One inspector system, shared with the Plan page (.ctxinsp shell + form primitives).
// Needs React + window.UI + window.AUTO. Exports window.StepInspector, window.RoutineTransport
(function () {
  const { useState } = React;
  const h = React.createElement;
  const { Icon, Num, Seg } = window.UI;
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
    const { node, paths, acq, run } = props;
    if (!node) return null;
    const set = (patch) => acq.set(node.id, patch);
    const seg = run.segs.find((s) => s.nodeId === node.id);
    let icon = 'dot', title = '', tag = null, accent = 'var(--accent)', body = null;

    if (node.type === 'path') {
      const doc = paths.find((path) => path.id === node.ref);
      icon = 'route'; title = 'Path'; tag = 'step';
      body = h(React.Fragment, null,
        FieldLabel('Bound path'),
        h('select', { className: 'selectinput', 'aria-label': 'Routine path', value: node.ref, onChange: (e) => set({ ref: e.target.value }) },
          paths.map((p) => h('option', { key: p.id, value: p.id }, p.name))),
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
        FieldLabel('Condition'),
        h('input', { className: 'textinput', value: node.cond, spellCheck: false, onChange: (e) => set({ cond: e.target.value }) }),
        h('div', { className: 'grid2', style: { marginTop: '10px' } },
          h('div', null, FieldLabel('If true'), h('input', { className: 'textinput', value: node.thenLabel, spellCheck: false, onChange: (e) => set({ thenLabel: e.target.value }) })),
          h('div', null, FieldLabel('If false'), h('input', { className: 'textinput', value: node.elseLabel, spellCheck: false, onChange: (e) => set({ elseLabel: e.target.value }) }))),
        FieldLabel('Simulated outcome'),
        h(Seg, { value: out, options: [{ v: 'then', label: node.thenLabel || 'true' }, { v: 'else', label: node.elseLabel || 'false' }], onChange: (v) => acq.setOutcome(node.id, v) }),
        h('div', { className: 'seg-hint' }, 'Picks which branch the simulation runs. Both branches stay in the routine.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete decision'));

    } else {
      const C = A.CATS[node.cat]; icon = C.icon; accent = C.color; tag = C.label;
      title = 'Function';
      if (node.cat === 'generate') {
        body = h(React.Fragment, null,
          h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'Autonomous Routine invokes this function at runtime. Your robot code decides what trajectory it returns.'),
          FieldLabel('Function reference'),
          h('input', { className: 'textinput rt-fnref-input', value: node.funcRef, spellCheck: false, onChange: (e) => set({ funcRef: e.target.value }) }),
          FieldLabel('Trigger'),
          h('input', { className: 'textinput', value: node.trigger, spellCheck: false, onChange: (e) => set({ trigger: e.target.value }) }),
          FieldLabel('Parameters'),
          h(Params, { params: node.params, onChange: (p) => set({ params: p }) }),
          FieldLabel('Sim preview', node.preview ? h('button', { className: 'rt-mini-clear', type: 'button', onClick: () => set({ preview: null }) }, 'clear') : null),
          node.preview
            ? h('div', { className: 'rt-genbadge' }, h(Icon, { name: 'compass', size: 13 }), 'Dashed preview trajectory shown on the field — illustration only, not the deployed path.')
            : h('div', { className: 'seg-hint' }, 'No preview attached. This step shows as a runtime marker in the simulation.'),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', value: node.note || '', placeholder: 'What this generated path is for\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));

      } else if (node.cat === 'sequence') {
        const op = A.seqOp(node.op);
        body = h(React.Fragment, null,
          h('div', { className: 'rt-callout' }, h(Icon, { name: 'info', size: 14 }), 'Sequence ops re-order the routine itself at runtime — independent of any robot.'),
          FieldLabel('Operation'),
          h('select', { className: 'selectinput', value: node.op, onChange: (e) => set({ op: e.target.value }) },
            A.SEQ_OPS.map((o) => h('option', { key: o.id, value: o.id }, o.label))),
          h('div', { className: 'seg-hint' }, op.blurb),
          (node.op !== 'reorder') && h(React.Fragment, null,
            FieldLabel('Target path'),
            h('select', { className: 'selectinput', value: node.target || '', onChange: (e) => set({ target: e.target.value }) },
              h('option', { value: '' }, '— choose a path —'),
              paths.map((p, i) => h('option', { key: i, value: p.name }, p.name)))),
          FieldLabel('Trigger'),
          h('input', { className: 'textinput', value: node.trigger, spellCheck: false, onChange: (e) => set({ trigger: e.target.value }) }),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', value: node.note || '', placeholder: 'Why this re-sequences the run\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));

      } else if (node.cat === 'velocity') {
        const pct = Math.round((node.scale != null ? node.scale : 0.5) * 100);
        body = h(React.Fragment, null,
          FieldLabel('Title'),
          h('input', { className: 'textinput', value: node.title, spellCheck: false, onChange: (e) => set({ title: e.target.value }) }),
          FieldLabel('Trigger'),
          h('input', { className: 'textinput', value: node.trigger, spellCheck: false, onChange: (e) => set({ trigger: e.target.value }) }),
          FieldLabel('Velocity scale', h('span', { className: 'rt-scaleval' }, pct + '%')),
          h('input', { className: 'rt-slider', type: 'range', min: 5, max: 100, step: 5, value: pct, onChange: (e) => set({ scale: +e.target.value / 100 }) }),
          h('div', { className: 'seg-hint' }, 'Caps drive speed to ' + pct + '% of the active constraints while this is held.'),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', value: node.note || '', placeholder: 'When and why to slow down\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));

      } else { // terminate
        body = h(React.Fragment, null,
          FieldLabel('Title'),
          h('input', { className: 'textinput', value: node.title, spellCheck: false, onChange: (e) => set({ title: e.target.value }) }),
          FieldLabel('Trigger'),
          h('input', { className: 'textinput', value: node.trigger, spellCheck: false, onChange: (e) => set({ trigger: e.target.value }) }),
          h('div', { className: 'seg-hint' }, 'Ends the running path the moment the trigger fires and advances to the next step.'),
          FieldLabel('Notes'),
          h('textarea', { className: 'rt-note', value: node.note || '', placeholder: 'What this ends and why\u2026', onChange: (e) => set({ note: e.target.value }) }),
          h('button', { className: 'delbtn', type: 'button', onClick: () => acq.del(node.id) }, h(Icon, { name: 'trash', size: 15 }), 'Delete function'));
      }
    }

    return h('div', { className: 'ctxinsp' },
      h('div', { className: 'ctxinsp-hd' },
        h('span', { className: 'ctxinsp-ic', style: { background: 'color-mix(in srgb,' + accent + ' 16%, transparent)', color: accent } }, h(Icon, { name: icon, size: 15 })),
        h('span', { className: 'ctxinsp-t' }, title),
        tag && h('span', { className: 'ctxinsp-tag' }, tag),
        h('button', { className: 'ctxinsp-x', type: 'button', title: 'Close', onClick: () => acq.select(null) }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'ctxinsp-body' }, body));
  }

  // ---- run log ----
  function buildLog(run, time, outcomes) {
    const out = [];
    run.steps.forEach((s) => {
      if (s.t0 > time + 1e-6) return;
      const n = s.node;
      if (s.kind === 'decision') {
        const br = (outcomes && outcomes[n.id]) || 'then';
        out.push({ t: s.t0, color: '#9aa3b0', icon: 'branch', text: n.cond + '  →  ' + (br === 'then' ? n.thenLabel : n.elseLabel) });
      } else if (s.kind === 'path') {
        out.push({ t: s.t0, color: 'var(--accent)', icon: 'route', text: 'Follow ' + s.label });
      } else if (s.kind === 'gen') {
        out.push({ t: s.t0, color: A.CATS.generate.color, icon: 'compass', text: 'Invoke ' + n.funcRef + '()' });
      } else {
        const C = A.CATS[n.cat];
        out.push({ t: s.t0, color: C.color, icon: C.icon, text: A.nodeTitle(n) });
      }
    });
    return out.reverse();
  }

  // ---- bottom transport: a Run pill while authoring, full controls once simulating ----
  function RoutineTransport(props) {
    const { run, time, playing, controls, running, outcomes } = props;
    const nSteps = run.steps.length;
    const activeIdx = nSteps ? A.stepAt(run, time) : -1;
    const pct = run.total > 0 ? Math.max(0, Math.min(1, time / run.total)) : 0;

    if (!running) {
      return h('div', { className: 'rt-transport build' },
        h('button', { className: 'rt-runpill', type: 'button', onClick: () => controls.play() },
          h(Icon, { name: 'play', size: 14, fill: true }), 'Run routine'),
        h('span', { className: 'rt-tp-meta' }, nSteps + (nSteps === 1 ? ' step' : ' steps'), h('span', { className: 'rt-tp-dim' }, ' · ' + fmt(run.total))));
    }

    const log = buildLog(run, time, outcomes);
    return h('div', { className: 'rt-transport run' },
      log.length > 0 && h('div', { className: 'rt-tp-log' },
        log.slice(0, 4).map((l, i) => h('div', { className: 'rt-tp-logrow' + (i === 0 ? ' head' : ''), key: i },
          h('span', { className: 'rt-tp-logt' }, l.t.toFixed(2)),
          h('span', { className: 'rt-tp-logic', style: { color: l.color } }, h(Icon, { name: l.icon, size: 12 })),
          h('span', { className: 'rt-tp-logtx' }, l.text)))),
      h('div', { className: 'rt-tp-ctl' },
        h('button', { className: 'rt-tp-btn', type: 'button', title: 'Reset & exit playback', onClick: controls.reset }, h(Icon, { name: 'rewind', size: 15 })),
        h('button', { className: 'rt-tp-btn', type: 'button', title: 'Step back', onClick: () => controls.step(-1) }, h('span', { style: { transform: 'scaleX(-1)', display: 'flex' } }, h(Icon, { name: 'play', size: 12, fill: true }))),
        h('button', { className: 'rt-tp-btn play', type: 'button', title: 'Play / pause', onClick: controls.toggle }, h(Icon, { name: playing ? 'pause' : 'play', size: 15, fill: true })),
        h('button', { className: 'rt-tp-btn', type: 'button', title: 'Step forward', onClick: () => controls.step(1) }, h(Icon, { name: 'play', size: 12, fill: true })),
        h('div', { className: 'rt-tp-scrubwrap' },
          h('input', { className: 'rt-tp-scrub', type: 'range', min: 0, max: 1000, value: Math.round(pct * 1000), onChange: (e) => controls.seek((e.target.value / 1000) * run.total) }),
          run.segs.map((s) => h('span', { key: s.nodeId, className: 'rt-tp-tick', style: { left: (run.total ? (s.t1 / run.total) * 100 : 0) + '%' } }))),
        h('div', { className: 'rt-tp-step' },
          h('span', { className: 'rt-tp-n' }, activeIdx >= 0 ? String(activeIdx + 1).padStart(2, '0') : '–', h('span', { className: 'rt-tp-dim' }, '/' + String(nSteps).padStart(2, '0'))),
          h('span', { className: 'rt-tp-t' }, fmt(time)))));
  }

  window.StepInspector = StepInspector;
  window.RoutineTransport = RoutineTransport;
})();
