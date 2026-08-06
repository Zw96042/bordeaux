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
      for (const field of fields) {
        const error = schemaValueError(value[field.name], field.schema, location + '.' + field.name, level + 1);
        if (error) return error;
      }
      return '';
    }
    return location + ' uses an unsupported parameter schema.';
  }

  function parameterValueError(value, parameter) {
    const schemaError = schemaValueError(value, parameter.schema, parameter.label || parameter.name, 0);
    if (schemaError) return schemaError;
    if (parameter.min == null && parameter.max == null) return '';
    if (parameter.schema.kind === 'integerString') {
      const comparable = BigInt(value);
      if (parameter.min != null && comparable < BigInt(parameter.min)) return (parameter.label || parameter.name) + ' must be at least ' + parameter.min + '.';
      if (parameter.max != null && comparable > BigInt(parameter.max)) return (parameter.label || parameter.name) + ' must be at most ' + parameter.max + '.';
      return '';
    }
    if (parameter.schema.kind === 'decimalString') {
      if (parameter.min != null && compareExactDecimals(value, String(parameter.min)) < 0) return (parameter.label || parameter.name) + ' must be at least ' + parameter.min + '.';
      if (parameter.max != null && compareExactDecimals(value, String(parameter.max)) > 0) return (parameter.label || parameter.name) + ' must be at most ' + parameter.max + '.';
      return '';
    }
    const comparable = typeof value === 'number' ? value : Number(value);
    if (parameter.min != null && comparable < parameter.min) return (parameter.label || parameter.name) + ' must be at least ' + parameter.min + '.';
    if (parameter.max != null && comparable > parameter.max) return (parameter.label || parameter.name) + ' must be at most ' + parameter.max + '.';
    return '';
  }

  function compareExactDecimals(left, right) {
    const parse = (value) => {
      const match = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
      const fraction = match[3] || match[4] || '';
      const digits = ((match[2] || '0') + fraction).replace(/^0+/, '') || '0';
      return { sign: digits === '0' ? 0 : match[1] === '-' ? -1 : 1, digits, exponent: Number(match[5] || 0) - fraction.length };
    };
    const a = parse(left), b = parse(right);
    if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
    if (a.sign === 0) return 0;
    const aPower = a.digits.length + a.exponent, bPower = b.digits.length + b.exponent;
    let magnitude = aPower === bPower ? 0 : aPower < bPower ? -1 : 1;
    if (!magnitude) for (let i = 0; i < Math.max(a.digits.length, b.digits.length); i++) {
      const aDigit = a.digits[i] || '0', bDigit = b.digits[i] || '0';
      if (aDigit !== bDigit) { magnitude = aDigit < bDigit ? -1 : 1; break; }
    }
    return a.sign < 0 ? -magnitude : magnitude;
  }

  function parameterMetadata(parameter, javaType) {
    if (!parameter) return javaType;
    return [javaType, parameter.unit, parameter.description].filter(Boolean).join(' · ');
  }

  const MAX_RENDERED_PICKER_ITEMS = 80;

  function InlinePicker({ id, label, value, items, onChange, disabled, placeholder, icon, searchThreshold = 7 }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(0);
    const rootRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const searchRef = React.useRef(null);
    const optionRefs = React.useRef([]);
    const listboxId = id + '-listbox';
    const labelId = id + '-label';
    const selected = items.find((item) => item.value === value);
    const normalizedQuery = query.trim().toLowerCase();
    const filteredItems = normalizedQuery
      ? items.filter((item) => [item.label, item.meta, item.searchText].some((part) => String(part || '').toLowerCase().includes(normalizedQuery)))
      : items;
    const visibleItems = filteredItems.slice(0, MAX_RENDERED_PICKER_ITEMS);
    const hiddenMatchCount = filteredItems.length - visibleItems.length;
    const showSearch = items.length > searchThreshold;

    React.useEffect(() => {
      if (!open) return;
      const closeFromOutside = (event) => {
        if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
