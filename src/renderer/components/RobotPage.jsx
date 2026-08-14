import * as React from "react";
import { PointerDrag } from "../hooks/usePointerDrag";
import { parseFiniteDraftNumber } from "../lib/numericDraft";
import { PM } from "../lib/pathMath";
import { UnitPrefs } from "../lib/unitPreferences";
import { robotHardLimits } from "../../shared/robotLimits";
import { UI } from "./ui";

// Bordeaux Robot config page (project-global).
  const { useRef, useState, useEffect } = React;
  const h = React.createElement;
  const { Dropdown, Icon } = UI;

  // Published 12 V free speeds from the manufacturers' product documentation.
  const DRIVE_MOTORS = [
    { value: 'custom', label: 'Custom motor', meta: 'Enter its published free speed' },
    { value: 'rev-neo', label: 'REV NEO V1.1', meta: '5,676 RPM', rpm: 5676, torque: 2.6, stallCurrent: 105 },
    { value: 'rev-vortex', label: 'REV NEO Vortex', meta: '6,784 RPM', rpm: 6784, torque: 3.6, stallCurrent: 211 },
    { value: 'ctre-kraken-x60', label: 'CTRE Kraken X60', meta: '6,000 RPM', rpm: 6000, torque: 7.09, stallCurrent: 366 },
    { value: 'ctre-falcon-500', label: 'CTRE Falcon 500', meta: '6,380 RPM', rpm: 6380, torque: 4.69, stallCurrent: 257 },
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
  function BigNum({ label, value, onChange, unit, imperialUnit = unit === 'm' ? 'in' : undefined, step = 0.01, min, max, precision = 2, placeholder = '' }) {
    const [edit, setEdit] = useState(null);
    const [error, setError] = useState('');
    const cancelEdit = useRef(false);
    const pointerDrag = PointerDrag.useController();
    const unitSystem = UnitPrefs.current();
    useEffect(() => {
      setEdit(null);
      setError('');
    }, [unitSystem]);
    const commitEdit = (raw) => {
      const parsed = parseFiniteDraftNumber(raw);
      if (parsed == null) { setError('Enter a finite number.'); return false; }
      let next = UnitPrefs.toCanonical(parsed, unit, imperialUnit);
      if (min != null) next = Math.max(min, next);
      if (max != null) next = Math.min(max, next);
      setError(''); onChange(next);
      return true;
    };
    const start = (down) => {
      down.preventDefault();
      const sx = down.clientX, v0 = (typeof value === 'number' ? value : 0);
      const sens = step * 8;
      const mv = (e) => { let nv = v0 + (e.clientX - sx) * sens; if (min != null) nv = Math.max(min, nv); if (max != null) nv = Math.min(max, nv); onChange(Math.round(nv / step) * step); };
      pointerDrag.start(down, { move: mv, cursor: 'ew-resize' });
    };
    const displayValue = typeof value === 'number' ? UnitPrefs.fromCanonical(value, unit, imperialUnit) : value;
    const display = edit != null ? edit : (typeof displayValue === 'number' ? displayValue.toFixed(precision) : '');
    return h('div', { className: 'rp-big', onPointerDown: (e) => { if (e.target.tagName !== 'INPUT') start(e); } },
      h('input', {
        value: display, placeholder, inputMode: 'decimal', 'aria-label': label, min, max, step,
        'data-project-draft': true, 'aria-invalid': !!error,
        onChange: (e) => { setEdit(e.target.value); if (error) setError(''); },
        onFocus: (e) => { cancelEdit.current = false; if (edit == null) setEdit(typeof displayValue === 'number' ? String(displayValue) : ''); requestAnimationFrame(() => e.target.select()); },
        onBlur: (e) => { const committed = cancelEdit.current || commitEdit(e.target.value); cancelEdit.current = false; if (committed) setEdit(null); },
        onKeyDown: (e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit.current = true; setError(''); setEdit(null); e.currentTarget.blur(); }
        },
      }),
      unit && h('span', { className: 'u' }, UnitPrefs.label(unit, imperialUnit)),
      error && h('span', { className: 'cmd-param-error', role: 'alert' }, error));
  }

  function RobotPage({ robot, setRobot, mcpEnabled, agentProposal, onApplyProposal, onRejectProposal }) {
    const isSwerve = robot.drive === 'swerve';
    const [customEditing, setCustomEditing] = useState(false);
    const [selectedVertex, setSelectedVertex] = useState(0);
    const [dragVertices, setDragVertices] = useState(null);
    const previewRef = useRef(null);
    const vertexDrag = PointerDrag.useController();
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
    const fallbackDriveModel = {
      motorId: 'custom',
      motorFreeRpm: robot.maxSpeed * 60 * fallbackRatio / (Math.PI * fallbackWheelDiameterM),
      motorMaxTorqueNm: 2.6,
      motorCount: 4,
      gearRatio: fallbackRatio,
      wheelDiameterM: fallbackWheelDiameterM,
      massKg: 54,
      moiKgM2: 54 * (robot.l * robot.l + robot.w * robot.w) / 12,
      wheelbaseM: Math.max(0.2, robot.l - 0.18),
      trackwidthM: Math.max(0.2, robot.w - 0.18),
      wheelFrictionCoefficient: 1.2,
    };
    const driveModel = { ...fallbackDriveModel, ...(robot.driveModel || {}) };
    const hardLimits = robotHardLimits(robot);
    const setDriveModel = (patch) => {
      const next = { ...driveModel, ...patch };
      const nextLimits = robotHardLimits({ ...robot, driveModel: next });
      if (!nextLimits) return;
      const maxSpeed = nextLimits.maxSpeedMps;
      const nextPlanning = planning.intake && planning.intake.maxCollectSpeedMps > maxSpeed
        ? { ...planning, intake: { ...planning.intake, maxCollectSpeedMps: maxSpeed } }
        : planning;
      setRobot({ driveModel: next, maxSpeed, ...(nextPlanning !== planning ? { planning: nextPlanning } : {}) });
    };
    const driveFields = [
      { label: 'Motor free speed', value: driveModel.motorFreeRpm, unit: 'RPM', min: 100, max: 30000, precision: 0, step: 25, onChange: (value) => setDriveModel({ motorId: 'custom', motorFreeRpm: value }) },
      { label: 'Motor stall torque', value: driveModel.motorMaxTorqueNm, unit: 'N·m', min: 0.1, max: 20, precision: 2, step: 0.05, onChange: (value) => setDriveModel({ motorId: 'custom', motorMaxTorqueNm: value }) },
      { label: 'Motor stall current', value: driveModel.motorStallCurrentA, unit: 'A', min: 1, max: 1000, precision: 0, step: 1, placeholder: 'Add', onChange: (value) => setDriveModel({ motorId: 'custom', motorStallCurrentA: value }) },
      { label: 'Motor current limit', value: driveModel.motorCurrentLimitA, unit: 'A', min: 1, max: 500, precision: 0, step: 1, placeholder: 'Add', onChange: (value) => setDriveModel({ motorCurrentLimitA: value }) },
      { label: 'Drive reduction', value: driveModel.gearRatio, unit: ':1', min: 0.1, max: 50, precision: 2, step: 0.05, onChange: (value) => setDriveModel({ gearRatio: value }) },
      { label: 'Wheel diameter', value: driveModel.wheelDiameterM, unit: 'm', imperialUnit: 'in', min: 0.02, max: 0.5, precision: 4, step: 0.001, onChange: (value) => setDriveModel({ wheelDiameterM: value }) },
      { label: 'Drive motors', value: driveModel.motorCount, min: 2, max: 12, precision: 0, step: 1, onChange: (value) => setDriveModel({ motorCount: Math.round(value) }) },
      { label: 'Mass', value: driveModel.massKg, unit: 'kg', min: 5, max: 100, precision: 1, step: 0.5, onChange: (value) => setDriveModel({ massKg: value }) },
      { label: 'Moment of inertia', value: driveModel.moiKgM2, unit: 'kg·m²', min: 0.1, max: 50, precision: 2, step: 0.1, onChange: (value) => setDriveModel({ moiKgM2: value }) },
      { label: 'Wheelbase', value: driveModel.wheelbaseM, unit: 'm', imperialUnit: 'in', min: 0.1, max: robot.l, precision: 3, step: 0.01, onChange: (value) => setDriveModel({ wheelbaseM: value }) },
      { label: 'Trackwidth', value: driveModel.trackwidthM, unit: 'm', imperialUnit: 'in', min: 0.1, max: robot.w, precision: 3, step: 0.01, onChange: (value) => setDriveModel({ trackwidthM: value }) },
      { label: 'Wheel friction', value: driveModel.wheelFrictionCoefficient, unit: 'μ', min: 0.1, max: 3, precision: 2, step: 0.05, onChange: (value) => setDriveModel({ wheelFrictionCoefficient: value }) },
      { label: 'Open-circuit voltage', value: driveModel.batteryNominalVoltage, unit: 'V', min: 6, max: 16, precision: 1, step: 0.1, placeholder: 'Add', onChange: (value) => setDriveModel({ batteryNominalVoltage: value }) },
      { label: 'Battery + wiring resistance', value: driveModel.batteryInternalResistanceOhm, unit: 'Ω', min: 0.001, max: 0.1, precision: 3, step: 0.001, placeholder: 'Add', onChange: (value) => setDriveModel({ batteryInternalResistanceOhm: value }) },
    ];
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
      let animationFrame = 0, pendingVertices = null;
      const renderPending = () => { animationFrame = 0; if (pendingVertices) setDragVertices(pendingVertices); };
      const move = (pointer) => {
        const point = eventPoint(pointer);
        pendingVertices = footprint.map((vertex, pointIndex) => pointIndex === index ? point : vertex);
        if (!animationFrame) animationFrame = requestAnimationFrame(renderPending);
      };
      const finish = () => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        setDragVertices(null);
        if (pendingVertices) setVertices(pendingVertices);
      };
      vertexDrag.start(event, { move, end: finish, cancel: () => { if (animationFrame) cancelAnimationFrame(animationFrame); setDragVertices(null); } });
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
    const customVerticesEditor = shape === 'custom' && h('div', { className: 'rp-vertices rp-preview-vertices' },
      h('div', { className: 'rp-vertexhead' }, h('span', null, 'Custom convex vertices'), h('span', null, '+X forward · +Y left')),
      footprint.map((point, index) => h('div', { className: 'rp-vertex' + (selectedVertex === index ? ' selected' : ''), key: index, onClick: () => setSelectedVertex(index) },
        h('span', null, index + 1),
        h('label', null, 'X', h('input', { type: 'number', step: 0.01, value: point.x, 'aria-label': `Vertex ${index + 1} X`, onChange: (event) => updateVertex(index, 'x', Number(event.target.value)) })),
        h('label', null, 'Y', h('input', { type: 'number', step: 0.01, value: point.y, 'aria-label': `Vertex ${index + 1} Y`, onChange: (event) => updateVertex(index, 'y', Number(event.target.value)) })),
        h('button', { type: 'button', disabled: footprint.length <= 3, 'aria-label': `Remove vertex ${index + 1}`, onClick: () => setVertices(footprint.filter((_, pointIndex) => pointIndex !== index)) }, '\u00d7'))),
      h('button', { className: 'rp-addvertex', type: 'button', disabled: footprint.length >= 16, onClick: () => addVertex() }, 'Add vertex on longest edge'),
      h('div', { className: 'rp-note' + (footprintValid ? '' : ' invalid'), role: footprintValid ? undefined : 'status' }, footprintValid
        ? 'Drag points in the preview or enter exact coordinates.'
        : 'Keep the footprint convex, inside the robot dimensions, and around its center point.'));

    return h('div', { className: 'robotpage' },
      h('div', { className: 'rp-wrap' },
        h('div', { className: 'rp-title' }, 'Robot'),
        h('div', { className: 'rp-sub' }, 'Project-wide dimensions and drivetrain limits.'),
        h('div', { className: 'rp-grid' },
          // ---- left column: controls ----
          h('div', { className: 'rp-col rp-controls' },
            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Drivetrain'),
              h('div', { className: 'rp-drive' },
                h('button', { className: 'rp-drivebtn' + (isSwerve ? ' on' : ''), type: 'button', 'aria-pressed': isSwerve, onClick: () => setRobot({ drive: 'swerve' }) },
                  h('span', { className: 'dbi' }, h(Icon, { name: 'swerve', size: 22 })),
                  h('div', { className: 'dbt' }, 'Swerve'),
                  h('div', { className: 'dbd' }, 'Independent heading')),
                h('button', { className: 'rp-drivebtn' + (!isSwerve ? ' on' : ''), type: 'button', 'aria-pressed': !isSwerve, onClick: () => setRobot({ drive: 'tank' }) },
                  h('span', { className: 'dbi' }, h(Icon, { name: 'tank', size: 22 })),
                  h('div', { className: 'dbt' }, 'Tank'),
                  h('div', { className: 'dbd' }, 'Follows path tangent')))),

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
                    onClick: () => {
                      const preset = id === 'round' ? roundPreset : id === 'trapezoid' ? trapezoidPreset : id === 'custom' ? { kind: 'custom' } : undefined;
                      setCustomEditing(id === 'custom');
                      setRobot({ footprintPreset: preset, footprint: id === 'custom' ? { kind: 'polygon', verticesM: footprint.map((point) => ({ ...point })) } : footprintFor(id, robot.w, robot.l, preset) });
                    },
                  }, label))),
                shape === 'round' && h('div', { className: 'rp-preset-params' },
                  h('div', { className: 'rp-flabel' }, 'Curve detail', h('small', null, roundPreset.vertices + ' vertices')),
                  h('input', { type: 'range', min: 8, max: 16, step: 1, value: roundPreset.vertices, 'aria-label': 'Round footprint curve detail', onChange: (event) => setRoundVertices(Number(event.target.value)) }),
                  h('div', { className: 'rp-note' }, 'Width and length set the ellipse; detail controls how closely its collision polygon follows the curve.')),
                shape === 'trapezoid' && h('div', { className: 'rp-preset-params rp-two' },
                  h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Front width'),
                    h(BigNum, { label: 'Trapezoid front width', value: trapezoidPreset.frontWidthM, unit: 'm', min: 0.05, max: robot.w, onChange: (value) => setTrapezoidWidth('frontWidthM', value) })),
                  h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Rear width'),
                    h(BigNum, { label: 'Trapezoid rear width', value: trapezoidPreset.rearWidthM, unit: 'm', min: 0.05, max: robot.w, onChange: (value) => setTrapezoidWidth('rearWidthM', value) })))),
              h('div', { className: 'rp-field' },
                h('div', { className: 'rp-flabel' }, 'Height', h('small', null, typeof robot.heightM === 'number' ? m2ft(robot.heightM).toFixed(2) + ' ft' : 'required for TRENCH checks')),
                h(BigNum, { label: 'Robot height', value: robot.heightM, unit: 'm', min: 0.1, max: 2.5, onChange: (v) => setRobot({ heightM: v }) })),
              h('div', { className: 'rp-note' }, h(Icon, { name: 'info', size: 14 }), 'Used for collision checks and field preview.')),

            h('div', { className: 'rp-sec' },
              h('div', { className: 'rp-sech' }, 'Performance'),
              h(Dropdown, { id: 'robot-drive-motor', label: 'Drive motor', value: driveModel.motorId, items: DRIVE_MOTORS,
                onChange: (motorId) => { const preset = DRIVE_MOTORS.find((motor) => motor.value === motorId); setDriveModel({ motorId, ...(preset && preset.rpm ? { motorFreeRpm: preset.rpm, motorMaxTorqueNm: preset.torque, motorStallCurrentA: preset.stallCurrent, motorCurrentLimitA: 60, batteryNominalVoltage: 12, batteryInternalResistanceOhm: 0.02 } : {}) }); } }),
              h('div', { className: 'rp-two rp-drive-model' },
                driveFields.map((field) => h('div', { className: 'rp-field', key: field.label }, h('div', { className: 'rp-flabel' }, field.label), h(BigNum, field)))),
              !hardLimits && h('button', { className: 'rp-add-profile', type: 'button', onClick: () => setDriveModel({}) }, 'Use physical limits'),
              hardLimits && h('div', { className: 'rp-hard-limits' },
                [['Top speed', hardLimits.maxSpeedMps, 'm/s', 2], ['Linear accel', hardLimits.maxAccelMps2, 'm/s²', 2], ['Corner accel', hardLimits.maxCornerAccelMps2, 'm/s²', 2], ['Angular speed', hardLimits.maxAngularSpeedDegps, '°/s', 0]].map(([label, value, unit, precision]) =>
                  h('div', { className: 'rp-drive-result', key: label }, h('span', null, label), h('strong', null, UnitPrefs.fromCanonical(value, unit).toFixed(precision), h('small', null, ' ' + UnitPrefs.label(unit)))))),
              h('div', { className: 'rp-note' }, h(Icon, { name: 'info', size: 14 }),
                hardLimits && hardLimits.sagCoefficient > 0
                  ? 'Acceleration includes torque-speed, current limiting, and battery sag. Regeneration and scrub are omitted.'
                  : 'Add current and battery fields to model sag.'))),

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
                      h('div', { className: 'rp-field' }, h('div', { className: 'rp-flabel' }, 'Preferred range'), h(BigNum, { label: 'Preferred shooting range', value: shooter.preferredRangeM, unit: 'm', imperialUnit: 'm', min: 0.1, max: 20, onChange: (v) => setShooter({ preferredRangeM: v }) }))),
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
                h('svg', { ref: previewRef, width: 260, height: 260, viewBox: '0 0 260 260',
                  className: shape === 'custom' ? 'editable' : '', onDoubleClick: addVertexFromPreview,
                  'aria-label': shape === 'custom' ? 'Editable custom robot footprint. Drag a vertex or double-click an edge to add one.' : 'Robot footprint preview' },
                  h('g', { transform: 'translate(130 130)' },
                    h('polygon', { points: footprintPoints, fill: 'var(--accent-soft)', stroke: 'var(--accent)', strokeWidth: 2.5, strokeLinejoin: 'round' }),
                    // forward indicator (front = +X)
                    h('line', { x1: 0, y1: 0, x2: rw / 2 + 4, y2: 0, stroke: '#fff', strokeWidth: 2.5 }),
                    h('path', { d: `M ${rw / 2 + 2} -6 L ${rw / 2 + 14} 0 L ${rw / 2 + 2} 6 Z`, fill: '#fff' }),
                    // width / length ticks
                    h('text', { x: 0, y: -rh / 2 - 10, fill: 'var(--txt-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', textAnchor: 'middle' }, UnitPrefs.format(robot.w, 'm', 2, 'in')),
                    h('text', { x: rw / 2 + 26, y: 4, fill: 'var(--txt-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', transform: `rotate(90 ${rw / 2 + 26} 0)`, textAnchor: 'middle' }, UnitPrefs.format(robot.l, 'm', 2, 'in')),
                    shape === 'custom' && footprint.map((point, index) => h('g', { key: index },
                      h('circle', { cx: point.x * unit, cy: -point.y * unit, r: 22, className: 'rp-vertex-hit',
                        role: 'button', tabIndex: 0, 'aria-label': `Footprint vertex ${index + 1}`,
                        onPointerDown: (event) => startVertexDrag(index, event),
                        onDoubleClick: (event) => event.stopPropagation(),
                        onKeyDown: (event) => {
                          const step = event.shiftKey ? 0.05 : 0.01;
                          const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
                          const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
                          if (!dx && !dy) return;
                          event.preventDefault();
                          setSelectedVertex(index);
                          setVertices(footprint.map((vertex, pointIndex) => pointIndex === index ? {
                            x: Math.max(-robot.l / 2, Math.min(robot.l / 2, vertex.x + dx)),
                            y: Math.max(-robot.w / 2, Math.min(robot.w / 2, vertex.y + dy)),
                          } : vertex));
                        },
                      }),
                      h('circle', { cx: point.x * unit, cy: -point.y * unit,
                        r: selectedVertex === index ? 7 : 5, 'aria-hidden': true, pointerEvents: 'none',
                        className: 'rp-vertex-handle' + (selectedVertex === index ? ' selected' : ''),
                      })))))),
              h('div', { className: 'rp-readout' },
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, isSwerve ? 'Swerve' : 'Tank'), h('div', { className: 'rru' }, 'drive')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, UnitPrefs.fromCanonical(footprintArea, 'm²').toFixed(2)), h('div', { className: 'rru' }, UnitPrefs.label('m²') + ' footprint')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, typeof robot.heightM === 'number' ? UnitPrefs.fromCanonical(robot.heightM, 'm', 'in').toFixed(2) : '—'), h('div', { className: 'rru' }, UnitPrefs.label('m', 'in') + ' high')),
                h('div', { className: 'rr' }, h('div', { className: 'rrv' }, UnitPrefs.fromCanonical(robot.maxSpeed, 'm/s').toFixed(1)), h('div', { className: 'rru' }, UnitPrefs.label('m/s') + ' top')))),
            customVerticesEditor))));
  }

export { RobotPage };
