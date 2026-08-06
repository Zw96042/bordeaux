// Bordeaux — docked right inspector. ALWAYS visible; content swaps with the
// selection (none / waypoint / segment / range / marker). Smart defaults: paths are
// smooth & tangent-following unless you intervene. Needs React + window.UI.
// Exports window.ContextInspector
(function () {
  const h = React.createElement;
  const { Num, Toggle, Seg, Icon, constraintRangeSummary } = window.UI;
  const { FIELD_W, FIELD_H } = window.FIELD_DIMS;
  const R2D = 180 / Math.PI;

  const ANCHOR_HINT = {
    param: 'Holds a fixed percent of the path as its length changes.',
    dist: 'Pinned to physical travel distance from the path start.',
    wp: 'Tied to a waypoint span, so it follows those waypoints.',
  };
  const HEAD_MODES = [{ v: 'manual', label: 'Manual' }, { v: 'tangent', label: 'Tangent' }, { v: 'targets', label: 'Targets' }];
  const HEAD_HINT = {
    manual: 'Heading comes only from waypoints you pin. Rotation targets are ignored.',
    tangent: 'Robot points along the path tangent everywhere. Rotation targets are ignored.',
    targets: 'Heading interpolates between pinned waypoints and rotation targets.',
    lookAt: 'Robot continuously faces one draggable point on the field.',
  };

  const handleLen = (w, key) => Math.hypot(w[key].x - w.x, w[key].y - w.y);
  const segNorm = (t) => (t === 'line' || t === 'arc' || t === 'clothoid') ? t : 'bezier';
  const wpName = (i, n) => i === 0 ? 'Start' : i === n - 1 ? 'End' : 'Waypoint ' + i;

  function ConstraintsBody({ c, robot, setC, labview, setLabview, plannerId, moreLimits, setMoreLimits, moreBdx, setMoreBdx }) {
    const labviewPlanner = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
    const rotation = moreLimits ? h('div', { className: 'grid2 compact-fields' },
      h(Num, { label: 'Max \u03c9', value: c.maxAngVel, unit: '\u00b0/s', step: 1, precision: 0, onChange: (v) => setC({ maxAngVel: v }) }),
      h(Num, { label: 'Max \u03b1', value: c.maxAngAccel, unit: '\u00b0/s\u00b2', step: 1, precision: 0, onChange: (v) => setC({ maxAngAccel: v }) })) : null;
    const flags = moreBdx ? h(React.Fragment, null,
      h(Num, { label: 'Current limit', value: labview.currentLimit || 0, unit: 'A', min: 0, onChange: (v) => setLabview({ currentLimit: v }) }),
      [['Reverse path', 'reversePath'], ['Zero velocity', 'zeroVelocity'], ['Zero translation', 'zeroTranslationalVelocity'], ['Correct at start', 'correctAtBeginningOfPath'], ['Pickup balls', 'pickupBalls']].map(([label, key]) =>
        h('div', { className: 'inrow', key }, h('span', { className: 'inrow-l' }, label), h(Toggle, { on: !!labview[key], ariaLabel: label, onChange: (v) => setLabview({ [key]: v }) })))) : null;
    const compatibility = labviewPlanner ? h(React.Fragment, null,
      h('div', { className: 'cgroup-h' }, 'LabVIEW'),
      h('div', { className: 'grid2' },
        h(Num, { label: 'Sample period', value: (labview.samplePeriodS || 0.02) * 1000, unit: 'ms', min: 1, max: 100, step: 1, precision: 0, onChange: (v) => setLabview({ samplePeriodS: v / 1000 }) }),
        plannerId === 'labviewClothoid'
          ? h(Num, { label: 'Min radius', value: labview.minTurnRadiusM || 0.5, unit: 'm', min: 0.05, step: 0.05, precision: 2, onChange: (v) => setLabview({ minTurnRadiusM: v }) })
          : h('div', null)),
      plannerId === 'labviewBezier' ? h(React.Fragment, null,
        h('div', { className: 'fieldlabel' }, 'Tangents'),
        h(Seg, { value: labview.bezierTangentMode || 'handles', options: [{ v: 'handles', label: 'Handles' }, { v: 'automatic', label: 'Automatic' }], onChange: (v) => setLabview({ bezierTangentMode: v }) })) : null,
      h('button', { className: 'morebtn' + (moreBdx ? ' on' : ''), type: 'button', 'aria-expanded': moreBdx, onClick: () => setMoreBdx(!moreBdx) }, h('span', null, 'Advanced .bdx flags'), h(Icon, { name: 'chevron', size: 13 })),
      flags) : null;
    return h(React.Fragment, null,
      h('div', { className: 'cgroup-h' }, 'Translation'),
      h('div', { className: 'grid2' },
        h(Num, { label: 'Max vel', value: c.maxVel, unit: 'm/s', min: 0.1, max: robot.maxSpeed, onChange: (v) => setC({ maxVel: v }) }),
        h(Num, { label: 'Max accel', value: c.maxAccel, unit: 'm/s\u00b2', min: 0.1, onChange: (v) => setC({ maxAccel: v }) })),
      h(Num, { label: 'Max decel', value: c.maxDecel != null ? c.maxDecel : c.maxAccel, unit: 'm/s\u00b2', min: 0.1, onChange: (v) => setC({ maxDecel: v }) }),
      h('button', { className: 'morebtn' + (moreLimits ? ' on' : ''), type: 'button', 'aria-expanded': moreLimits, onClick: () => setMoreLimits(!moreLimits) }, h('span', null, moreLimits ? 'Fewer limits' : 'Rotation limits'), h(Icon, { name: 'chevron', size: 13 })),
      rotation,
      compatibility);
  }

  function Stat3(items) {
    return h('div', { className: 'rt-stat' }, items.map((it, i) =>
      h('div', { key: i, className: 'rt-stat-i' }, h('span', { className: 'rt-stat-v', style: it.color ? { color: it.color } : null }, it.v), h('span', { className: 'rt-stat-k' }, it.k))));
  }

  function FaceRow({ i, actions, n }) {
    if (n < 2) return null;
    return h('div', { className: 'facerow' },
      h('button', { className: 'facebtn', type: 'button', title: 'Face next waypoint', disabled: i >= n - 1, onClick: () => actions.faceWaypoint(i, 'next') }, 'Face next'),
      h('button', { className: 'facebtn', type: 'button', title: 'Face previous waypoint', disabled: i <= 0, onClick: () => actions.faceWaypoint(i, 'prev') }, 'Face prev'),
      h('button', { className: 'facebtn', type: 'button', title: 'Align to path tangent', onClick: () => actions.faceWaypoint(i, 'tangent') }, 'Tangent'));
  }

  function defaultSchemaValue(schema, depth) {
    const level = depth || 0;
    if (!schema || level > 16) return null;
    if (schema.kind === 'boolean') return false;
    if (schema.kind === 'integer' || schema.kind === 'number') return 0;
    if (schema.kind === 'integerString') return '0';
    if (schema.kind === 'decimalString') return '0';
    if (schema.kind === 'string') return '';
    if (schema.kind === 'enum') return (schema.enumValues || [])[0] || '';
    if (schema.kind === 'array') return [];
    if (schema.kind === 'map' || schema.kind === 'opaque') return {};
    if (schema.kind === 'optional') return null;
    if (schema.kind === 'object') return Object.fromEntries((schema.fields || []).map((field) => [field.name, defaultSchemaValue(field.schema, level + 1)]));
    return null;
  }

  function commandArguments(command) {
    return Object.fromEntries((command.parameters || []).filter((parameter) => parameter.role === 'argument').map((parameter) => [parameter.name, parameterDefaultValue(parameter)]));
  }

  function parameterDefaultValue(parameter) {
    return Object.prototype.hasOwnProperty.call(parameter, 'defaultValue') ? parameter.defaultValue : defaultSchemaValue(parameter.schema, 0);
  }

  function safeControlId(value) {
    return String(value).replace(/[^A-Za-z0-9_-]+/g, '-');
  }

  function simpleJavaName(value) {
    return String(value || '').split('.').pop() || String(value || '');
  }

  function javaIntegerRange(javaType) {
    const simple = String(javaType || '').split('.').pop();
    if (simple === 'byte' || simple === 'Byte') return [-128, 127];
    if (simple === 'short' || simple === 'Short') return [-32768, 32767];
    if (simple === 'int' || simple === 'Integer') return [-2147483648, 2147483647];
    return null;
  }

  function exactIntegerStringError(value, javaType) {
    if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value)) return 'must be a whole number written as digits.';
    if (value.length > 1024) return 'cannot exceed 1024 characters.';
    const simple = String(javaType || '').split('.').pop();
    if (simple === 'long' || simple === 'Long') {
      const parsed = BigInt(value);
      if (parsed < BigInt('-9223372036854775808') || parsed > BigInt('9223372036854775807')) return 'must fit the signed 64-bit long range.';
    }
    return '';
  }

  function exactDecimalStringError(value) {
    if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return 'must be a decimal number written as text.';
    if (value.length > 1024) return 'cannot exceed 1024 characters.';
    const exponent = /[eE]([+-]?\d+)$/.exec(value);
    if (exponent && Math.abs(Number(exponent[1])) > 10000) return 'exponent cannot exceed 10000 in magnitude.';
    return '';
  }

  function schemaValueError(value, schema, path, depth) {
    const location = path || 'Value';
    const level = depth || 0;
    if (!schema) return location + ' has no discovered schema.';
    if (level > 24) return location + ' exceeds the supported nesting depth.';
    if (value === undefined) return location + ' is required.';
    if (schema.kind === 'opaque') return '';
    if (schema.kind === 'optional') return value === null ? '' : schemaValueError(value, schema.element, location, level + 1);
    if (schema.kind === 'boolean') return typeof value === 'boolean' ? '' : location + ' must be true or false.';
    if (schema.kind === 'integer') {
      if (!Number.isSafeInteger(value)) return location + ' must be a safe whole number.';
      const range = javaIntegerRange(schema.javaType);
      return !range || (value >= range[0] && value <= range[1]) ? '' : location + ' is outside the range for ' + schema.javaType + '.';
    }
    if (schema.kind === 'integerString') {
      const error = exactIntegerStringError(value, schema.javaType);
      return error ? location + ' ' + error : '';
    }
    if (schema.kind === 'decimalString') {
      const error = exactDecimalStringError(value);
      return error ? location + ' ' + error : '';
    }
    if (schema.kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? '' : location + ' must be a finite number.';
    if (schema.kind === 'string') return typeof value === 'string' ? '' : location + ' must be text.';
    if (schema.kind === 'enum') return typeof value === 'string' && (schema.enumValues || []).includes(value) ? '' : location + ' must be one of the discovered enum values.';
    if (schema.kind === 'array') {
      if (!Array.isArray(value)) return location + ' must be a JSON array.';
      if (value.length > 1024) return location + ' cannot contain more than 1024 items.';
      for (let index = 0; index < value.length; index++) {
        const error = schemaValueError(value[index], schema.element, location + '[' + index + ']', level + 1);
        if (error) return error;
      }
      return '';
    }
    if (schema.kind === 'map') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return location + ' must be a JSON object with string keys.';
      if (Object.keys(value).length > 256) return location + ' cannot contain more than 256 entries.';
      for (const [key, item] of Object.entries(value)) {
        const error = schemaValueError(item, schema.value, location + '.' + key, level + 1);
        if (error) return error;
      }
      return '';
    }
    if (schema.kind === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return location + ' must be a JSON object.';
      const fields = schema.fields || [];
      const names = new Set(fields.map((field) => field.name));
      const extra = Object.keys(value).find((key) => !names.has(key));
      if (extra) return location + '.' + extra + ' is not part of the discovered type.';
        h('div', { className: 'seg-hint' }, segHint),
        h('div', { className: 'fieldlabel' }, 'Constraint ranges here'),
        affecting.length === 0
          ? h('div', { className: 'seg-hint', style: { marginTop: '0' } }, 'None \u2014 drag the range tool along this stretch to add one.')
          : h('div', { className: 'segranges' }, affecting.map((x) => h('button', { key: x.ri, className: 'segrange', type: 'button', onClick: () => actions.select('cr', x.ri) },
              h('span', { className: 'segrange-dot' }), '\u2264' + x.rg.maxVel.toFixed(1) + ' m/s', x.rg.name ? h('span', { className: 'segrange-nm' }, x.rg.name) : null))),
        h('button', { className: 'qbtn wide', type: 'button', style: { marginTop: '14px' }, onClick: () => actions.insertWp(i) }, h(Icon, { name: 'plus', size: 14 }), 'Insert waypoint in segment'),
        h('div', { className: 'chint' }, 'Continuity belongs to the waypoints at each end \u2014 set Corner/Stop there. This card edits the segment\u2019s own geometry.'));
    }

    // ---------------- ROTATION TARGET ----------------
    else if (sel.kind === 'rt' && doc.targets[sel.idx]) {
      const t = doc.targets[sel.idx];
      icon = 'rotation'; title = 'Rotation Target'; tag = 'heading';
      body = h(React.Fragment, null,
        headingMode !== 'targets' && h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Inactive \u2014 heading mode is \u201c' + headingMode + '\u201d. Switch to Targets to use rotation targets.'),
        h('div', { className: 'fieldlabel first' }, 'Target heading'),
        h(Num, { label: null, value: t.deg, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setTarget(sel.idx, { deg: v }) }),
        h('div', { className: 'fieldlabel' }, 'Position along path'),
        h(Num, { label: null, value: t.f * 100, unit: '%', step: 1, precision: 0, min: 0, max: 100, onChange: (v) => actions.setTarget(sel.idx, { f: v / 100 }) }),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delTarget(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete target'));
    }

    // ---------------- EVENT MARKER ----------------
    else if (sel.kind === 'em' && doc.markers[sel.idx]) {
      const m = doc.markers[sel.idx];
      icon = 'flag2'; title = 'Event Marker';
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, 'Name'),
        h('input', { className: 'textinput', value: m.name, onChange: (e) => actions.setMarker(sel.idx, { name: e.target.value }) }),
        h('div', { className: 'fieldlabel' }, 'Command'),
        h('select', { className: 'selectinput', value: m.cmd, onChange: (e) => actions.setMarker(sel.idx, { cmd: e.target.value }) }, COMMANDS.map((c) => h('option', { key: c, value: c }, c))),
        h('div', { className: 'fieldlabel' }, 'Group type'),
        h(Seg, { value: m.group || 'sequential', options: [{ v: 'sequential', label: 'Seq' }, { v: 'parallel', label: 'Parallel' }, { v: 'deadline', label: 'Deadline' }], onChange: (v) => actions.setMarker(sel.idx, { group: v }) }),
        h('div', { className: 'fieldlabel' }, 'Position along path'),
        h(Num, { label: null, value: m.f * 100, unit: '%', step: 1, precision: 0, min: 0, max: 100, onChange: (v) => actions.setMarker(sel.idx, { f: v / 100 }) }),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delMarker(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete marker'));
    }

    // ---------------- CONSTRAINT RANGE ----------------
    else if (sel.kind === 'cr' && doc.ranges && doc.ranges[sel.idx]) {
      const rg = doc.ranges[sel.idx];
      const len = derived.sample.length || 1;
      const effR = (derived.effRanges && derived.effRanges[sel.idx]) || { f0: rg.f0 || 0, f1: rg.f1 || 0 };
      const loF = Math.min(effR.f0, effR.f1), hiF = Math.max(effR.f0, effR.f1);
      icon = 'gauge'; title = 'Constraint Range';
      tag = (loF * len).toFixed(1) + '\u2013' + (hiF * len).toFixed(1) + ' m';
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, 'Max velocity'),
        h(Num, { label: null, value: rg.maxVel, unit: 'm/s', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxVel: v }) }),
        h('button', { className: 'morebtn' + (moreLimits ? ' on' : ''), type: 'button', onClick: () => setMoreLimits(!moreLimits) }, h(Icon, { name: 'chevron', size: 14 }), moreLimits ? 'Fewer limits' : 'More limits \u00b7 accel & rotation'),
        moreLimits && h(React.Fragment, null,
          h('div', { className: 'cgroup-h' }, 'Translation'),
          h('div', { className: 'grid2' },
            h(Num, { label: 'Max accel', value: rg.maxAccel, unit: 'm/s\u00b2', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxAccel: v }) }),
            h(Num, { label: 'Max decel', value: rg.maxDecel, unit: 'm/s\u00b2', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxDecel: v }) })),
          h('div', { className: 'cgroup-h' }, 'Rotation'),
          h('div', { className: 'grid2' },
            h(Num, { label: 'Max \u03c9', value: rg.maxAngVel, unit: '\u00b0/s', step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { maxAngVel: v }) }),
            h(Num, { label: 'Max \u03b1', value: rg.maxAngAccel, unit: '\u00b0/s\u00b2', step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { maxAngAccel: v }) }))),
        h('div', { className: 'fieldlabel' }, 'Label'),
        h('input', { className: 'textinput', value: rg.name || '', placeholder: 'e.g. Reef approach', onChange: (e) => actions.setRange(sel.idx, { name: e.target.value }) }),
        h('div', { className: 'chint' }, 'Drawn directly on the trajectory \u2014 drag its endpoints on the field to move or resize it. Where ranges overlap, the tightest limit wins.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delRange(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete range'));
    } else {
      return null;
    }

    return h('div', { className: 'ctxinsp' },
      h('div', { className: 'ctxinsp-hd' },
        h('span', { className: 'ctxinsp-ic' }, h(Icon, { name: icon, size: 15 })),
        h('span', { className: 'ctxinsp-t' }, title),
        tag && h('span', { className: 'ctxinsp-tag' }, tag),
        closable && h('button', { className: 'ctxinsp-x', type: 'button', title: 'Clear selection', onClick: onClose }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'ctxinsp-body' }, body));
  }

  window.ContextInspector = ContextInspector;
})();
