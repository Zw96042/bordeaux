// Bordeaux — shared UI primitives. Exports window.UI
(function () {
  const { useState, useRef, useEffect, useId } = React;
  const h = React.createElement;

  const PATHS = {
    select: 'M5 3l6 14 2-6 6-2z',
    waypoint: 'M12 4v4M12 16v4M4 12h4M16 12h4',
    rotation: 'M5 12a7 7 0 1 1 2.5 5.3 M5 17v-4h4',
    marker: 'M6 4v16 M6 4h11l-2.5 4L17 12H6',
    play: 'M7 4l13 8-13 8z',
    pause: 'M8 5v14M16 5v14',
    rewind: 'M7 5v14 M19 5l-9 7 9 7z',
    grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    flip: 'M4 8h16l-3-3 M20 16H4l3 3',
    undo: 'M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-1',
    redo: 'M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h1',
    trash: 'M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13',
    plus: 'M12 5v14M5 12h14',
    chevron: 'M8 10l4 4 4-4',
    gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v9H5z',
    route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M9 16h6a3 3 0 0 0 3-3',
    flag2: 'M5 21V4 M5 4h13l-3 5 3 5H5',
    target: 'M12 3v3M12 18v3M3 12h3M18 12h3 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    gauge: 'M4 18a8 8 0 1 1 16 0 M12 14l4-4',
    start: 'M5 4v16 M5 5h10l-2 3 2 3H5',
    share: 'M12 15V4 M8 8l4-4 4 4 M5 14v5h14v-5',
    zoomin: 'M11 7v8M7 11h8 M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5',
    zoomout: 'M7 11h8 M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5',
    fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    copy: 'M9 9h10v10H9z M5 15H4V4h11v1',
    edit: 'M4 20h4l11-11-4-4L4 16v4z M13.5 6.5l4 4',
    folder: 'M3 6h7l2 2h9v11H3z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M18.5 10a7 7 0 0 0-12-3L4 10 M5.5 14a7 7 0 0 0 12 3l2.5-3',
    zones: 'M4 12h16 M4 7h16 M4 17h16',
    car: 'M5 6h14v12H5z M9 6V4h6v2',
    info: 'M12 8h.01 M11 12h1v5h1 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    swerve: 'M12 3v18 M3 12h18 M12 12a4 4 0 1 0 0-.01 M12 5l2 2-2 2-2-2z',
    tank: 'M6 8h12v8H6z M4 8v8 M20 8v8 M9 8V6h6v2',
    stop: 'M8 8h8v8H8z',
    palette: 'M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H17a4 4 0 0 0 4-4 9 9 0 0 0-9-7.6z M7.5 12.5h.01 M9.5 8.5h.01 M14.5 8.5h.01',
    x: 'M6 6l12 12M18 6L6 18',
    compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15.5 8.5l-2 5-5 2 2-5z',
    drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    shuffle: 'M4 5h4l9 14h3 M17 5h3 M4 19h4l3-4.5 M15.5 7.5L20 5l-2 4 M18 22l2-3-3-1',
    branch: 'M6 4v6a4 4 0 0 0 4 4h4 M18 4v6a4 4 0 0 1-4 4 M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    dot: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    check: 'M5 13l4 4L19 7',
    bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
    layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
    pin: 'M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z M12 9a2 2 0 1 0 0 0z',
    ruler: 'M4 14L14 4l6 6L10 20z M8 10l2 2M11 7l2 2M14 10l2 2',
    sliders: 'M4 6h5M15 6h5M9 3v6M4 12h9M19 12h1M13 9v6M4 18h3M13 18h7M7 15v6',
  };

  function Icon({ name, size = 18, fill = false, stroke = 'currentColor', sw = 1.7 }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, fill: fill ? 'currentColor' : 'none', stroke: fill ? 'none' : stroke, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: PATHS[name] || '' }));
  }

  function IconBtn({ icon, active, onClick, title, danger, size = 18, fill }) {
    return h('button', { className: 'iconbtn' + (active ? ' active' : '') + (danger ? ' danger' : ''), onClick, title, 'aria-label': title, 'aria-pressed': active == null ? undefined : active, type: 'button' }, h(Icon, { name: icon, size, fill }));
  }

  // numeric field with drag-to-scrub
  function Num({ label, value, onChange, unit, step = 0.01, min, max, precision = 2, accentDrag }) {
    const id = useId();
    const [edit, setEdit] = useState(null);
    const ref = useRef(null);
    const start = () => (down) => {
      down.preventDefault();
      const sx = down.clientX, v0 = (typeof value === 'number' ? value : 0);
      const sens = step * 8;
      const mv = (e) => { let nv = v0 + (e.clientX - sx) * sens; if (min != null) nv = Math.max(min, nv); if (max != null) nv = Math.min(max, nv); onChange(Math.round(nv / step) * step); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); document.body.style.cursor = 'ew-resize';
    };
    const disp = edit != null ? edit : (typeof value === 'number' ? value.toFixed(precision) : value);
    return h('div', { className: 'numrow' },
      label != null && h('label', { className: 'numlbl', htmlFor: id, onPointerDown: start() }, label),
      h('div', { className: 'numbox' },
        h('input', {
          id, ref, className: 'numinput', value: disp, inputMode: 'decimal', 'aria-describedby': unit ? id + '-unit' : undefined,
          onChange: (e) => setEdit(e.target.value),
          onFocus: (e) => { setEdit(typeof value === 'number' ? String(value) : value); requestAnimationFrame(() => e.target.select()); },
          onBlur: (e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); setEdit(null); },
          onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEdit(null); e.target.blur(); } },
        }),
        unit && h('span', { id: id + '-unit', className: 'numunit' }, unit)),
    );
  }

  function Section({ icon, title, count, right, children, open, onToggle, sub }) {
    return h('div', { className: 'section' + (open ? ' open' : '') },
      h('div', { className: 'sechead' },
        h('button', { className: 'sechead-toggle', type: 'button', onClick: onToggle, 'aria-expanded': open },
          h('span', { className: 'secchev' }, h(Icon, { name: 'chevron', size: 15 })),
          icon && h('span', { className: 'secicon' }, h(Icon, { name: icon, size: 16 })),
          h('span', { className: 'sectitle' }, title),
          sub && h('span', { className: 'secsub' }, sub),
          count != null && h('span', { className: 'seccount' }, count)),
        right),
      open && h('div', { className: 'secbody' }, children));
  }

  function Toggle({ on, onChange, label, ariaLabel }) {
    return h('button', { className: 'toggle' + (on ? ' on' : ''), onClick: () => onChange(!on), type: 'button', 'aria-label': ariaLabel || label || 'Toggle setting', 'aria-pressed': on },
      h('span', { className: 'toggle-track' }, h('span', { className: 'toggle-thumb' })),
      label && h('span', { className: 'toggle-lbl' }, label));
  }

  function Seg({ value, options, onChange, ariaLabel, className }) {
    const count = Math.max(1, options.length);
    const activeIndex = Math.max(0, options.findIndex((option) => option.v === value));
    const style = {
      '--seg-count': count,
      '--seg-clip-left': (activeIndex / count * 100) + '%',
      '--seg-clip-right': ((count - activeIndex - 1) / count * 100) + '%',
    };
    return h('div', { className: 'seg' + (className ? ' ' + className : ''), role: 'group', 'aria-label': ariaLabel, style },
      h('span', { className: 'seg-indicator', 'aria-hidden': true }),
      options.map(o => h('button', { key: o.v, type: 'button', className: 'seg-i' + (value === o.v ? ' on' : ''), title: o.title, 'aria-label': o.ariaLabel, 'aria-pressed': value === o.v, onClick: () => onChange(o.v) }, o.label)));
  }

  function constraintRangeSummary(range, constraints, robot) {
    const c = constraints || {};
    const velocityBase = Math.min(c.maxVel || Infinity, robot && robot.maxSpeed > 0 ? robot.maxSpeed : Infinity);
    const candidates = [
      { key: 'maxVel', base: velocityBase, order: 0, text: (v) => 'v \u2264 ' + v.toFixed(1) + ' m/s', aria: (v) => 'maximum velocity ' + v.toFixed(1) + ' meters per second' },
      { key: 'maxAccel', base: c.maxAccel, order: 1, text: (v) => 'a \u2264 ' + v.toFixed(1) + ' m/s\u00b2', aria: (v) => 'maximum acceleration ' + v.toFixed(1) + ' meters per second squared' },
      { key: 'maxDecel', base: c.maxDecel != null ? c.maxDecel : c.maxAccel, order: 2, text: (v) => 'decel \u2264 ' + v.toFixed(1) + ' m/s\u00b2', aria: (v) => 'maximum deceleration ' + v.toFixed(1) + ' meters per second squared' },
      { key: 'maxAngVel', base: c.maxAngVel, order: 3, text: (v) => '\u03c9 \u2264 ' + v.toFixed(0) + '\u00b0/s', aria: (v) => 'maximum angular velocity ' + v.toFixed(0) + ' degrees per second' },
      { key: 'maxAngAccel', base: c.maxAngAccel, order: 4, text: (v) => '\u03b1 \u2264 ' + v.toFixed(0) + '\u00b0/s\u00b2', aria: (v) => 'maximum angular acceleration ' + v.toFixed(0) + ' degrees per second squared' },
    ].filter((candidate) => {
      const value = range && range[candidate.key], baseline = candidate.base;
      return Number.isFinite(value) && value > 0 && Number.isFinite(baseline) && baseline > 0 && value < baseline - Math.max(1e-6, Math.abs(baseline) * 1e-6);
    }).map((candidate) => ({ ...candidate, value: range[candidate.key], ratio: range[candidate.key] / candidate.base }));
    candidates.sort((a, b) => a.ratio - b.ratio || a.order - b.order);
    const chosen = candidates[0];
    return chosen ? { text: chosen.text(chosen.value), ariaLabel: chosen.aria(chosen.value), key: chosen.key } : null;
  }

  // floating context menu — items: [{label,icon,onClick,danger,sep}]
  function ContextMenu({ x, y, items, onClose }) {
    const ref = useRef(null);
    const [pos, setPos] = useState({ x, y });
    useEffect(() => {
      const el = ref.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = Math.min(x, window.innerWidth - r.width - 8);
      const ny = Math.min(y, window.innerHeight - r.height - 8);
      setPos({ x: nx, y: ny });
    }, [x, y]);
    useEffect(() => {
      const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
      const esc = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', esc);
      return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc); };
    }, [onClose]);
    return h('div', { ref, className: 'ctxmenu', style: { left: pos.x + 'px', top: pos.y + 'px' } },
      items.map((it, i) => it.sep
        ? h('div', { key: 'sep' + i, className: 'ctxmenu-sep' })
        : h('button', { key: i, type: 'button', className: 'ctxmenu-i' + (it.danger ? ' danger' : ''), onClick: () => { onClose(); it.onClick(); } },
            it.icon && h('span', { className: 'ctxmenu-ic' }, h(Icon, { name: it.icon, size: 14 })),
            h('span', null, it.label),
            it.hint && h('span', { className: 'ctxmenu-k' }, it.hint))));
  }

  window.UI = { Icon, IconBtn, Num, Section, Toggle, Seg, ContextMenu, constraintRangeSummary };
})();
