// Bordeaux — Robot config page (project-global). Needs React + window.UI. Exports window.RobotPage
(function () {
  const { useRef } = React;
  const h = React.createElement;
  const { Icon } = window.UI;

  // big numeric field with drag-to-scrub on the label
  function BigNum({ label, value, onChange, unit, step = 0.01, min, max, precision = 2 }) {
    const start = (down) => {
      down.preventDefault();
      const sx = down.clientX, v0 = (typeof value === 'number' ? value : 0);
      const sens = step * 8;
      const mv = (e) => { let nv = v0 + (e.clientX - sx) * sens; if (min != null) nv = Math.max(min, nv); if (max != null) nv = Math.min(max, nv); onChange(Math.round(nv / step) * step); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); document.body.style.cursor = 'ew-resize';
    };
    return h('div', { className: 'rp-big', onPointerDown: (e) => { if (e.target.tagName !== 'INPUT') start(e); } },
      h('input', {
        value: typeof value === 'number' ? value.toFixed(precision) : '', inputMode: 'decimal', 'aria-label': label,
        onChange: (e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); },
        onFocus: (e) => requestAnimationFrame(() => e.target.select()),
      }),
      unit && h('span', { className: 'u' }, unit));
  }

  function RobotPage({ robot, setRobot, mcpEnabled, agentProposal, onApplyProposal, onRejectProposal }) {
    const isSwerve = robot.drive === 'swerve';
    // preview scale: fit the larger dimension to ~62% of the 1x1 stage
    const maxDim = Math.max(robot.w, robot.l, 0.4);
    const unit = 220 / maxDim; // px per meter inside the 260px stage region
    const rw = robot.l * unit, rh = robot.w * unit;
    const footprint = robot.footprint && robot.footprint.kind === 'polygon' && Array.isArray(robot.footprint.verticesM)
      ? robot.footprint.verticesM
      : [{ x: -robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: robot.w / 2 }, { x: -robot.l / 2, y: robot.w / 2 }];
    const footprintPoints = footprint.map((point) => `${point.x * unit},${-point.y * unit}`).join(' ');
    const footprintArea = Math.abs(footprint.reduce((area, point, index) => {
      const next = footprint[(index + 1) % footprint.length];
      return area + point.x * next.y - point.y * next.x;
    }, 0)) / 2;

    // ft helpers (FRC teams often think in ft)
    const m2ft = (m) => m * 3.28084;
    const planning = robot.planning || {};
    const intake = planning.intake;
    const shooter = planning.shooter;
                h('button', { className: 'rp-drivebtn' + (isSwerve ? ' on' : ''), type: 'button', onClick: () => setRobot({ drive: 'swerve' }) },
                  h('span', { className: 'dbi' }, h(Icon, { name: 'swerve', size: 22 })),
                  h('div', { className: 'dbt' }, 'Swerve'),
                  h('div', { className: 'dbd' }, 'Holonomic \u2014 heading is independent of travel. Uses per-waypoint \u03b8.')),
                h('button', { className: 'rp-drivebtn' + (!isSwerve ? ' on' : ''), type: 'button', onClick: () => setRobot({ drive: 'tank' }) },
                  h('span', { className: 'dbi' }, h(Icon, { name: 'tank', size: 22 })),
                  h('div', { className: 'dbt' }, 'Tank'),
                  h('div', { className: 'dbd' }, 'Differential \u2014 heading follows the path tangent. \u03b8 is automatic.')))),

            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Drive dimensions'),
              h('div', { className: 'rp-two' },
                h('div', { className: 'rp-field' },
                  h('div', { className: 'rp-flabel' }, 'Width', h('small', null, m2ft(robot.w).toFixed(2) + ' ft')),
                  h(BigNum, { value: robot.w, unit: 'm', min: 0.3, max: 1.3, onChange: (v) => setRobot({ w: v }) })),
                h('div', { className: 'rp-field' },
                  h('div', { className: 'rp-flabel' }, 'Length', h('small', null, m2ft(robot.l).toFixed(2) + ' ft')),
                  h(BigNum, { value: robot.l, unit: 'm', min: 0.3, max: 1.3, onChange: (v) => setRobot({ l: v }) }))),
              h('div', { className: 'rp-note' }, h(Icon, { name: 'info', size: 14 }), 'Bumper-to-bumper footprint. This is what gets drawn on the field and animated along the path.')),

            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Performance'),
              h('div', { className: 'rp-field' },
                h('div', { className: 'rp-flabel' }, 'Max robot speed', h('small', null, m2ft(robot.maxSpeed).toFixed(1) + ' ft/s')),
                h(BigNum, { value: robot.maxSpeed, unit: 'm/s', min: 0.5, max: 8, precision: 1, step: 0.1, onChange: (v) => setRobot({ maxSpeed: v }) })),
              h('div', { className: 'rp-note' }, h(Icon, { name: 'info', size: 14 }), 'The hard ceiling. A path\u2019s own max velocity is clamped to this, so you can\u2019t accidentally plan faster than the robot can drive.'))),

          // ---- right column: live preview ----
          h('div', { className: 'rp-col' },
            h('div', { className: 'rp-preview' },
              h('div', { className: 'rp-stage' },
                h('svg', { width: 260, height: 260, viewBox: '0 0 260 260' },
                  h('g', { transform: 'translate(130 130)' },
                    h('rect', { x: -rw / 2, y: -rl / 2, width: rw, height: rl, rx: 8, fill: 'var(--accent-soft)', stroke: 'var(--accent)', strokeWidth: 2.5 }),
                    h('rect', { x: -rw / 2 + 7, y: -rl / 2 + 7, width: Math.max(0, rw - 14), height: Math.max(0, rl - 14), rx: 4, fill: 'none', stroke: 'var(--accent)', strokeOpacity: 0.3, strokeWidth: 1.5, strokeDasharray: '4 4' }),
                    // forward indicator (front = +X)
                    h('line', { x1: 0, y1: 0, x2: rw / 2 + 4, y2: 0, stroke: '#fff', strokeWidth: 2.5 }),
                    h('path', { d: `M ${rw / 2 + 2} -6 L ${rw / 2 + 14} 0 L ${rw / 2 + 2} 6 Z`, fill: '#fff' }),
                    // width / length ticks
                    h('text', { x: 0, y: -rl / 2 - 10, fill: 'var(--txt-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', textAnchor: 'middle' }, robot.w.toFixed(2) + ' m'),
                    h('text', { x: rw / 2 + 26, y: 4, fill: 'var(--txt-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', transform: `rotate(90 ${rw / 2 + 26} 0)`, textAnchor: 'middle' }, robot.l.toFixed(2) + ' m')))),
              h('div', { className: 'rp-readout' },
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, isSwerve ? 'Swerve' : 'Tank'), h('div', { className: 'rru' }, 'drive')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, (robot.w * robot.l).toFixed(2)), h('div', { className: 'rru' }, 'm\u00b2 footprint')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, robot.maxSpeed.toFixed(1)), h('div', { className: 'rru' }, 'm/s top'))))))));
  }

  window.RobotPage = RobotPage;
})();
