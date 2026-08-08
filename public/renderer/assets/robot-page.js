// Bordeaux — Robot config page (project-global). Needs React + window.UI. Exports window.RobotPage
(function () {
  const { useRef, useState } = React;
  const h = React.createElement;
  const { Dropdown, Icon } = window.UI;

  // Published 12 V free speeds from the manufacturers' product documentation.
  const DRIVE_MOTORS = [
    { value: 'custom', label: 'Custom motor', meta: 'Enter its published free speed' },
    { value: 'rev-neo', label: 'REV NEO V1.1', meta: '5,676 RPM', rpm: 5676 },
    { value: 'rev-vortex', label: 'REV NEO Vortex', meta: '6,784 RPM', rpm: 6784 },
    { value: 'ctre-kraken-x60', label: 'CTRE Kraken X60', meta: '6,000 RPM', rpm: 6000 },
    { value: 'ctre-falcon-500', label: 'CTRE Falcon 500', meta: '6,380 RPM', rpm: 6380 },
  ];

  const footprintFor = (shape, w, l, preset) => {
    if (shape === 'rectangle') return undefined;
    const vertexCount = preset && preset.vertices || 12;
    const verticesM = shape === 'round'
      ? Array.from({ length: vertexCount }, (_, index) => {
          const angle = index * Math.PI * 2 / vertexCount;
          return { x: Math.cos(angle) * l / 2, y: Math.sin(angle) * w / 2 };
        })
      : (() => {
          const front = Math.min(w, preset && preset.frontWidthM || w * 0.64) / 2;
          const rear = Math.min(w, preset && preset.rearWidthM || w) / 2;
          return [{ x: -l / 2, y: -rear }, { x: l / 2, y: -front }, { x: l / 2, y: front }, { x: -l / 2, y: rear }];
        })();
    return { kind: 'polygon', verticesM };
  };
  const sameFootprint = (value, expected) => value && expected && value.verticesM.length === expected.verticesM.length
    && value.verticesM.every((point, index) => Math.hypot(point.x - expected.verticesM[index].x, point.y - expected.verticesM[index].y) < 1e-6);
  const footprintShape = (robot) => {
    if (!robot.footprint) return 'rectangle';
    if (robot.footprintPreset) return robot.footprintPreset.kind;
    if (sameFootprint(robot.footprint, footprintFor('round', robot.w, robot.l))) return 'round';
    return sameFootprint(robot.footprint, footprintFor('trapezoid', robot.w, robot.l)) ? 'trapezoid' : 'custom';
  };

  // big numeric field with drag-to-scrub on the label
  function BigNum({ label, value, onChange, unit, step = 0.01, min, max, precision = 2 }) {
    const [edit, setEdit] = useState(null);
    const cancelEdit = useRef(false);
    const commitEdit = (raw) => {
      let next = Number(raw);
      if (!Number.isFinite(next)) return;
      if (min != null) next = Math.max(min, next);
      if (max != null) next = Math.min(max, next);
      onChange(next);
    };
    const start = (down) => {
      down.preventDefault();
      const sx = down.clientX, v0 = (typeof value === 'number' ? value : 0);
      const sens = step * 8;
      const mv = (e) => { let nv = v0 + (e.clientX - sx) * sens; if (min != null) nv = Math.max(min, nv); if (max != null) nv = Math.min(max, nv); onChange(Math.round(nv / step) * step); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); document.body.style.cursor = 'ew-resize';
    };
    const display = edit != null ? edit : (typeof value === 'number' ? value.toFixed(precision) : '');
    return h('div', { className: 'rp-big', onPointerDown: (e) => { if (e.target.tagName !== 'INPUT') start(e); } },
      h('input', {
        value: display, inputMode: 'decimal', 'aria-label': label, min, max, step,
        onChange: (e) => setEdit(e.target.value),
        onFocus: (e) => { cancelEdit.current = false; setEdit(String(value)); requestAnimationFrame(() => e.target.select()); },
        onBlur: (e) => { if (!cancelEdit.current) commitEdit(e.target.value); cancelEdit.current = false; setEdit(null); },
        onKeyDown: (e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit.current = true; e.currentTarget.blur(); }
        },
      }),
      unit && h('span', { className: 'u' }, unit));
  }

  function RobotPage({ robot, setRobot, mcpEnabled, agentProposal, onApplyProposal, onRejectProposal }) {
    const isSwerve = robot.drive === 'swerve';
    const [customEditing, setCustomEditing] = useState(false);
    const [selectedVertex, setSelectedVertex] = useState(0);
    const [dragVertices, setDragVertices] = useState(null);
    const previewRef = useRef(null);
    const shape = customEditing && robot.footprint ? 'custom' : footprintShape(robot);
    const roundPreset = robot.footprintPreset && robot.footprintPreset.kind === 'round'
      ? robot.footprintPreset : { kind: 'round', vertices: 12 };
    const trapezoidPreset = robot.footprintPreset && robot.footprintPreset.kind === 'trapezoid'
      ? robot.footprintPreset : { kind: 'trapezoid', frontWidthM: robot.w * 0.64, rearWidthM: robot.w };
    const storedFootprint = robot.footprint && robot.footprint.kind === 'polygon' && Array.isArray(robot.footprint.verticesM)
      ? robot.footprint.verticesM
      : [{ x: -robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: robot.w / 2 }, { x: -robot.l / 2, y: robot.w / 2 }];
    const footprint = dragVertices || storedFootprint;
    const maxDim = Math.max(robot.w, robot.l, 0.4, ...footprint.flatMap((point) => [Math.abs(point.x) * 2, Math.abs(point.y) * 2]));
    const unit = 220 / maxDim;
    const rw = robot.l * unit, rh = robot.w * unit;
    const footprintPoints = footprint.map((point) => `${point.x * unit},${-point.y * unit}`).join(' ');
    const footprintArea = Math.abs(footprint.reduce((area, point, index) => {
      const next = footprint[(index + 1) % footprint.length];
      return area + point.x * next.y - point.y * next.x;
    }, 0)) / 2;
    const footprintCrosses = footprint.map((point, index) => {
      const next = footprint[(index + 1) % footprint.length], after = footprint[(index + 2) % footprint.length];
      return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
    }).filter((value) => Math.abs(value) > 1e-9);
    const winding = Math.sign(footprintCrosses[0] || 0);
    const containsOrigin = winding !== 0 && footprint.every((point, index) => {
      const next = footprint[(index + 1) % footprint.length];
      const cross = (next.x - point.x) * -point.y - (next.y - point.y) * -point.x;
      return Math.abs(cross) <= 1e-9 || Math.sign(cross) === winding;
    });
    const xs = footprint.map((point) => point.x), ys = footprint.map((point) => point.y);
    const withinEnvelope = Math.max(...xs) - Math.min(...xs) <= robot.l + 1e-6
      && Math.max(...ys) - Math.min(...ys) <= robot.w + 1e-6;
    const footprintValid = containsOrigin && withinEnvelope && footprintCrosses.length > 0
      && footprintCrosses.every((value) => Math.sign(value) === winding);

    // ft helpers (FRC teams often think in ft)
    const m2ft = (m) => m * 3.28084;
    const planning = robot.planning || {};
    const fallbackRatio = 6.75, fallbackWheelDiameterM = 0.1016;
    const driveModel = robot.driveModel || {
      motorId: 'custom',
      motorFreeRpm: robot.maxSpeed * 60 * fallbackRatio / (Math.PI * fallbackWheelDiameterM),
      gearRatio: fallbackRatio,
      wheelDiameterM: fallbackWheelDiameterM,
    };
    const chassisFreeSpeed = (model) => model.motorFreeRpm / 60 * Math.PI * model.wheelDiameterM / model.gearRatio;
    const setDriveModel = (patch) => {
      const next = { ...driveModel, ...patch };
      if (![next.motorFreeRpm, next.gearRatio, next.wheelDiameterM].every((value) => Number.isFinite(value) && value > 0)) return;
      const maxSpeed = chassisFreeSpeed(next);
      const nextPlanning = planning.intake && planning.intake.maxCollectSpeedMps > maxSpeed
        ? { ...planning, intake: { ...planning.intake, maxCollectSpeedMps: maxSpeed } }
        : planning;
      setRobot({ driveModel: next, maxSpeed, ...(nextPlanning !== planning ? { planning: nextPlanning } : {}) });
    };
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
      } : footprintFor(shape, nextW, nextL, shape === 'round' ? roundPreset : {
        ...trapezoidPreset,
        frontWidthM: Math.min(nextW, trapezoidPreset.frontWidthM * nextW / robot.w),
        rearWidthM: Math.min(nextW, trapezoidPreset.rearWidthM * nextW / robot.w),
      });
      const footprintPreset = shape === 'round' ? roundPreset : shape === 'trapezoid'
        ? { ...trapezoidPreset, frontWidthM: Math.min(nextW, trapezoidPreset.frontWidthM * nextW / robot.w), rearWidthM: Math.min(nextW, trapezoidPreset.rearWidthM * nextW / robot.w) }
        : shape === 'custom' ? { kind: 'custom' } : undefined;
      setRobot({ [key]: value, footprint, footprintPreset });
    };
    const setVertices = (verticesM) => setRobot({ footprint: { kind: 'polygon', verticesM }, footprintPreset: { kind: 'custom' } });
    const updateVertex = (index, key, value) => setVertices(footprint.map((point, pointIndex) => (
      pointIndex === index ? { ...point, [key]: value } : point
    )));
    const addVertex = (edgeHint) => {
      if (footprint.length >= 16) return;
      let edge = Number.isInteger(edgeHint) ? edgeHint : 0, longest = Number.isInteger(edgeHint) ? Infinity : -1;
      footprint.forEach((point, index) => {
        const next = footprint[(index + 1) % footprint.length];
        const length = Math.hypot(next.x - point.x, next.y - point.y);
        if (length > longest) { longest = length; edge = index; }
      });
      const next = footprint[(edge + 1) % footprint.length];
      const vertices = footprint.map((point) => ({ ...point }));
      vertices.splice(edge + 1, 0, { x: (footprint[edge].x + next.x) / 2, y: (footprint[edge].y + next.y) / 2 });
      setSelectedVertex(edge + 1);
      setVertices(vertices);
    };
    const eventPoint = (event) => {
      const rect = previewRef.current.getBoundingClientRect();
      return {
        x: Math.max(-robot.l / 2, Math.min(robot.l / 2, (event.clientX - rect.left - rect.width / 2) / unit)),
        y: Math.max(-robot.w / 2, Math.min(robot.w / 2, -(event.clientY - rect.top - rect.height / 2) / unit)),
      };
    };
    const startVertexDrag = (index, event) => {
      event.preventDefault(); event.stopPropagation();
      setSelectedVertex(index); setCustomEditing(true);
      const target = event.currentTarget, pointerId = event.pointerId;
      let animationFrame = 0, pendingVertices = null;
      if (target.setPointerCapture) target.setPointerCapture(pointerId);
      const renderPending = () => { animationFrame = 0; if (pendingVertices) setDragVertices(pendingVertices); };
      const move = (pointer) => {
        const point = eventPoint(pointer);
        pendingVertices = footprint.map((vertex, pointIndex) => pointIndex === index ? point : vertex);
        if (!animationFrame) animationFrame = requestAnimationFrame(renderPending);
      };
      const finish = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        if (animationFrame) cancelAnimationFrame(animationFrame);
        setDragVertices(null);
        if (pendingVertices) setVertices(pendingVertices);
        if (target.hasPointerCapture && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    };
    const addVertexFromPreview = (event) => {
      if (shape !== 'custom' || footprint.length >= 16) return;
      const point = eventPoint(event);
      let edge = 0, nearest = Infinity;
      footprint.forEach((start, index) => {
        const end = footprint[(index + 1) % footprint.length];
        const dx = end.x - start.x, dy = end.y - start.y;
        const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
        const distance = Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
        if (distance < nearest) { nearest = distance; edge = index; }
      });
      addVertex(edge);
    };
    const setRoundVertices = (vertices) => {
      const preset = { kind: 'round', vertices: Math.max(8, Math.min(16, Math.round(vertices))) };
      setRobot({ footprintPreset: preset, footprint: footprintFor('round', robot.w, robot.l, preset) });
    };
    const setTrapezoidWidth = (key, value) => {
      const preset = { ...trapezoidPreset, [key]: Math.max(0.05, Math.min(robot.w, value)) };
      setRobot({ footprintPreset: preset, footprint: footprintFor('trapezoid', robot.w, robot.l, preset) });
    };

    return h('div', { className: 'robotpage' },
      h('div', { className: 'rp-wrap' },
        h('div', { className: 'rp-title' }, 'Robot'),
        h('div', { className: 'rp-sub' }, 'Project-wide dimensions and drivetrain limits.'),
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
