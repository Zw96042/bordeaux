// Autonomous Routine — routine hierarchy (LEFT rail). Step list + inline Add Step chooser.
// Stable layout: selecting a step only changes the right inspector. Drag the grip to reorder.
// Needs React + window.UI + window.AUTO. Exports window.RoutinePanel
(function () {
  const { useState, useRef } = React;
  const h = React.createElement;
  const { Icon } = window.UI;
  const A = window.AUTO;
  const fmt = (t) => (t || 0).toFixed(2) + 's';

  // ---- drag-reorder controller (siblings only) ----
  function useDnd(acq) {
    const [drag, setDrag] = useState(null);   // { id }
    const [over, setOver] = useState(null);    // { id, before }
    const overRef = useRef(null);
    const start = (id, e) => {
      e.preventDefault(); e.stopPropagation();
      setDrag({ id }); overRef.current = null; setOver(null);
      const move = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const card = el && el.closest && el.closest('.rt-step');
        let o = null;
        if (card) { const tid = card.getAttribute('data-id'); if (tid && tid !== id) { const r = card.getBoundingClientRect(); o = { id: tid, before: ev.clientY < r.top + r.height / 2 }; } }
        overRef.current = o; setOver(o);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const o = overRef.current;
        if (o && o.id) acq.reorder(id, o.id, o.before);
        overRef.current = null; setDrag(null); setOver(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    return { drag, over, start };
  }

  // ---- inline Add Step chooser (expands in-flow; never floats over the canvas) ----
  function Chooser({ onPick }) {
    const [sub, setSub] = useState(null);
    const cap = (c) => { const C = A.CATS[c]; return h('button', { key: c, type: 'button', className: 'rt-ch-cap', onClick: () => onPick('function', c) },
      h('span', { className: 'rt-ch-ic', style: { color: C.color } }, h(Icon, { name: C.icon, size: 15 })),
      h('span', { className: 'rt-ch-capt' }, C.label),
      h('span', { className: 'rt-ch-capd' }, C.blurb)); };
    if (sub === 'function') {
      return h('div', { className: 'rt-chooser' },
        h('button', { className: 'rt-ch-back', type: 'button', onClick: () => setSub(null) },
          h('span', { className: 'rt-ch-backic' }, h(Icon, { name: 'chevron', size: 14 })), 'Function modifies execution'),
        A.CAT_LIST.map(cap));
    }
    return h('div', { className: 'rt-chooser' },
      h('div', { className: 'rt-ch-sec' }, 'Structure'),
      h('button', { className: 'rt-ch-row', type: 'button', onClick: () => onPick('path') },
        h('span', { className: 'rt-ch-ic', style: { color: 'var(--accent)' } }, h(Icon, { name: 'route', size: 16 })),
        h('span', { className: 'rt-ch-main' }, h('span', { className: 'rt-ch-t' }, 'Path'), h('span', { className: 'rt-ch-d' }, 'Follow a planned trajectory'))),
      h('button', { className: 'rt-ch-row', type: 'button', onClick: () => onPick('decision') },
        h('span', { className: 'rt-ch-ic', style: { color: '#9aa3b0' } }, h(Icon, { name: 'branch', size: 16 })),
        h('span', { className: 'rt-ch-main' }, h('span', { className: 'rt-ch-t' }, 'Decision'), h('span', { className: 'rt-ch-d' }, 'Branch the routine on a condition'))),
      h('div', { className: 'rt-ch-sec' }, 'Behavior'),
      h('button', { className: 'rt-ch-row', type: 'button', onClick: () => setSub('function') },
        h('span', { className: 'rt-ch-ic', style: { color: 'var(--txt-2)' } }, h(Icon, { name: 'bolt', size: 16 })),
        h('span', { className: 'rt-ch-main' }, h('span', { className: 'rt-ch-t' }, 'Function'), h('span', { className: 'rt-ch-d' }, 'Generate · Velocity · Sequence · Terminate')),
        h('span', { className: 'rt-ch-more' }, h(Icon, { name: 'chevron', size: 14 }))));
  }

  function AddStep({ onPick, variant, label }) {
    const [open, setOpen] = useState(false);
    const pick = (type, cat) => { onPick(type, cat); setOpen(false); };
    if (variant === 'gap') {
      return h('div', { className: 'rt-gap' + (open ? ' open' : '') },
        h('button', { className: 'rt-gap-btn', type: 'button', title: 'Insert step here', 'aria-label': open ? 'Close step chooser' : 'Insert step here', 'aria-expanded': open, onClick: () => setOpen((o) => !o) }, h(Icon, { name: open ? 'x' : 'plus', size: 13 })),
        open && h(Chooser, { onPick: pick }));
    }
    return h('div', { className: 'rt-addwrap' },
      h('button', { className: 'rt-add' + (open ? ' on' : ''), type: 'button', onClick: () => setOpen((o) => !o) },
        h(Icon, { name: open ? 'x' : 'plus', size: 14 }), open ? 'Choose a step' : (label || 'Add step')),
      open && h(Chooser, { onPick: pick }));
  }

  function Grip(props) { return h('button', { className: 'rt-grip', type: 'button', title: 'Drag to reorder', 'aria-label': 'Drag step to reorder', onPointerDown: props.onPointerDown, onClick: (e) => e.stopPropagation() }, h(Icon, { name: 'drag', size: 13 })); }

  // ---- one step card ----
  function StepCard(props) {
    const { node, paths, run, selId, onSelect, acq, activeId, firedIds, dnd, collapsed, toggleCollapse, isFunction, nested } = props;
    const sel = selId === node.id;
    const active = activeId === node.id;
    const fired = firedIds.has(node.id) && !active;
    const dragging = dnd.drag && dnd.drag.id === node.id;
    const dropB = dnd.over && dnd.over.id === node.id && dnd.over.before;
    const dropA = dnd.over && dnd.over.id === node.id && !dnd.over.before;

    const seg = run.segs.find((s) => s.nodeId === node.id);
    let icon, color, meta, tag, kindCls;
    if (node.type === 'path') {
      const doc = paths.find((path) => path.id === node.ref); icon = 'route'; color = 'var(--accent)'; kindCls = 'path';
      meta = seg ? (fmt(seg.t1 - seg.t0) + '  ·  ' + seg.deriv.sample.length.toFixed(2) + ' m') : (doc ? 'not in run path' : 'unbound');
    } else if (node.type === 'decision') {
      icon = 'branch'; color = '#9aa3b0'; kindCls = 'decision'; meta = 'routes the run';
    } else {
      const C = A.CATS[node.cat]; icon = C.icon; color = C.color; kindCls = 'fn';
      tag = C.label;
      if (node.cat === 'generate') meta = (seg ? fmt(seg.t1 - seg.t0) + ' · ' : '') + 'runtime · ' + node.trigger;
      else meta = node.trigger;
    }
    const isDecision = node.type === 'decision';
    const isCollapsed = isDecision && collapsed.has(node.id);

    const cls = 'rt-step ' + kindCls + (sel ? ' sel' : '') + (active ? ' active' : '') + (fired ? ' fired' : '')
      + (dragging ? ' dragging' : '') + (dropB ? ' drop-before' : '') + (dropA ? ' drop-after' : '');

    const card = h('div', { className: cls, 'data-id': node.id, style: { '--fc': color } },
      h(Grip, { onPointerDown: (e) => dnd.start(node.id, e) }),
      isDecision
        ? h('button', { className: 'rt-collapse' + (isCollapsed ? ' on' : ''), type: 'button', 'aria-expanded': !isCollapsed, 'aria-label': isCollapsed ? 'Expand decision branches' : 'Collapse decision branches', title: isCollapsed ? 'Expand branches' : 'Collapse branches', onClick: (e) => { e.stopPropagation(); toggleCollapse(node.id); } }, h(Icon, { name: 'chevron', size: 14 }))
        : seg ? h('span', { className: 'rt-step-idx' }, seg.idxLabel) : null,
      h('span', { className: 'rt-step-ic', style: { color } }, h(Icon, { name: icon, size: 15 })),
      h('button', { className: 'rt-step-body', type: 'button', 'aria-pressed': sel, onClick: () => onSelect(sel ? null : node.id) },
        h('div', { className: 'rt-step-title' }, A.nodeTitle(node, paths)),
        h('div', { className: 'rt-step-meta' }, isCollapsed ? (A.branchCount(node.then) + A.branchCount(node.else)) + ' steps in 2 branches' : meta)),
      tag && h('span', { className: 'rt-step-tag', style: { color, borderColor: color } }, tag),
      active && h('span', { className: 'rt-step-live' }, node.type === 'path' || node.cat === 'generate' ? 'running' : 'firing'),
      h('span', { className: 'rt-step-tools' },
        h('button', { className: 'rt-tool', type: 'button', title: 'Move step up', 'aria-label': 'Move step up', onClick: () => acq.move(node.id, -1) }, '\u2191'),
        h('button', { className: 'rt-tool', type: 'button', title: 'Move step down', 'aria-label': 'Move step down', onClick: () => acq.move(node.id, 1) }, '\u2193'),
        h('button', { className: 'rt-tool danger', type: 'button', title: 'Delete step', 'aria-label': 'Delete step', onClick: (e) => { e.stopPropagation(); acq.del(node.id); } }, h(Icon, { name: 'trash', size: 13 }))));

    if (!isDecision) {
      return h('div', { className: 'rt-step-wrap' + (isFunction && !nested ? ' fnwrap' : '') }, card);
    }
    if (isCollapsed) return h('div', { className: 'rt-step-wrap' }, card);

    const out = acq.outcomes[node.id] || 'then';
    return h('div', { className: 'rt-step-wrap' }, card,
      h('div', { className: 'rt-branches' },
            h('button', { className: 'rt-brlbl', type: 'button', onClick: () => acq.setOutcome(node.id, br), title: 'Make this branch the simulated outcome' },
              h('span', { className: 'rt-brdot' }),
              h('span', { className: 'rt-brkey' }, br === 'then' ? 'if true' : 'if false'),
              h('span', { className: 'rt-brname' }, br === 'then' ? node.thenLabel : node.elseLabel),
              h('span', { className: 'rt-brcount' }, cnt),
              out === br && h('span', { className: 'rt-brlive' }, 'sim')),
            h('div', { className: 'rt-brbody' },
              (node[br] || []).map((cn) => h(StepCard, { key: cn.id, node: cn, paths, run, selId, onSelect, acq, activeId, firedIds, dnd, collapsed, toggleCollapse, isFunction: cn.type === 'function', nested: true })),
              h(AddStep, { variant: 'end', label: 'Add to branch', onPick: (t, c) => acq.addBranch(node.id, br, t, c) })));
        })));
  }

  function EmptyState({ acq }) {
    return h('div', { className: 'rt-empty' },
      h('div', { className: 'rt-empty-ic' }, h(Icon, { name: 'layers', size: 22 })),
      h('div', { className: 'rt-empty-t' }, 'Build your routine'),
      h('div', { className: 'rt-empty-d' }, 'Stack ', h('b', null, 'Path'), ' steps to drive, ', h('b', null, 'Decision'), ' steps to branch, and ', h('b', null, 'Function'), ' steps to change behavior at runtime.'),
      h(AddStep, { variant: 'end', label: 'Add first step', onPick: (t, c) => acq.addEnd(t, c) }));
  }

  function RoutinePanel(props) {
    const { routine, run, paths, selId, onSelect, acq, time, running } = props;
    const dnd = useDnd(acq);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const toggleCollapse = (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const activeIdx = run.steps.length ? A.stepAt(run, time) : -1;
    const activeId = (running && activeIdx >= 0) ? run.steps[activeIdx].node.id : null;
    const firedIds = new Set();
    run.steps.forEach((s) => { if (s.t1 <= time + 1e-6) firedIds.add(s.node.id); });
    const nSteps = A.countSteps(routine);

    return h('div', { className: 'rt-panel' + (dnd.drag ? ' dragging' : '') },
      h('div', { className: 'rt-hd' },
        h('span', { className: 'rt-mark' }),
        h('div', { className: 'rt-titlecol' },
          h('input', { className: 'rt-name', value: routine.name, spellCheck: false, onChange: (e) => acq.rename(e.target.value) }),
          h('div', { className: 'rt-sub' }, 'Autonomous Routine · ', nSteps, nSteps === 1 ? ' step' : ' steps', ' · ', fmt(run.total)))),

      h('div', { className: 'rt-scroll' },
        routine.nodes.length === 0
          ? h(EmptyState, { acq })
          : h('div', { className: 'rt-list' },
              h(AddStep, { variant: 'gap', onPick: (t, c) => acq.prepend(t, c) }),
              routine.nodes.map((n) => h(React.Fragment, { key: n.id },
                h(StepCard, { node: n, paths, run, selId, onSelect, acq, activeId, firedIds, dnd, collapsed, toggleCollapse, isFunction: n.type === 'function' }),
                h(AddStep, { variant: 'gap', onPick: (t, c) => acq.addAfter(n.id, t, c) }))),
              h(AddStep, { variant: 'end', onPick: (t, c) => acq.addEnd(t, c) }))));
  }

  window.RoutinePanel = RoutinePanel;
})();
