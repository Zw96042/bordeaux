import { KeyboardHelp } from './KeyboardHelp';
import { PathLinks } from '../lib/pathLinks';
import * as React from "react";
import { PointerDrag } from "../hooks/usePointerDrag";
import { PM } from "../lib/pathMath";
import { AUTO } from "../lib/routineModel";
import { UnitPrefs } from "../lib/unitPreferences";
import { UI } from "./ui";

  const { useRef, useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { Icon, IconBtn, Dropdown, Section, constraintRangeSummary } = UI;
  const R2D = 180 / Math.PI;

  function Toolbar(props) {
    const { page, setPage, alliance, setAlliance, onUndo, onRedo,
      optimizationOpen, toggleOptimization, optimizationApplied, editorPage } = props;
    const plan = page === 'plan';
    return h('header', { className: 'toolbar' },
      h('div', { className: 'tb-left' },
        h('div', { className: 'brand' }, h('span', { className: 'brand-name' }, 'Bordeaux')),
        h('nav', { className: 'pageswitch', 'aria-label': 'Workspace' },
          h('button', { className: page !== 'robot' ? 'on' : '', type: 'button', 'aria-current': page !== 'robot' ? 'page' : undefined, onClick: () => setPage(editorPage) }, h(Icon, { name: 'route', size: 15 }), 'Editor'),
          h('button', { className: page === 'robot' ? 'on' : '', type: 'button', 'aria-current': page === 'robot' ? 'page' : undefined, onClick: () => setPage('robot') }, h(Icon, { name: 'gear', size: 15 }), 'Settings'))),

      h('div', { className: 'tb-right' },
        h(KeyboardHelp),
        plan && h(React.Fragment, null,
          h('div', { className: 'tbdiv' }),
          h('button', { type: 'button', className: 'qbtn optimizer-toggle', 'aria-expanded': optimizationOpen, onClick: toggleOptimization }, optimizationApplied ? 'Optimized' : 'Optimize')),
        h(React.Fragment, null,
          h('button', { className: 'qbtn tb-file', type: 'button', title: 'Open project (⌘O)', 'aria-label': 'Open project', onClick: props.onOpen }, 'Open'),
          h('button', { className: 'qbtn tb-file', type: 'button', title: 'Open folder (⌘⇧O)', 'aria-label': 'Open project folder', onClick: props.onOpenFolder }, h(Icon, { name: 'folder', size: 14 })),
          h('button', { className: 'qbtn tb-file', type: 'button', title: 'Save project (⌘S)', 'aria-label': 'Save project', onClick: () => props.onSave(false) }, 'Save')),
        (plan || page === 'auto') && h(React.Fragment, null,
          h(IconBtn, { icon: 'undo', onClick: onUndo, title: 'Undo  (\u2318Z)' }),
          h(IconBtn, { icon: 'redo', onClick: onRedo, title: 'Redo  (\u21e7\u2318Z)' })),
        (plan || page === 'auto') && h(React.Fragment, null,
          h('button', { className: 'alliance field-flip', type: 'button', 'aria-pressed': alliance === 'red', onClick: () => setAlliance(alliance === 'blue' ? 'red' : 'blue'), title: 'Flip the field 180° without changing the path', 'aria-label': 'Flip field 180 degrees' },
            h(Icon, { name: 'flip', size: 14 }), h('span', null, 'Flip')))));
  }

  const TOOLS = [
    { id: 'select', icon: 'select', label: 'Select / move', key: '1', alternateKey: 'V' },
    { id: 'waypoint', icon: 'waypoint', label: 'Place waypoint', key: '2', alternateKey: 'W' },
    { id: 'rotation', icon: 'rotation', label: 'Rotation target', key: '3', alternateKey: 'R' },
    { id: 'marker', icon: 'flag2', label: 'Place command', key: '4', alternateKey: 'M' },
    { id: 'range', icon: 'gauge', label: 'Constraint region', key: '5', alternateKey: 'C' },
  ];
  function ToolRail({ tool, setTool }) {
    return h('div', { className: 'toolrail' }, TOOLS.map((t) =>
      h('button', { key: t.id, className: 'toolrail-b' + (tool === t.id ? ' on' : ''), type: 'button', 'aria-label': t.label, 'aria-pressed': tool === t.id, title: t.label + '  (' + t.key + ' or ' + t.alternateKey + ')', onClick: () => setTool(t.id) },
        h(Icon, { name: t.icon, size: 18 }), h('span', { className: 'toolrail-k' }, t.key))));
  }

  function ConstraintBar({ c, robot, onOpen }) {
    const limits = PM.effectiveConstraints(c, robot);
    const chips = [
      { k: 'Max V', v: UnitPrefs.fromCanonical(Math.min(limits.maxVel, robot.maxSpeed), 'm/s').toFixed(1), u: UnitPrefs.label('m/s') },
      { k: 'Max A', v: UnitPrefs.fromCanonical(limits.maxAccel, 'm/s²').toFixed(1), u: UnitPrefs.label('m/s²') },
      { k: 'Decel', v: UnitPrefs.fromCanonical(limits.maxDecel != null ? limits.maxDecel : limits.maxAccel, 'm/s²').toFixed(1), u: UnitPrefs.label('m/s²') },
      { k: 'Max \u03c9', v: (limits.maxAngVel || 0).toFixed(0), u: '\u00b0/s' },
    ];
    return h('button', { className: 'cbar', type: 'button', title: 'Edit global constraints', onClick: onOpen },
      h('span', { className: 'cbar-ic' }, h(Icon, { name: 'gauge', size: 14 })),
      chips.map((ch, i) => h('span', { key: i, className: 'cbar-chip' },
        h('span', { className: 'cbar-k' }, ch.k),
        h('span', { className: 'cbar-v' }, ch.v),
        h('span', { className: 'cbar-u' }, ch.u))),
      h('span', { className: 'cbar-edit' }, 'Edit'));
  }

  const behPill = (w) => w.stop ? { t: w.wait ? 'stop ' + (w.wait) + 's' : 'stop', c: 'r' } : w.corner ? { t: 'corner', c: 'n' } : null;
  const inspectItem = (actions, kind, index, event) => {
    event.preventDefault(); event.stopPropagation();
    actions.select(kind, index);
    if (actions.openInspector) actions.openInspector();
  };

  function WaypointList({ wps, names, sel, actions, ready }) {
    const [drag, setDrag] = useState(null);
    const rows = useRef([]);
    const reorderFocus = useRef(null);
    React.useLayoutEffect(() => {
      const pending = reorderFocus.current;
      if (!pending || !ready || pending.wps === wps) return;
      reorderFocus.current = null;
      if (document.activeElement === pending.trigger || document.activeElement === document.body) {
        rows.current[pending.target]?.querySelector('.featgrip')?.focus();
      }
    }, [wps, ready]);
    const pointerDrag = PointerDrag.useController();
    const startDrag = (i) => (e) => {
      e.preventDefault(); e.stopPropagation();
      setDrag({ from: i, over: i });
      const mv = (ev) => {
        let over = 0;
        rows.current.forEach((el, k) => { if (!el) return; const r = el.getBoundingClientRect(); if (ev.clientY > r.top + r.height / 2) over = k + 1; });
        over = Math.max(0, Math.min(wps.length - 1, over));
        setDrag((d) => (d && d.over === over) ? d : (d ? { ...d, over } : d));
      };
      const up = () => {
        setDrag((d) => { if (d && d.from !== d.over) actions.reorderWp(d.from, d.over); return null; });
      };
      pointerDrag.start(e, { move: mv, end: up, cancel: () => setDrag(null) });
    };
    return h('div', { className: 'wplist' + (drag ? ' dragging' : '') }, wps.map((w, i) => {
      const label = names[i];
      const mid = i !== 0 && i !== wps.length - 1;
      const bp = behPill(w);
      const cls = 'featrow wpfeatrow' + (sel.kind === 'wp' && sel.idx === i ? ' sel' : '') + (drag && drag.from === i ? ' dragging' : '') + (drag && drag.over === i && drag.from !== i ? ' over' : '');
      return h('div', { key: i, ref: (el) => (rows.current[i] = el), className: cls },
        h('button', { className: 'featgrip', type: 'button', 'aria-label': 'Reorder ' + label, title: 'Drag to reorder, or use the up and down arrow keys', 'aria-keyshortcuts': 'ArrowUp ArrowDown', onPointerDown: startDrag(i), onKeyDown: (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault(); event.stopPropagation();
          const target = i + (event.key === 'ArrowUp' ? -1 : 1);
          if (target < 0 || target >= wps.length) return;
          reorderFocus.current = { wps, target, trigger: event.currentTarget };
          actions.reorderWp(i, target);
        } }, h(Icon, { name: 'drag', size: 13 })),
        h('button', { className: 'featselect', type: 'button', 'aria-pressed': sel.kind === 'wp' && sel.idx === i, onClick: (event) => { if (event.shiftKey && wps.length > 2) actions.delWp(i); else actions.select('wp', i); }, onDoubleClick: (e) => inspectItem(actions, 'wp', i, e) },
          h('span', { className: 'featdot ' + (w.stop ? 'r sq' : i === 0 ? 'g' : i === wps.length - 1 ? 'r' : 'b') }),
          h('span', { className: 'featnm', title: label }, label),
          h('span', { className: 'featdetails' },
            h('span', { className: 'featmeta' }, UnitPrefs.fromCanonical(w.x, 'm').toFixed(1) + ', ' + UnitPrefs.format(w.y, 'm', 1)),
            mid && w.thetaOn && h('span', { className: 'pill th' }, (w.theta || 0).toFixed(0) + '\u00b0'),
            bp && h('span', { className: 'pill ' + bp.c }, bp.t))),
        wps.length > 2 && h('button', { className: 'featdel', 'aria-label': 'Delete ' + label, title: 'Delete', onClick: () => actions.delWp(i) }, h(Icon, { name: 'trash', size: 12 })));
    }));
  }

  function SegmentList({ wps, names, sel, actions }) {
    if (wps.length < 2) return h('div', { className: 'featempty' }, 'Add a second waypoint to form a segment');
    const name = (k) => names[k];
    const typeName = (id) => (PM.SEGTYPES.find((s) => s.id === id) || PM.SEGTYPES[2]).label;
    return h(React.Fragment, null, wps.slice(0, -1).map((w, i) =>
      h('div', { key: i, className: 'featrow segfeatrow' + (sel.kind === 'seg' && sel.idx === i ? ' sel' : '') },
        h('span', { className: 'featindent', 'aria-hidden': true }),
        h('button', { type: 'button', className: 'featselect', 'aria-pressed': sel.kind === 'seg' && sel.idx === i, onClick: () => actions.select('seg', i), onDoubleClick: (e) => inspectItem(actions, 'seg', i, e) },
          h('span', { className: 'featdot b' }),
          h('span', { className: 'featnm', title: name(i) + ' \u2192 ' + name(i + 1) }, name(i) + ' \u2192 ' + name(i + 1)),
          h('span', { className: 'featmeta' }, typeName(w.segType))))));
  }

  function Outline({ open, setOpen, project, doc, derived, sel, actions, secOpen, setSecOpen, robot, ready }) {
    const tog = (k) => setSecOpen((o) => ({ ...o, [k]: !o[k] }));
    const wps = doc.waypoints;
    const names = wps.map((_, index) => PathLinks.waypointName(project, doc, index));
    if (!open) {
      return h('button', { className: 'outline-tab', type: 'button', title: 'Show outline', onClick: () => setOpen(true) },
        h(Icon, { name: 'zones', size: 16 }), h('span', null, 'Outline'));
    }
    return h('div', { className: 'outline' },
      h('div', { className: 'outline-hd' },
        h('span', { className: 'outline-t' }, 'Outline'),
        h('button', { className: 'mini', type: 'button', title: 'Hide outline', 'aria-label': 'Hide outline', onClick: () => setOpen(false) }, h('span', { className: 'rot90' }, h(Icon, { name: 'chevron', size: 15 })))),
      h('div', { className: 'outline-scroll' },
        h(Section, { icon: 'waypoint', title: 'Waypoints', count: wps.length, open: secOpen.wp, onToggle: () => tog('wp') },
          h(WaypointList, { key: doc.id, wps, names, sel, actions, ready })),
        h(Section, { icon: 'route', title: 'Segments', count: Math.max(0, wps.length - 1), open: !!secOpen.sg, onToggle: () => tog('sg') },
          h(SegmentList, { wps, names, sel, actions })),
        h(Section, { icon: 'rotation', title: 'Rotation targets', count: doc.targets.length, open: secOpen.rt, onToggle: () => tog('rt') },
          doc.targets.length === 0 ? h('div', { className: 'featempty' }, 'Press R, then click the path') :
            doc.targets.map((t, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'rt' && sel.idx === i ? ' sel' : '') },
              h('button', { className: 'featselect', type: 'button', 'aria-pressed': sel.kind === 'rt' && sel.idx === i, onClick: (event) => { if (event.shiftKey) actions.delTarget(i); else actions.select('rt', i); }, onDoubleClick: (e) => inspectItem(actions, 'rt', i, e) }, h('span', { className: 'featdot n' }), h('span', { className: 'featnm' }, t.deg.toFixed(0) + '\u00b0'), h('span', { className: 'featmeta' }, t.anchor === 'dist' ? UnitPrefs.format(t.d != null ? t.d : PM.featureFraction(t, derived.sample) * derived.sample.length, 'm', 1) : (PM.featureFraction(t, derived.sample) * 100).toFixed(0) + '%')),
              h('button', { className: 'featdel', 'aria-label': 'Delete rotation target', title: 'Delete', onClick: () => actions.delTarget(i) }, h(Icon, { name: 'trash', size: 12 }))))),
        h(Section, { icon: 'flag2', title: 'Commands', count: doc.markers.length, open: secOpen.em, onToggle: () => tog('em') },
          doc.markers.length === 0 ? h('div', { className: 'featempty' }, 'Press M, then click the path') :
            doc.markers.map((m, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'em' && sel.idx === i ? ' sel' : '') },
              h('button', { className: 'featselect', type: 'button', 'aria-pressed': sel.kind === 'em' && sel.idx === i, onClick: (event) => { if (event.shiftKey) actions.delMarker(i); else actions.select('em', i); }, onDoubleClick: (e) => inspectItem(actions, 'em', i, e) }, h('span', { className: 'featdot n' }), h('span', { className: 'featnm', title: m.name }, m.name), h('span', { className: 'featmeta' }, m.anchor === 'dist' ? UnitPrefs.format(m.d != null ? m.d : PM.featureFraction(m, derived.sample) * derived.sample.length, 'm', 1) : (PM.featureFraction(m, derived.sample) * 100).toFixed(0) + '%')),
              h('button', { className: 'featdel', 'aria-label': 'Delete event marker ' + m.name, title: 'Delete', onClick: () => actions.delMarker(i) }, h(Icon, { name: 'trash', size: 12 }))))),
        h(Section, { icon: 'gauge', title: 'Constraint regions', count: (doc.ranges || []).length, open: secOpen.cr !== false, onToggle: () => tog('cr') },
          (doc.ranges || []).length === 0 ? h('div', { className: 'featempty' }, 'Press C, then drag the path') :
            doc.ranges.map((rg, i) => { const effective = (derived.effRanges && derived.effRanges[i]) || rg; const summary = constraintRangeSummary(rg, doc.constraints, robot); const rangeLabel = summary ? summary.text : (rg.name || 'Constraint range'); const rangeMeta = rg.anchor === 'dist' ? UnitPrefs.fromCanonical(Math.min(effective.f0, effective.f1) * derived.sample.length, 'm').toFixed(1) + '\u2013' + UnitPrefs.format(Math.max(effective.f0, effective.f1) * derived.sample.length, 'm', 1) : rg.anchor === 'wp' && rg.t0 != null && rg.t1 != null ? 'S' + ((rg.w0 || 0) + 1) + ' ' + Math.round(rg.t0 * 100) + '% \u2013 S' + ((rg.w1 || 0) + 1) + ' ' + Math.round(rg.t1 * 100) + '%' : rg.anchor === 'wp' ? 'Waypoint ' + Math.min(rg.w0 || 0, rg.w1 || 0) + '\u2013' + Math.max(rg.w0 || 0, rg.w1 || 0) : (Math.min(effective.f0, effective.f1) * 100).toFixed(0) + '\u2013' + (Math.max(effective.f0, effective.f1) * 100).toFixed(0) + '%'; return h('div', { key: i, className: 'featrow' + (sel.kind === 'cr' && sel.idx === i ? ' sel' : '') },
              h('button', { className: 'featselect', type: 'button', 'aria-label': 'Constraint range, ' + (summary ? summary.ariaLabel : rangeLabel) + ', ' + rangeMeta, 'aria-pressed': sel.kind === 'cr' && sel.idx === i, onClick: (event) => { if (event.shiftKey) actions.delRange(i); else actions.select('cr', i); }, onDoubleClick: (e) => inspectItem(actions, 'cr', i, e) }, h('span', { className: 'featdot w' }), h('span', { className: 'featnm' }, rangeLabel), h('span', { className: 'featmeta' }, rangeMeta)),
              h('button', { className: 'featdel', 'aria-label': 'Delete constraint range', title: 'Delete', onClick: () => actions.delRange(i) }, h(Icon, { name: 'trash', size: 12 }))); }))));
  }

  function MetricControl({ metric, setMetric, derived }) {
    const M = derived.metrics || {};
    const grad = PM.metricGradient(metric);
    const def = (PM.METRICS || []).find((m) => m.id === metric) || {};
    let lo = '0', hi = '0';
    const displayUnit = def.unit || '';
    if (metric === 'velocity') { lo = '0'; hi = UnitPrefs.fromCanonical(M.vMax || 0, displayUnit).toFixed(1); }
    else if (metric === 'accel') { const a = UnitPrefs.fromCanonical(M.aMax || 0, displayUnit).toFixed(1); lo = '-' + a; hi = '+' + a; }
    else if (metric === 'angvel') { const w = ((M.wMax || 0) * R2D).toFixed(0); lo = '-' + w; hi = '+' + w; }
    else { lo = '0'; hi = UnitPrefs.fromCanonical(M.kMax || 0, displayUnit).toFixed(2); }
    return h('div', { className: 'metricctl' },
      h(Dropdown, { id: 'field-overlay-metric', ariaLabel: 'Field overlay metric', compact: true,
        className: 'metric-dropdown', value: metric,
        items: (PM.METRICS || []).map((m) => ({ value: m.id, label: m.label, meta: UnitPrefs.label(m.unit || '') })),
        onChange: setMetric }),
      h('span', { className: 'metric-swatch', style: { background: grad }, 'aria-hidden': true }),
      h('span', { className: 'metric-range', 'aria-hidden': true }, lo + '\u2013' + hi + ' ' + UnitPrefs.label(displayUnit)));
  }

  function Transport({ derived, doc, metric, setMetric, playTime, playing, togglePlayback, seek, restart, graphOpen, setGraphOpen }) {
    const playback = derived.playback;
    const prof = playback ? playback.prof : derived.prof;
    const pts = playback ? playback.pts : derived.sample.pts;
    const M = playback ? playback.metrics : derived.metrics;
    const anchors = playback ? playback.anchors : derived.anchors;
    const rev = playback ? playback.rev : derived.rev;
    const total = prof.totalTime || 0.001;
    const pct = Math.max(0, Math.min(1, playTime / total));
    const scrubStep = Math.min(0.02, total);
    const graphRef = useRef(null);
    const timeline = useMemo(() => {
      const motionEnd = Math.max(0, Number(prof.t && prof.t[prof.t.length - 1]) || 0);
      const distance = pts.length ? Math.max(0, Number(pts[pts.length - 1].s) || 0) : 0;
      const timeAtFraction = (fraction) => {
        const f = Math.max(0, Math.min(1, Number(fraction) || 0));
        if (pts.length < 2 || !prof.t || prof.t.length < 2 || distance <= 1e-9) return f * motionEnd;
        const target = f * distance;
        if (target <= 0) return 0;
        if (target >= distance) return motionEnd;
        let low = 1, high = pts.length - 1;
        while (low < high) { const middle = (low + high) >> 1; if (pts[middle].s < target) low = middle + 1; else high = middle; }
        const before = pts[low - 1], after = pts[low];
        const part = (target - before.s) / Math.max(1e-9, after.s - before.s);
        return prof.t[low - 1] + (prof.t[low] - prof.t[low - 1]) * part;
      };
      const percentAt = (fraction) => Math.max(0, Math.min(100, timeAtFraction(fraction) / total * 100));
      const markers = ((doc && doc.markers) || []).map((marker, index) => ({
        key: 'event-' + index,
        label: marker.name || 'Event marker ' + (index + 1),
        left: derived.markers && derived.markers[index]
          ? Math.max(0, Math.min(100, derived.markers[index].timeS / total * 100))
          : percentAt(PM.featureFraction(marker, derived.sample)),
      }));
      const targets = ((doc && doc.targets) || []).map((target, index) => ({
        key: 'target-' + index,
        label: 'Rotation target ' + (index + 1) + ', ' + Number(target.deg || 0).toFixed(0) + '°',
        left: percentAt(PM.featureFraction(target, derived.sample)),
      }));
      const ranges = (derived.effRanges || []).map((range, index) => {
        const start = percentAt(range.f0), end = percentAt(range.f1);
        return { key: 'range-' + index, label: range.name || 'Constraint range ' + (index + 1), left: Math.min(start, end), width: Math.abs(end - start) };
      });
      const waypoints = (derived.wpFrac || []).slice(1, -1).map((fraction, index) => ({
        key: 'waypoint-' + index,
        label: PathLinks.waypointName(null, doc, index + 1) + (((doc && doc.waypoints && doc.waypoints[index + 1] || {}).stop) ? ', stop' : ''),
        left: percentAt(fraction),
        stop: !!(doc && doc.waypoints && doc.waypoints[index + 1] && doc.waypoints[index + 1].stop),
      }));
      return { markers, targets, ranges, waypoints };
    }, [derived, doc, prof, pts, total]);
    const featureCount = timeline.markers.length + timeline.targets.length + timeline.ranges.length;
    const featureSummary = [
      timeline.markers.length ? timeline.markers.length + (timeline.markers.length === 1 ? ' event' : ' events') : '',
      timeline.targets.length ? timeline.targets.length + (timeline.targets.length === 1 ? ' target' : ' targets') : '',
      timeline.ranges.length ? timeline.ranges.length + (timeline.ranges.length === 1 ? ' range' : ' ranges') : '',
    ].filter(Boolean).join(', ');
    const timelineTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
      fraction,
      label: (total * fraction).toFixed(total < 10 ? 2 : 1) + 's',
    }));

    const GW = 1000, GH = 132, padL = 0, padR = 0, padT = 10, padB = 20;
    const unitSystem = UnitPrefs.current();
    const graphModel = useMemo(() => {
      const finalSamples = derived.finalTrajectory?.samples || [];
      const authoritative = finalSamples.length >= 2;
      const graphTimes = authoritative ? finalSamples.map((sample) => sample.t) : prof.t;
      let arr = graphOpen
        ? (authoritative
          ? finalSamples.map((sample) => UnitPrefs.fromCanonical(sample.velocityMps, 'm/s'))
          : M.v.map((value) => UnitPrefs.fromCanonical(value, 'm/s')))
        : null;
      let vmin = 0, vmax = UnitPrefs.fromCanonical(M.vMax || 1, 'm/s'), signed = false;
      let unit = UnitPrefs.label('m/s'), title = 'Velocity';
      if (graphOpen && metric === 'accel') { arr = authoritative ? finalSamples.map((sample) => UnitPrefs.fromCanonical(sample.accelerationMps2, 'm/s²')) : M.accel.map((value) => UnitPrefs.fromCanonical(value, 'm/s²')); vmax = UnitPrefs.fromCanonical(M.aMax || 1, 'm/s²'); vmin = -vmax; signed = true; unit = UnitPrefs.label('m/s²'); title = 'Acceleration'; }
      else if (graphOpen && metric === 'angvel') { arr = authoritative ? finalSamples.map((sample) => sample.angularVelocityRadps * R2D) : (M.omega || []).map((o) => o * R2D); vmax = (M.wMax || 0.01) * R2D; vmin = -vmax; signed = true; unit = '\u00b0/s'; title = 'Angular velocity'; }
      else if (graphOpen && metric === 'curvature') { arr = authoritative ? finalSamples.map((sample) => UnitPrefs.fromCanonical(sample.curvatureInvM, '1/m')) : M.curv.map((value) => UnitPrefs.fromCanonical(value, '1/m')); vmin = 0; vmax = UnitPrefs.fromCanonical(M.kMax || 0.01, '1/m'); unit = UnitPrefs.label('1/m'); title = 'Curvature'; }

      const jigglePeak = graphOpen && metric === 'velocity' && prof.jiggles
        ? UnitPrefs.fromCanonical(prof.jiggles.reduce((value, action) => Math.max(value, 4 * action.config.distanceM / action.strokeDuration), 0), 'm/s')
        : 0;
      const seriesPeak = arr ? arr.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0) : 0;
      const peak = Math.max(vmax, jigglePeak, seriesPeak);
      vmax = Math.max(0.01, peak * 1.1);
      if (signed) vmin = -vmax;
      const span = Math.max(1e-6, vmax - vmin);
      const yOf = (value) => padT + (1 - (value - vmin) / span) * (GH - padT - padB);
      const zeroY = yOf(0);
      const valueAtTime = (time) => {
        if (!arr || !arr.length || !graphTimes.length) return 0;
        if (time <= 0) return arr[0] || 0;
        if (time >= graphTimes[graphTimes.length - 1]) return arr[arr.length - 1] || 0;
        let lo = 1, hi = graphTimes.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (graphTimes[mid] < time) lo = mid + 1; else hi = mid; }
        const t0 = graphTimes[lo - 1], t1 = graphTimes[lo], u = t1 - t0 > 1e-6 ? (time - t0) / (t1 - t0) : 0;
        return arr[lo - 1] + (arr[lo] - arr[lo - 1]) * u;
      };
      let poly = '';
      if (graphTimes.length > 1 && arr && arr.length) {
        const N = 170;
        for (let k = 0; k <= N; k++) {
          const time = (k / N) * total;
          const value = valueAtTime(time);
          const x = padL + (k / N) * (GW - padL - padR);
          poly += (k === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + yOf(value).toFixed(1) + ' ';
        }
      }
      const rotationLimiter = metric === 'velocity' && prof.rotLimited && prof.rotLimited.some(Boolean)
        ? 'Angular limits active'
        : null;
      return { baseY: signed ? zeroY : GH - padB, peak, poly, rotationLimiter, signed, title, unit, valueAtTime, yOf, zeroY };
    }, [derived, graphOpen, metric, total, unitSystem]);
    const { baseY, peak, poly, rotationLimiter, signed, title, unit, valueAtTime, yOf, zeroY } = graphModel;
    const playX = padL + pct * (GW - padL - padR);
    const currentValue = valueAtTime(playTime), playY = yOf(currentValue);
    const pointerDrag = PointerDrag.useController();
    const onGraphDown = (e) => {
      const seekTo = (cx) => { const r = graphRef.current.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (cx - r.left) / r.width)); seek(f * total); };
      seekTo(e.clientX);
      const mv = (ev) => seekTo(ev.clientX);
      pointerDrag.start(e, { move: mv });
    };

    return h(React.Fragment, null,
      graphOpen && h('div', { className: 'velgraph open' },
        h('div', { className: 'velgraph-top' },
          h('span', { className: 'velgraph-ttl' }, title + ' profile'),
          rotationLimiter && h('span', { className: 'velgraph-limit', title: 'Rotation timing is limiting speed somewhere on this path. Spread heading changes over more distance or inspect the rotation limits.' }, rotationLimiter),
          h('span', { className: 'velgraph-readout' },
            h('b', null, currentValue.toFixed(metric === 'angvel' ? 0 : metric === 'curvature' ? 2 : 1) + ' ' + unit),
            h('span', null, 'Peak ' + peak.toFixed(metric === 'angvel' ? 0 : metric === 'curvature' ? 2 : 1) + ' ' + unit))),
        h('div', { className: 'velgraph-plot' },
          h('svg', { ref: graphRef, className: 'velgraph-svg', viewBox: `0 0 ${GW} ${GH}`, preserveAspectRatio: 'none', onPointerDown: onGraphDown, tabIndex: graphOpen ? 0 : -1, role: 'slider', 'aria-label': title + ' graph playback position', 'aria-valuemin': 0, 'aria-valuemax': Math.round(total * 1000), 'aria-valuenow': Math.round(playTime * 1000), onKeyDown: (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(Math.max(0, Math.min(total, playTime + (e.key === 'ArrowRight' ? 1 : -1) * Math.max(0.02, total / 100)))); } else if (e.key === 'Home') { e.preventDefault(); seek(0); } else if (e.key === 'End') { e.preventDefault(); seek(total); } } },
            h('defs', null,
              h('linearGradient', { id: 'telemetry-fill', x1: '0', y1: '0', x2: '0', y2: '1' },
                h('stop', { offset: '0%', stopColor: 'var(--accent)', stopOpacity: 0.24 }),
                h('stop', { offset: '100%', stopColor: 'var(--accent)', stopOpacity: 0.02 }))),
            [0.25, 0.5, 0.75].map((g) => h('line', { key: g, x1: padL, x2: GW - padR, y1: padT + g * (GH - padT - padB), y2: padT + g * (GH - padT - padB), stroke: '#ffffff', strokeOpacity: 0.05, strokeWidth: 1 })),
            signed && h('line', { x1: padL, x2: GW - padR, y1: zeroY, y2: zeroY, stroke: '#ffffff', strokeOpacity: 0.16, strokeWidth: 1 }),
            !signed && h('line', { x1: padL, x2: GW - padR, y1: GH - padB, y2: GH - padB, stroke: '#ffffff', strokeOpacity: 0.12, strokeWidth: 1 }),
            poly && h('path', { d: poly + `L ${GW - padR} ${baseY} L ${padL} ${baseY} Z`, fill: 'url(#telemetry-fill)' }),
            poly && h('path', { d: poly, fill: 'none', stroke: 'var(--accent)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }),
            h('line', { x1: playX, x2: playX, y1: padT, y2: GH - padB, stroke: '#fff', strokeOpacity: 0.45, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }),
            h('circle', { cx: playX, cy: playY, r: 4, fill: '#fff', stroke: 'var(--accent)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' })),
          h('div', { className: 'velgraph-time' }, h('span', null, '0s'), h('span', null, (total / 2).toFixed(1) + 's'), h('span', null, total.toFixed(1) + 's')))),
      h('div', { className: 'transport' + (graphOpen ? ' graph-open' : '') },
        h('div', { className: 'timeline-toolbar' },
          h('div', { className: 'transport-controls' },
            h('button', { className: 'tbtn', type: 'button', onClick: restart, title: 'Restart', 'aria-label': 'Restart trajectory playback' }, h(Icon, { name: 'rewind', size: 14 })),
            h('button', { className: 'tbtn play', type: 'button', onClick: togglePlayback, title: 'Play / Pause  (Space)', 'aria-label': playing ? 'Pause trajectory playback' : 'Play trajectory' }, h(Icon, { name: playing ? 'pause' : 'play', size: 15, fill: !playing }))),
          h('span', { className: 'timeline-title' }, 'Timeline'),
          h('div', { className: 'timecode', 'aria-hidden': true },
            h('span', { className: 'timecode-now' }, playTime.toFixed(2)),
            h('span', { className: 'timecode-sep' }, '/'),
            h('span', { className: 'timecode-total' }, total.toFixed(2)),
            h('span', { className: 'timecode-unit' }, 's')),
          featureCount > 0 && h('span', { className: 'timeline-summary', 'aria-hidden': true }, featureSummary),
          h('div', { className: 'transport-meta' },
            h(MetricControl, { metric, setMetric, derived }),
            h('div', { className: 'roi', title: 'Path length' }, h('span', { className: 'roi-v' }, UnitPrefs.fromCanonical(derived.totalDistance || derived.sample.length, 'm').toFixed(2)), h('span', { className: 'roi-u' }, UnitPrefs.label('m'))),
            h(IconBtn, { icon: 'gauge', active: graphOpen, onClick: () => setGraphOpen(!graphOpen), title: 'Telemetry graph' }))),
        h('div', { className: 'timeline-editor' },
          h('div', { className: 'timeline' },
            h('div', { className: 'timeline-ruler', 'aria-hidden': true },
              timelineTicks.map((tick, index) => h('span', { key: tick.fraction, className: 'timeline-tick' + (index === 0 ? ' first' : index === timelineTicks.length - 1 ? ' last' : ''), style: { left: (tick.fraction * 100).toFixed(3) + '%' } },
                h('span', { className: 'timeline-tick-label' }, tick.label)))),
            h('div', { className: 'timeline-lanes' },
              h('span', { className: 'timeline-track', 'aria-hidden': true }),
              timelineTicks.map((tick) => h('span', { key: 'grid-' + tick.fraction, className: 'timeline-gridline', 'aria-hidden': true, style: { left: (tick.fraction * 100).toFixed(3) + '%' } })),
              timeline.ranges.map((range) => h('span', { key: range.key, className: 'timeline-range', title: range.label, 'aria-hidden': true, style: { left: range.left.toFixed(3) + '%', width: range.width.toFixed(3) + '%' } })),
              timeline.waypoints.map((waypoint) => h('span', { key: waypoint.key, className: 'timeline-waypoint' + (waypoint.stop ? ' stop' : ''), title: waypoint.label, 'aria-hidden': true, style: { left: waypoint.left.toFixed(3) + '%' } })),
              timeline.targets.map((target) => h('span', { key: target.key, className: 'timeline-target', title: target.label, 'aria-hidden': true, style: { left: target.left.toFixed(3) + '%' } })),
              timeline.markers.map((marker) => h('span', { key: marker.key, className: 'timeline-event', title: marker.label, 'aria-hidden': true, style: { left: marker.left.toFixed(3) + '%' } })),
              h('span', { className: 'timeline-playhead', 'aria-hidden': true, style: { left: (pct * 100).toFixed(3) + '%' } }),
              h('input', {
                className: 'scrub', type: 'range', 'aria-label': 'Trajectory playback position',
                'aria-describedby': 'trajectory-feature-summary',
                'aria-valuetext': playTime.toFixed(2) + ' seconds of ' + total.toFixed(2) + ' seconds',
                min: 0, max: total, step: scrubStep, value: Math.min(playTime, total),
                onChange: (e) => seek(+e.target.value),
                onKeyDown: (e) => {
                  if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault(); seek(playTime + (e.key === 'ArrowRight' ? 0.1 : -0.1));
                  }
                },
                onPointerUp: (e) => e.currentTarget.blur()
              }),
              h('span', { id: 'trajectory-feature-summary', className: 'sr-only' }, featureSummary || 'No authored timeline features'))))));
  }

  function ViewControls({ zoomPct, zoomBy, onFit, showGrid, setShowGrid, graphOpen }) {
    return h('div', { className: 'viewctl' + (graphOpen ? ' graph-open' : '') },
      h('button', { className: 'vc-btn', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => zoomBy(1.18) }, h(Icon, { name: 'zoomout', size: 16 })),
      h('button', { className: 'vc-pct', type: 'button', title: 'Fit field  (F)', onClick: onFit }, zoomPct + '%'),
      h('button', { className: 'vc-btn', type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => zoomBy(1 / 1.18) }, h(Icon, { name: 'zoomin', size: 16 })),
      h('div', { className: 'vc-div' }),
      h('button', { className: 'vc-btn' + (showGrid ? ' active' : ''), type: 'button', title: 'Toggle field grid  (G)', 'aria-label': 'Toggle field grid', 'aria-pressed': showGrid, onClick: () => setShowGrid(!showGrid) }, h(Icon, { name: 'grid', size: 16 })),
      h('button', { className: 'vc-btn', type: 'button', title: 'Fit field  (F)', 'aria-label': 'Fit field to view', onClick: onFit }, h(Icon, { name: 'fit', size: 16 })));
  }

export const Panels = { Toolbar, ToolRail, ConstraintBar, Outline, Transport, ViewControls };
