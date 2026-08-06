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
    const setPlanning = (patch) => setRobot({ planning: { ...planning, ...patch } });
    const setIntake = (patch) => setPlanning({ intake: { ...intake, ...patch } });
    const setShooter = (patch) => setPlanning({ shooter: { ...shooter, ...patch } });

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
                  h(BigNum, { label: 'Robot width', value: robot.w, unit: 'm', min: 0.3, max: 1.3, onChange: (v) => setRobot({ w: v }) })),
                h('div', { className: 'rp-field' },
                  h('div', { className: 'rp-flabel' }, 'Length', h('small', null, m2ft(robot.l).toFixed(2) + ' ft')),
                  h(BigNum, { label: 'Robot length', value: robot.l, unit: 'm', min: 0.3, max: 1.3, onChange: (v) => setRobot({ l: v }) }))),
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
