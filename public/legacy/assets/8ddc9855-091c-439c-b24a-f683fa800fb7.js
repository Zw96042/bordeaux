// Bordeaux — Robot config page (project-global). Needs React + window.UI. Exports window.RobotPage
(function () {
  const { useRef, useState } = React;
  const h = React.createElement;
  const { Icon } = window.UI;

  const footprintFor = (shape, w, l) => {
    if (shape === 'rectangle') return undefined;
    const verticesM = shape === 'round'
      ? Array.from({ length: 12 }, (_, index) => {
          const angle = index * Math.PI / 6;
          return { x: Math.cos(angle) * l / 2, y: Math.sin(angle) * w / 2 };
        })
      : [{ x: -l / 2, y: -w / 2 }, { x: l / 2, y: -w * 0.32 }, { x: l / 2, y: w * 0.32 }, { x: -l / 2, y: w / 2 }];
    return { kind: 'polygon', verticesM };
  };
  const sameFootprint = (value, expected) => value && expected && value.verticesM.length === expected.verticesM.length
    && value.verticesM.every((point, index) => Math.hypot(point.x - expected.verticesM[index].x, point.y - expected.verticesM[index].y) < 1e-6);
  const footprintShape = (robot) => !robot.footprint ? 'rectangle'
    : sameFootprint(robot.footprint, footprintFor('round', robot.w, robot.l)) ? 'round'
    : sameFootprint(robot.footprint, footprintFor('trapezoid', robot.w, robot.l)) ? 'trapezoid' : 'custom';

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
    const [customEditing, setCustomEditing] = useState(false);
    const shape = customEditing && robot.footprint ? 'custom' : footprintShape(robot);
    const footprint = robot.footprint && robot.footprint.kind === 'polygon' && Array.isArray(robot.footprint.verticesM)
      ? robot.footprint.verticesM
      : [{ x: -robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: robot.w / 2 }, { x: -robot.l / 2, y: robot.w / 2 }];
    const maxDim = Math.max(robot.w, robot.l, 0.4, ...footprint.flatMap((point) => [Math.abs(point.x) * 2, Math.abs(point.y) * 2]));
    const unit = 220 / maxDim;
    const rw = robot.l * unit, rh = robot.w * unit;
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
    const setPlanning = (patch) => setRobot({ planning: { ...planning, ...patch } });
    const setIntake = (patch) => setPlanning({ intake: { ...intake, ...patch } });
    const setShooter = (patch) => setPlanning({ shooter: { ...shooter, ...patch } });
    const resize = (key, value) => {
      const nextW = key === 'w' ? value : robot.w, nextL = key === 'l' ? value : robot.l;
      const footprint = shape === 'custom' ? {
        kind: 'polygon', verticesM: robot.footprint.verticesM.map((point) => ({
          x: point.x * nextL / robot.l, y: point.y * nextW / robot.w,
        })),
      } : footprintFor(shape, nextW, nextL);
      setRobot({ [key]: value, footprint });
    };
    const setVertices = (verticesM) => setRobot({ footprint: { kind: 'polygon', verticesM } });
    const updateVertex = (index, key, value) => setVertices(footprint.map((point, pointIndex) => (
      pointIndex === index ? { ...point, [key]: value } : point
    )));
    const addVertex = () => {
      if (footprint.length >= 16) return;
      let edge = 0, longest = -1;
      footprint.forEach((point, index) => {
        const next = footprint[(index + 1) % footprint.length];
        const length = Math.hypot(next.x - point.x, next.y - point.y);
        if (length > longest) { longest = length; edge = index; }
      });
      const next = footprint[(edge + 1) % footprint.length];
      const vertices = footprint.map((point) => ({ ...point }));
      vertices.splice(edge + 1, 0, { x: (footprint[edge].x + next.x) / 2, y: (footprint[edge].y + next.y) / 2 });
      setVertices(vertices);
    };

    return h('div', { className: 'robotpage' },
      h('div', { className: 'rp-wrap' },
        h('div', { className: 'rp-title' }, 'Robot'),
        h('div', { className: 'rp-sub' }, 'One robot for the whole project \u2014 every path plans around these. Set it once here and the field preview, velocity caps, and footprint update everywhere.'),
        h('div', { className: 'rp-grid' },
          // ---- left column: controls ----
          h('div', { className: 'rp-col' },
            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Drivetrain'),
              h('div', { className: 'rp-drive' },
                h('button', { className: 'rp-drivebtn' + (isSwerve ? ' on' : ''), type: 'button', 'aria-pressed': isSwerve, onClick: () => setRobot({ drive: 'swerve' }) },
                  h('span', { className: 'dbi' }, h(Icon, { name: 'swerve', size: 22 })),
                  h('div', { className: 'dbt' }, 'Swerve'),
                  h('div', { className: 'dbd' }, 'Holonomic \u2014 heading is independent of travel. Uses per-waypoint \u03b8.')),
                h('button', { className: 'rp-drivebtn' + (!isSwerve ? ' on' : ''), type: 'button', 'aria-pressed': !isSwerve, onClick: () => setRobot({ drive: 'tank' }) },
                  h('span', { className: 'dbi' }, h(Icon, { name: 'tank', size: 22 })),
                  h('div', { className: 'dbt' }, 'Tank'),
                  h('div', { className: 'dbd' }, 'Differential \u2014 heading follows the path tangent. \u03b8 is automatic.')))),

            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Drive dimensions'),
              h('div', { className: 'rp-two' },
                h('div', { className: 'rp-field' },
                  h('div', { className: 'rp-flabel' }, 'Width', h('small', null, m2ft(robot.w).toFixed(2) + ' ft')),
                  h(BigNum, { label: 'Robot width', value: robot.w, unit: 'm', min: 0.3, max: 1.3, onChange: (v) => resize('w', v) })),
                h('div', { className: 'rp-field' },
                  h('div', { className: 'rp-flabel' }, 'Length', h('small', null, m2ft(robot.l).toFixed(2) + ' ft')),
                  h(BigNum, { label: 'Robot length', value: robot.l, unit: 'm', min: 0.3, max: 1.3, onChange: (v) => resize('l', v) }))),
              h('div', { className: 'rp-field' },
                h('div', { className: 'rp-flabel' }, 'Bumper shape'),
                h('div', { className: 'rp-shapes', role: 'group', 'aria-label': 'Robot bumper shape' },
                  [['rectangle', 'Rectangle'], ['round', 'Round'], ['trapezoid', 'Trapezoid'], ['custom', 'Custom']].map(([id, label]) => h('button', {
                    key: id, type: 'button', className: shape === id ? 'on' : '', 'aria-pressed': shape === id,
                    onClick: () => { setCustomEditing(id === 'custom'); setRobot({ footprint: id === 'custom' ? { kind: 'polygon', verticesM: footprint.map((point) => ({ ...point })) } : footprintFor(id, robot.w, robot.l) }); },
                  }, label))),
                shape === 'custom' && h('div', { className: 'rp-vertices' },
                  h('div', { className: 'rp-vertexhead' }, h('span', null, 'Custom convex vertices'), h('span', null, '+X forward · +Y left')),
                  footprint.map((point, index) => h('div', { className: 'rp-vertex', key: index },
                    h('span', null, index + 1),
                    h('label', null, 'X', h('input', { type: 'number', step: 0.01, value: point.x, 'aria-label': `Vertex ${index + 1} X`, onChange: (event) => updateVertex(index, 'x', Number(event.target.value)) })),
                    h('label', null, 'Y', h('input', { type: 'number', step: 0.01, value: point.y, 'aria-label': `Vertex ${index + 1} Y`, onChange: (event) => updateVertex(index, 'y', Number(event.target.value)) })),
                    h('button', { type: 'button', disabled: footprint.length <= 3, 'aria-label': `Remove vertex ${index + 1}`, onClick: () => setVertices(footprint.filter((_, pointIndex) => pointIndex !== index)) }, '\u00d7'))),
                  h('button', { className: 'rp-addvertex', type: 'button', disabled: footprint.length >= 16, onClick: addVertex }, 'Add vertex'),
                  h('div', { className: 'rp-note' }, 'Keep 3–16 ordered points convex and inside the width and length envelope.'))),
              h('div', { className: 'rp-field' },
                h('div', { className: 'rp-flabel' }, 'Height', h('small', null, typeof robot.heightM === 'number' ? m2ft(robot.heightM).toFixed(2) + ' ft' : 'required for TRENCH checks')),
                h(BigNum, { label: 'Robot height', value: robot.heightM, unit: 'm', min: 0.1, max: 2.5, onChange: (v) => setRobot({ heightM: v }) })),
              h('div', { className: 'rp-note' }, h(Icon, { name: 'info', size: 14 }), 'Bumper-to-bumper footprint. This is what gets drawn on the field and animated along the path.')),

            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Performance'),
              h('div', { className: 'rp-field' },
                h('div', { className: 'rp-flabel' }, 'Max robot speed', h('small', null, m2ft(robot.maxSpeed).toFixed(1) + ' ft/s')),
                h(BigNum, { label: 'Maximum robot speed', value: robot.maxSpeed, unit: 'm/s', min: 0.5, max: 8, precision: 1, step: 0.1, onChange: (v) => setRobot({ maxSpeed: v }) })),
              h('div', { className: 'rp-note' }, h(Icon, { name: 'info', size: 14 }), 'The hard ceiling. A path\u2019s own max velocity is clamped to this, so you can\u2019t accidentally plan faster than the robot can drive.'))),

            mcpEnabled && h('div', { className: 'rp-sec rp-agent' },
              h('div', { className: 'rp-sech' }, 'Agent planning profile'),
              h('div', { className: 'rp-note rp-agent-note' }, h(Icon, { name: 'info', size: 14 }), 'Used by MCP agents to plan physical heading, FUEL collection, and shooting poses. Agent changes still require your approval.'),
              agentProposal && h('div', { className: 'rp-proposal', role: 'region', 'aria-label': 'Agent robot profile proposal' },
                h('b', null, 'Agent robot profile proposal'),
                h('span', null, agentProposal.intent),
                agentProposal.summary && agentProposal.summary.map((line, index) => h('span', { key: index }, line)),
                h('span', { className: 'agent-proposal-status' }, agentProposal.status === 'ready' ? 'Preview only — the robot profile has not changed.' : agentProposal.status === 'stale' ? 'Stale — ask the agent to regenerate.' : agentProposal.status === 'applied' ? 'Applied as one undoable project change.' : 'Rejected.'),
                agentProposal.status === 'ready' && h('div', { className: 'rp-proposal-actions' },
                  h('button', { type: 'button', onClick: onRejectProposal }, 'Reject'),
                  h('button', { className: 'primary', type: 'button', onClick: onApplyProposal }, 'Apply robot info'))),
              intake
                ? h(React.Fragment, null,
                    h('div', { className: 'rp-field' },
                      h('div', { className: 'rp-flabel' }, 'Primary intake'),
                      h('input', { className: 'rp-text', value: intake.name || '', 'aria-label': 'Primary intake name', maxLength: 80, onChange: (e) => setIntake({ name: e.target.value }) })),
                    h('div', { className: 'rp-two' },
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Local X', h('small', null, '+ forward')), h(BigNum, { label: 'Intake local X', value: intake.centerM && intake.centerM.x, unit: 'm', min: -2, max: 2, onChange: (v) => setIntake({ centerM: { ...(intake.centerM || { x: 0, y: 0 }), x: v } }) })),
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Local Y', h('small', null, '+ left')), h(BigNum, { label: 'Intake local Y', value: intake.centerM && intake.centerM.y, unit: 'm', min: -2, max: 2, onChange: (v) => setIntake({ centerM: { ...(intake.centerM || { x: 0, y: 0 }), y: v } }) }))),
                    h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Collection direction', h('small', null, '0° = front')), h(BigNum, { label: 'Intake collection direction', value: intake.directionDeg, unit: '°', min: -180, max: 180, precision: 0, step: 1, onChange: (v) => setIntake({ directionDeg: v }) })),
                    h('div', { className: 'rp-two' },
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Capture width'), h(BigNum, { label: 'Intake capture width', value: intake.captureWidthM, unit: 'm', min: 0.05, max: 3, onChange: (v) => setIntake({ captureWidthM: v }) })),
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Collect speed'), h(BigNum, { label: 'Maximum collection speed', value: intake.maxCollectSpeedMps, unit: 'm/s', min: 0.1, max: robot.maxSpeed, precision: 1, step: 0.1, onChange: (v) => setIntake({ maxCollectSpeedMps: v }) }))),
                    h('button', { className: 'rp-add-profile', type: 'button', onClick: () => setPlanning({ intake: undefined }) }, 'Remove intake details'))
                  : h('button', { className: 'rp-add-profile', type: 'button', onClick: () => setPlanning({ intake: { name: 'Front intake', centerM: { x: robot.l / 2, y: 0 }, directionDeg: 0, captureWidthM: Math.min(robot.w, 0.7), maxCollectSpeedMps: Math.min(robot.maxSpeed, 2) } }) }, 'Add intake details'),
              shooter
                ? h(React.Fragment, null,
                    h('div', { className: 'rp-two' },
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Shooter direction'), h(BigNum, { label: 'Shooter direction', value: shooter.directionDeg, unit: '°', min: -180, max: 180, precision: 0, step: 1, onChange: (v) => setShooter({ directionDeg: v }) })),
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Preferred range'), h(BigNum, { label: 'Preferred shooting range', value: shooter.preferredRangeM, unit: 'm', min: 0.1, max: 20, onChange: (v) => setShooter({ preferredRangeM: v }) }))),
                    h('label', { className: 'rp-check' }, h('input', { type: 'checkbox', checked: shooter.requiresTargetFacing === true, onChange: (e) => setShooter({ requiresTargetFacing: e.target.checked }) }), 'Shooter direction must face the target'),
                    typeof shooter.preferredRangeM === 'number' && h('button', { className: 'rp-add-profile', type: 'button', onClick: () => setPlanning({ shooter: { ...shooter, preferredRangeM: undefined } }) }, 'Clear preferred range'),
                    h('button', { className: 'rp-add-profile', type: 'button', onClick: () => setPlanning({ shooter: undefined }) }, 'Remove shooter details'))
                : h('button', { className: 'rp-add-profile', type: 'button', onClick: () => setPlanning({ shooter: { directionDeg: 0, requiresTargetFacing: true } }) }, 'Add shooter details'),
              h('div', { className: 'rp-field' },
                h('div', { className: 'rp-flabel' }, 'Planning notes'),
                h('textarea', { className: 'rp-notes', value: planning.notes || '', maxLength: 4000, 'aria-label': 'Robot planning notes', placeholder: 'Mechanism timing, preferred lanes, stability limits…', onChange: (e) => setPlanning({ notes: e.target.value }) }))),

          // ---- right column: live preview ----
          h('div', { className: 'rp-col' },
            h('div', { className: 'rp-preview' },
              h('div', { className: 'rp-stage' },
                h('svg', { width: 260, height: 260, viewBox: '0 0 260 260' },
                  h('g', { transform: 'translate(130 130)' },
                    h('polygon', { points: footprintPoints, fill: 'var(--accent-soft)', stroke: 'var(--accent)', strokeWidth: 2.5, strokeLinejoin: 'round' }),
                    // forward indicator (front = +X)
                    h('line', { x1: 0, y1: 0, x2: rw / 2 + 4, y2: 0, stroke: '#fff', strokeWidth: 2.5 }),
                    h('path', { d: `M ${rw / 2 + 2} -6 L ${rw / 2 + 14} 0 L ${rw / 2 + 2} 6 Z`, fill: '#fff' }),
                    // width / length ticks
                    h('text', { x: 0, y: -rh / 2 - 10, fill: 'var(--txt-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', textAnchor: 'middle' }, robot.w.toFixed(2) + ' m'),
                    h('text', { x: rw / 2 + 26, y: 4, fill: 'var(--txt-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', transform: `rotate(90 ${rw / 2 + 26} 0)`, textAnchor: 'middle' }, robot.l.toFixed(2) + ' m')))),
              h('div', { className: 'rp-readout' },
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, isSwerve ? 'Swerve' : 'Tank'), h('div', { className: 'rru' }, 'drive')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, footprintArea.toFixed(2)), h('div', { className: 'rru' }, 'm\u00b2 footprint')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, typeof robot.heightM === 'number' ? robot.heightM.toFixed(2) : '—'), h('div', { className: 'rru' }, 'm high')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, robot.maxSpeed.toFixed(1)), h('div', { className: 'rru' }, 'm/s top'))))))));
  }

  window.RobotPage = RobotPage;
})();
