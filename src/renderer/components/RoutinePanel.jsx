import * as React from "react";
import { PointerDrag } from "../hooks/usePointerDrag";
import { AUTO } from "../lib/routineModel";
import { UnitPrefs } from "../lib/unitPreferences";
import { UI } from "./ui";

// Autonomous Routine — routine hierarchy (LEFT rail). Step list + inline Add Step chooser.
// Stable layout: selecting a step only changes the right inspector. Drag the grip to reorder.
  const { useState, useRef } = React;
  const h = React.createElement;
  const { Icon } = UI;
  const A = AUTO;
  const fmt = (t) => (t || 0).toFixed(2) + 's';

  // ---- drag-reorder controller (siblings only) ----
  function useDnd(acq) {
    const [drag, setDrag] = useState(null);   // { id }
    const [over, setOver] = useState(null);    // { id, before }
    const overRef = useRef(null);
    const pointerDrag = PointerDrag.useController();
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
        const o = overRef.current;
        if (o && o.id) acq.reorder(id, o.id, o.before);
        overRef.current = null; setDrag(null); setOver(null);
      };
      pointerDrag.start(e, { move, end: up, cancel: () => { overRef.current = null; setDrag(null); setOver(null); } });
    };
    return { drag, over, start };
  }

  // ---- inline Add Step chooser (expands in-flow; never floats over the canvas) ----
  function Chooser({ onPick, waitAvailable }) {
    return h('div', { className: 'rt-chooser' },
      h('div', { className: 'rt-ch-sec' }, 'Add step'),
      A.AUTHORABLE_STEPS.map((step) => {
        const unavailable = step.id === 'wait' && !waitAvailable;
        return h('button', { key: step.id, className: 'rt-ch-row', type: 'button', disabled: unavailable,
          title: unavailable ? 'Build and link a generated Java catalog with bordeaux.wait to add Wait.' : undefined,
          onClick: () => !unavailable && onPick(step.type, step.cat) },
        h('span', { className: 'rt-ch-ic', style: { color: step.color } }, h(Icon, { name: step.icon, size: 16 })),
        h('span', { className: 'rt-ch-main' }, h('span', { className: 'rt-ch-t' }, step.label),
          h('span', { className: 'rt-ch-d' }, unavailable ? 'Unavailable until the linked generated catalog provides bordeaux.wait' : step.description)));
      }));
  }

  function AddStep({ onPick, variant, label, waitAvailable }) {
    const [open, setOpen] = useState(false);
    const pick = (type, cat) => { onPick(type, cat); setOpen(false); };
    if (variant === 'gap') {
      return h('div', { className: 'rt-gap' + (open ? ' open' : '') },
        h('button', { className: 'rt-gap-btn', type: 'button', title: 'Insert step here', 'aria-label': open ? 'Close step chooser' : 'Insert step here', 'aria-expanded': open, onClick: () => setOpen((o) => !o) }, h(Icon, { name: open ? 'x' : 'plus', size: 13 })),
        open && h(Chooser, { onPick: pick, waitAvailable }));
    }
    return h('div', { className: 'rt-addwrap' },
      h('button', { className: 'rt-add' + (open ? ' on' : ''), type: 'button', onClick: () => setOpen((o) => !o) },
        h(Icon, { name: open ? 'x' : 'plus', size: 14 }), open ? 'Choose a step' : (label || 'Add step')),
      open && h(Chooser, { onPick: pick, waitAvailable }));
  }

  function Grip(props) { return h('button', { className: 'rt-grip', type: 'button', title: 'Drag to reorder', 'aria-label': 'Drag step to reorder', onPointerDown: props.onPointerDown, onClick: (e) => e.stopPropagation() }, h(Icon, { name: 'drag', size: 13 })); }

  // ---- one step card ----
  function StepCard(props) {
    const { node, paths, run, selId, onSelect, acq, activeId, firedIds, dnd, collapsed, toggleCollapse, isFunction, nested, waitAvailable, catalog } = props;
    const sel = selId === node.id;
    const active = activeId === node.id;
    const fired = firedIds.has(node.id) && !active;
    const dragging = dnd.drag && dnd.drag.id === node.id;
    const dropB = dnd.over && dnd.over.id === node.id && dnd.over.before;
    const dropA = dnd.over && dnd.over.id === node.id && !dnd.over.before;

    const seg = run.segs.find((s) => s.nodeId === node.id);
    let icon, color, meta, tag, kindCls;
    const deployment = A.nodeDeploymentState(node, catalog);
    if (!deployment.deployable) {
      icon = 'info'; color = '#d2655f'; kindCls = 'fn'; tag = 'Legacy — cannot deploy'; meta = deployment.legacy ? 'Replace or remove this legacy step before export' : 'This unsupported step can be removed but cannot deploy';
    } else if (node.type === 'path') {
      const doc = paths.find((path) => path.id === node.ref); icon = 'route'; color = 'var(--accent)'; kindCls = 'path';
      meta = seg ? (fmt(seg.t1 - seg.t0) + '  ·  ' + UnitPrefs.format(seg.deriv.sample.length, 'm', 2)) : (doc ? 'not in run path' : 'unbound');
    } else if (node.type === 'decision') {
      icon = 'branch'; color = '#9aa3b0'; kindCls = 'decision'; meta = 'routes the run';
    } else if (node.type === 'builtin') {
      icon = 'pause'; color = '#cf962f'; kindCls = 'fn'; tag = 'Wait'; meta = fmt(node.arguments && node.arguments.durationS) + ' pause';
    } else if (node.type === 'generatedTrajectory') {
      icon = 'route'; color = '#cf962f'; kindCls = 'fn'; tag = 'Runtime dynamic'; meta = 'Generated and validated on the robot · no desktop preview';
    } else {
      const C = A.CATS[node.cat] || { icon: 'info', color: '#d2655f', label: 'Unknown step' }; icon = C.icon; color = C.color; kindCls = 'fn';
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
        h('div', { className: 'rt-step-title' }, A.nodeTitle(node, paths, catalog)),
        h('div', { className: 'rt-step-meta' }, isCollapsed ? (A.branchCount(node.then) + A.branchCount(node.else)) + ' steps in 2 branches' : meta)),
      tag && h('span', { className: 'rt-step-tag', style: { color, borderColor: color } }, tag),
      active && h('span', { className: 'rt-step-live' }, node.type === 'path' || node.type === 'builtin' || node.cat === 'generate' ? 'running' : 'firing'),
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
        ['then', 'else'].map((br) => {
          const cnt = A.branchCount(node[br]);
          return h('div', { key: br, className: 'rt-branch' + (out === br ? ' live' : '') },
            h('button', { className: 'rt-brlbl', type: 'button', onClick: () => acq.setOutcome(node.id, br), title: 'Make this branch the simulated outcome' },
              h('span', { className: 'rt-brdot' }),
              h('span', { className: 'rt-brkey' }, br === 'then' ? 'if true' : 'if false'),
              h('span', { className: 'rt-brname' }, br === 'then' ? node.thenLabel : node.elseLabel),
              h('span', { className: 'rt-brcount' }, cnt),
              out === br && h('span', { className: 'rt-brlive' }, 'sim')),
            h('div', { className: 'rt-brbody' },
              (Array.isArray(node[br]) ? node[br] : []).map((cn, index) => h(StepCard, { key: cn.id || index, node: cn, paths, run, selId, onSelect, acq, activeId, firedIds, dnd, collapsed, toggleCollapse, isFunction: cn.type === 'function', nested: true, waitAvailable, catalog })),
              h(AddStep, { variant: 'end', label: 'Add to branch', waitAvailable, onPick: (t, c) => acq.addBranch(node.id, br, t, c) })));
        })));
  }

  function EmptyState({ acq, waitAvailable }) {
    return h('div', { className: 'rt-empty' },
      h('div', { className: 'rt-empty-t' }, 'No steps yet'),
      h(AddStep, { variant: 'end', label: 'Add first step', waitAvailable, onPick: (t, c) => acq.addEnd(t, c) }));
  }

  function RoutinePanel(props) {
    const { routine, run, paths, selId, onSelect, acq, time, running, catalog } = props;
    const waitAvailable = A.hasWaitBuiltIn(catalog);
    const dnd = useDnd(acq);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const toggleCollapse = (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const activeIdx = run.steps.length ? A.stepAt(run, time) : -1;
    const activeId = (running && activeIdx >= 0) ? run.steps[activeIdx].node.id : null;
    const firedIds = new Set();
    run.steps.forEach((s) => { if (s.t1 <= time + 1e-6) firedIds.add(s.node.id); });
    return h('div', { className: 'rt-panel' + (dnd.drag ? ' dragging' : '') },
      h('div', { className: 'rt-scroll' },
        routine.nodes.length === 0
          ? h(EmptyState, { acq, waitAvailable })
          : h('div', { className: 'rt-list' },
              h(AddStep, { variant: 'gap', waitAvailable, onPick: (t, c) => acq.prepend(t, c) }),
              routine.nodes.map((n, index) => h(React.Fragment, { key: n.id || index },
                h(StepCard, { node: n, paths, run, selId, onSelect, acq, activeId, firedIds, dnd, collapsed, toggleCollapse, isFunction: n.type === 'function', waitAvailable, catalog }),
                index < routine.nodes.length - 1 && h(AddStep, { variant: 'gap', waitAvailable, onPick: (t, c) => acq.addAfter(n.id, t, c) }))),
              h(AddStep, { variant: 'end', waitAvailable, onPick: (t, c) => acq.addEnd(t, c) }))));
  }

export { RoutinePanel };
