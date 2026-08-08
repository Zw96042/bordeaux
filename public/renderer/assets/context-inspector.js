// Bordeaux — docked right inspector. ALWAYS visible; content swaps with the
// selection (none / waypoint / segment / range / marker). Smart defaults: paths are
// smooth & tangent-following unless you intervene. Needs React + window.UI.
// Exports window.ContextInspector
(function () {
  const h = React.createElement;
  const { Num, Toggle, Seg, Icon, Dropdown, constraintRangeSummary } = window.UI;
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

  function NumberValueEditor({ id, label, value, integer, javaType, parameter, onChange }) {
    const formatted = Number.isFinite(value) ? String(value) : '';
    const [draft, setDraft] = React.useState(formatted);
    const [error, setError] = React.useState('');
    React.useEffect(() => { setDraft(formatted); setError(''); }, [formatted, id]);
    const validate = (next, commit) => {
      const parsed = Number(next);
      const range = integer ? javaIntegerRange(javaType) : null;
      const message = next.trim() === '' || !Number.isFinite(parsed)
        ? 'Enter a finite number.'
        : integer && !Number.isSafeInteger(parsed)
          ? 'Enter a whole number.'
          : range && (parsed < range[0] || parsed > range[1])
            ? 'Enter a value from ' + range[0] + ' to ' + range[1] + '.'
          : parameter && parameter.min != null && parsed < parameter.min
            ? 'Enter a value of at least ' + parameter.min + '.'
          : parameter && parameter.max != null && parsed > parameter.max
            ? 'Enter a value of at most ' + parameter.max + '.'
          : '';
      setError(message);
      if (!message && commit) onChange(parsed);
      return !message;
    };
    return h('div', { className: 'cmd-param' },
      h('label', { className: 'fieldlabel', htmlFor: id }, label),
      h('input', {
        id,
        className: 'textinput cmd-param-input',
        type: 'number',
        inputMode: integer ? 'numeric' : 'decimal',
        step: integer ? 1 : 'any',
        min: parameter && parameter.min != null ? parameter.min : undefined,
        max: parameter && parameter.max != null ? parameter.max : undefined,
        value: draft,
        'aria-invalid': !!error,
        'aria-describedby': error ? id + '-error' : id + '-type',
        onChange: (event) => { setDraft(event.target.value); if (error) validate(event.target.value, false); },
        onBlur: () => validate(draft, true),
        onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); validate(draft, true); event.currentTarget.blur(); } },
      }),
      h('span', { id: id + '-type', className: 'cmd-param-type' }, parameterMetadata(parameter, javaType)),
      error && h('span', { id: id + '-error', className: 'cmd-param-error', role: 'alert' }, error));
  }

  function IntegerStringValueEditor({ id, label, value, javaType, parameter, onChange }) {
    const formatted = typeof value === 'string' ? value : '';
    const [draft, setDraft] = React.useState(formatted);
    const [error, setError] = React.useState('');
    React.useEffect(() => { setDraft(formatted); setError(''); }, [formatted, id]);
    const validate = (next, commit) => {
      const exactError = exactIntegerStringError(next.trim(), javaType);
      let message = exactError ? 'Value ' + exactError : '';
      if (!message && parameter && parameter.min != null && BigInt(next.trim()) < BigInt(parameter.min)) message = 'Enter a value of at least ' + parameter.min + '.';
      if (!message && parameter && parameter.max != null && BigInt(next.trim()) > BigInt(parameter.max)) message = 'Enter a value of at most ' + parameter.max + '.';
      setError(message);
      if (!message && commit) onChange(next.trim());
      return !message;
    };
    return h('div', { className: 'cmd-param' },
      h('label', { className: 'fieldlabel', htmlFor: id }, label),
      h('input', {
        id,
        className: 'textinput cmd-param-input',
        type: 'text',
        inputMode: 'numeric',
        pattern: '[+-]?[0-9]+',
        value: draft,
        autoComplete: 'off',
        spellCheck: false,
        'data-lpignore': 'true',
        'data-1p-ignore': true,
        'aria-invalid': !!error,
        'aria-describedby': error ? id + '-error' : id + '-type',
        onChange: (event) => { setDraft(event.target.value); if (error) validate(event.target.value, false); },
        onBlur: () => validate(draft, true),
        onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); validate(draft, true); event.currentTarget.blur(); } },
      }),
      h('span', { id: id + '-type', className: 'cmd-param-type' }, parameterMetadata(parameter, javaType + ' · exact integer')),
      error && h('span', { id: id + '-error', className: 'cmd-param-error', role: 'alert' }, error));
  }

  function DecimalStringValueEditor({ id, label, value, javaType, parameter, onChange }) {
    const formatted = typeof value === 'string' ? value : '';
    const [draft, setDraft] = React.useState(formatted);
    const [error, setError] = React.useState('');
    React.useEffect(() => { setDraft(formatted); setError(''); }, [formatted, id]);
    const validate = (next, commit) => {
      const value = next.trim();
      const exactError = exactDecimalStringError(value);
      let message = exactError ? 'Value ' + exactError : '';
      if (!message && parameter && parameter.min != null && compareExactDecimals(value, String(parameter.min)) < 0) message = 'Enter a value of at least ' + parameter.min + '.';
      if (!message && parameter && parameter.max != null && compareExactDecimals(value, String(parameter.max)) > 0) message = 'Enter a value of at most ' + parameter.max + '.';
      setError(message);
      if (!message && commit) onChange(value);
      return !message;
    };
    return h('div', { className: 'cmd-param' },
      h('label', { className: 'fieldlabel', htmlFor: id }, label),
      h('input', {
        id,
        className: 'textinput cmd-param-input',
        type: 'text',
        inputMode: 'decimal',
        value: draft,
        autoComplete: 'off',
        spellCheck: false,
        'data-lpignore': 'true',
        'data-1p-ignore': true,
        'aria-invalid': !!error,
        'aria-describedby': error ? id + '-error' : id + '-type',
        onChange: (event) => { setDraft(event.target.value); if (error) validate(event.target.value, false); },
        onBlur: () => validate(draft, true),
        onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); validate(draft, true); event.currentTarget.blur(); } },
      }),
      h('span', { id: id + '-type', className: 'cmd-param-type' }, parameterMetadata(parameter, javaType + ' · exact decimal')),
      error && h('span', { id: id + '-error', className: 'cmd-param-error', role: 'alert' }, error));
  }

  function JsonValueEditor({ id, label, value, schema, onChange }) {
    const javaType = schema && schema.javaType ? schema.javaType : 'unknown';
    const formatted = JSON.stringify(value == null ? {} : value, null, 2);
    const [draft, setDraft] = React.useState(formatted);
    const [error, setError] = React.useState('');
    React.useEffect(() => { setDraft(formatted); setError(''); }, [formatted, id]);
    const validate = (next, commit) => {
      try {
        const parsed = JSON.parse(next);
        const schemaError = schemaValueError(parsed, schema, 'Value', 0);
        if (schemaError) {
          setError(schemaError);
          return false;
        }
        setError('');
        if (commit) onChange(parsed);
        return true;
      } catch (reason) {
        setError(reason && reason.message ? reason.message : 'Enter valid JSON.');
        return false;
      }
    };
    return h('div', { className: 'cmd-param' },
      h('label', { className: 'fieldlabel', htmlFor: id }, label),
      h('textarea', {
        id,
        className: 'textinput cmd-json-input',
        value: draft,
        rows: 4,
        spellCheck: false,
        autoComplete: 'off',
        'data-lpignore': 'true',
        'data-1p-ignore': true,
        'aria-invalid': !!error,
        'aria-describedby': error ? id + '-error' : id + '-type',
        onChange: (event) => { setDraft(event.target.value); if (error) validate(event.target.value, false); },
        onBlur: () => validate(draft, true),
        onKeyDown: (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); validate(draft, true); } },
      }),
      h('span', { id: id + '-type', className: 'cmd-param-type' }, javaType + ' · JSON' + (schema && schema.kind === 'opaque' ? ' · opaque custom values remain editable as JSON' : '')),
      error && h('span', { id: id + '-error', className: 'cmd-param-error', role: 'alert' }, error));
  }

  function CommandParameterEditor({ id, label, schema, parameter, value, onChange, depth }) {
    const level = depth || 0;
    const current = value === undefined ? (parameter ? parameterDefaultValue(parameter) : defaultSchemaValue(schema, level)) : value;
    if (!schema || level > 16) return h(JsonValueEditor, { id, label, value: current, schema: schema || { kind: 'opaque', javaType: 'unknown' }, onChange });
    if (schema.kind === 'boolean') {
      return h('label', { className: 'cmd-check-row', htmlFor: id },
        h('span', null, h('strong', null, label), h('small', null, parameterMetadata(parameter, schema.javaType))),
        h('input', { id, type: 'checkbox', checked: !!current, onChange: (event) => onChange(event.target.checked) }));
    }
    if (schema.kind === 'integer' || schema.kind === 'number') {
      return h(NumberValueEditor, { id, label, value: current, integer: schema.kind === 'integer', javaType: schema.javaType, parameter, onChange });
    }
    if (schema.kind === 'integerString') {
      return h(IntegerStringValueEditor, { id, label, value: current, javaType: schema.javaType, parameter, onChange });
    }
    if (schema.kind === 'decimalString') {
      return h(DecimalStringValueEditor, { id, label, value: current, javaType: schema.javaType, parameter, onChange });
    }
    if (schema.kind === 'string') {
      return h('div', { className: 'cmd-param' },
        h('label', { className: 'fieldlabel', htmlFor: id }, label),
        h('input', { id, className: 'textinput cmd-param-input', type: 'text', value: typeof current === 'string' ? current : '', spellCheck: false, autoComplete: 'off', 'data-lpignore': 'true', 'data-1p-ignore': true, onChange: (event) => onChange(event.target.value) }),
        h('span', { className: 'cmd-param-type' }, parameterMetadata(parameter, schema.javaType)));
    }
    if (schema.kind === 'enum') {
      const options = schema.enumValues || [];
      if (options.length > 0 && options.length <= 4) {
        return h('fieldset', { className: 'cmd-choice-group', title: schema.javaType },
          h('legend', { className: 'fieldlabel' }, label),
          h('div', { className: 'cmd-choice-grid', style: { '--choice-count': options.length } },
            options.map((option) => h('label', { className: 'cmd-choice', key: option },
              h('input', { type: 'radio', name: id, value: option, checked: current === option, onChange: () => onChange(option) }),
              h('span', { title: option }, option)))));
      }
      return h(Dropdown, {
        id,
        label,
        value: current == null ? '' : current,
        items: options.map((option) => ({ value: option, label: option })),
        placeholder: 'Choose ' + label.toLowerCase(),
        searchThreshold: 7,
        onChange,
      });
    }
    if (schema.kind === 'optional') {
      const enabled = current !== null && current !== undefined;
      return h('fieldset', { className: 'cmd-param-group' },
        h('legend', null, label),
        h('label', { className: 'cmd-check-row', htmlFor: id + '-enabled' },
          h('span', null, h('strong', null, 'Set value'), h('small', null, schema.javaType)),
          h('input', { id: id + '-enabled', type: 'checkbox', checked: enabled, onChange: (event) => onChange(event.target.checked ? defaultSchemaValue(schema.element, level + 1) : null) })),
        enabled && h(CommandParameterEditor, { id: id + '-value', label: 'Value', schema: schema.element, value: current, onChange, depth: level + 1 }));
    }
    if (schema.kind === 'object') {
      const objectValue = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      return h('fieldset', { className: 'cmd-param-group' },
        h('legend', null, label),
        h('div', { className: 'cmd-param-type' }, schema.javaType),
        (schema.fields || []).map((field) => h(CommandParameterEditor, {
          key: field.name,
          id: id + '-' + safeControlId(field.name),
          label: field.name,
          schema: field.schema,
          value: objectValue[field.name],
          onChange: (next) => onChange({ ...objectValue, [field.name]: next }),
          depth: level + 1,
        })));
    }
    return h(JsonValueEditor, { id, label, value: current, schema, onChange });
  }

  const JIGGLE_DEFAULTS = { distanceM: 0.03, strokes: 8, startDeg: 45, stepDeg: -45, strokeTimeS: 0.08 };

  function ContextInspector(props) {
    const { doc, sel, derived, actions, drive, robot, plannerId, javaProject, onClose } = props;
    const [moreLimits, setMoreLimits] = React.useState(false);
    const [moreRangeLimits, setMoreRangeLimits] = React.useState(false);
    const [moreBdx, setMoreBdx] = React.useState(false);
    const [jiggleDistance, setJiggleDistance] = React.useState(JIGGLE_DEFAULTS.distanceM);
    const [jiggleStrokes, setJiggleStrokes] = React.useState(JIGGLE_DEFAULTS.strokes);
    const [jiggleStart, setJiggleStart] = React.useState(JIGGLE_DEFAULTS.startDeg);
    const [jiggleStep, setJiggleStep] = React.useState(JIGGLE_DEFAULTS.stepDeg);
    const [jiggleStrokeTime, setJiggleStrokeTime] = React.useState(JIGGLE_DEFAULTS.strokeTimeS);
    const [jiggleError, setJiggleError] = React.useState(false);
    const wps = doc.waypoints;
    const isTank = drive === 'tank';
    const isLabviewPlanner = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
    const n = wps.length;
    const headingMode = isTank ? 'tangent' : (doc.headingMode || 'targets');
    const handlesEffective = plannerId !== 'labviewClothoid' && !(plannerId === 'labviewBezier' && doc.labview?.bezierTangentMode === 'automatic');
    const endpointJiggle = wps[n - 1] && wps[n - 1].jiggle;

    React.useEffect(() => {
      setJiggleDistance(endpointJiggle?.distanceM ?? JIGGLE_DEFAULTS.distanceM);
      setJiggleStrokes(endpointJiggle?.strokes ?? JIGGLE_DEFAULTS.strokes);
      setJiggleStart(endpointJiggle?.startDeg ?? JIGGLE_DEFAULTS.startDeg);
      setJiggleStep(endpointJiggle?.stepDeg ?? JIGGLE_DEFAULTS.stepDeg);
      setJiggleStrokeTime(endpointJiggle?.strokeTimeS ?? JIGGLE_DEFAULTS.strokeTimeS);
      setJiggleError(false);
    }, [doc.id, endpointJiggle?.distanceM, endpointJiggle?.strokes, endpointJiggle?.startDeg, endpointJiggle?.stepDeg, endpointJiggle?.strokeTimeS]);

    let icon = 'route', title = '', tag = null, body = null;

    // ---------------- NO SELECTION → path summary, heading mode, global constraints ----------------
    if (!sel.kind) {
      icon = 'route'; title = doc.name || 'Path'; tag = 'summary';
      const checks = derived.checks || [];
      const issues = checks.filter((check) => check.level !== 'note');
      const errors = issues.filter((check) => check.level === 'error').length;
      body = h(React.Fragment, null,
        Stat3([
          { v: (derived.prof.totalTime || 0).toFixed(2) + 's', k: 'Time' },
          { v: (derived.totalDistance || derived.sample.length || 0).toFixed(2) + 'm', k: 'Length' },
          { v: issues.length ? String(issues.length) : '\u2713', k: issues.length ? 'Issues' : 'Clear', color: issues.length ? (errors ? 'var(--bad)' : 'var(--warn)') : 'var(--good)' },
        ]),
        h('div', { className: 'qrow', style: { marginTop: '10px' } },
          h('button', { className: 'qbtn', type: 'button', onClick: () => actions.reversePath() }, h(Icon, { name: 'shuffle', size: 14 }), 'Reverse path'),
          h('button', { className: 'qbtn', type: 'button', onClick: () => { actions.select(null, -1); actions.setTool('waypoint'); } }, h(Icon, { name: 'plus', size: 14 }), 'Place waypoint')),

        h('div', { className: 'cgroup-h' }, 'Default heading'),
        isTank
          ? h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Tank drive \u2014 heading always follows the path tangent.')
          : h(React.Fragment, null,
              h(Seg, { value: headingMode, options: HEAD_MODES, ariaLabel: 'Default heading', onChange: (v) => actions.setHeadingMode(v) }),
              h('div', { className: 'inrow' },
                h('span', { className: 'inrow-l' }, 'Drive backward'),
                h(Toggle, { on: !!doc.driveBackward, ariaLabel: 'Drive backward', onChange: () => actions.toggleDriveBackward() }))),

        h('div', { className: 'cgroup-h' }, 'Follow path by'),
        h(Seg, { value: doc.followMode || 'time', ariaLabel: 'Default path follow mode', options: [
          { v: 'time', label: 'Time', title: 'Advance from the robot clock' },
          { v: 'position', label: 'Position', title: 'Advance from measured field position' },
        ], onChange: (v) => actions.setDoc({ followMode: v }) }),
        h('div', { className: 'seg-hint' }, doc.followMode === 'position'
          ? 'Uses measured field position so contact or delay does not skip the rest of the path. Java JSON only.'
          : 'Uses the planned timeline. Individual segments can override this.'),

        h('div', { className: 'cgroup-h' }, 'Endpoints'),
        h('div', { className: 'grid2' },
          h(Num, { label: 'Start vel', value: doc.startVel || 0, unit: 'm/s', min: 0, onChange: (v) => actions.setDoc({ startVel: v }) }),
          h(Num, { label: 'Goal vel', value: doc.goalVel || 0, unit: 'm/s', min: 0, onChange: (v) => actions.setDoc({ goalVel: v }) })),
        h('div', { style: { height: '2px' } }),
        h('div', { className: 'cgroup-h' }, 'Global constraints'),
        h(ConstraintsBody, {
          c: doc.constraints,
          robot,
          setC: actions.setConstraint,
          labview: doc.labview || {},
          plannerId,
          moreLimits,
          setMoreLimits,
          moreBdx,
          setMoreBdx,
          setLabview: (patch) => actions.setDoc({ labview: { samplePeriodS: 0.02, minTurnRadiusM: 0.5, bezierTangentMode: 'handles', reversePath: false, zeroVelocity: false, pickupBalls: false, currentLimit: 0, zeroTranslationalVelocity: false, correctAtBeginningOfPath: false, ...(doc.labview || {}), ...patch } }),
        }));
    }

    // ---------------- WAYPOINT ----------------
    else if (sel.kind === 'wp' && wps[sel.idx]) {
      const i = sel.idx, w = wps[i];
      const isStart = i === 0, isEnd = i === n - 1, isAnchor = isStart || isEnd;
      const headingSegment = Math.max(0, Math.min(n - 2, i));
      const waypointHeadingMode = isTank ? 'tangent' : (wps[headingSegment].segmentHeadingMode || headingMode);
      const incomingHeadingMode = i > 0 ? (wps[i - 1].segmentHeadingMode || headingMode) : waypointHeadingMode;
      const mixedHeadingLaw = !isAnchor && incomingHeadingMode !== waypointHeadingMode;
      const continuityOwnedHeading = mixedHeadingLaw && (waypointHeadingMode === 'manual' || waypointHeadingMode === 'targets')
        && (incomingHeadingMode === 'tangent' || incomingHeadingMode === 'lookAt');
      const boundaryTransition = Object.assign({ placement: 'after', rotationPriority: 'heading', distanceM: 0.75 }, w.headingTransition || {});
      const boundaryHeadingOptions = [
        { v: 'after', label: incomingHeadingMode === 'lookAt' ? 'Keep tracking' : 'Keep tangent', title: 'Keep the incoming heading law exact through the waypoint' },
        { v: 'split', label: 'Blend', title: 'Share the heading change across both segments' },
        { v: 'before', label: 'Meet heading', title: 'Reach the authored heading at the waypoint' },
      ];
      const incomingAuthoredHeading = mixedHeadingLaw && (incomingHeadingMode === 'manual' || incomingHeadingMode === 'targets');
      const interiorHeadingEditor = (headingHint) => h(React.Fragment, null,
        headingHint,
        h('div', { className: 'inrow first' },
          h('span', { className: 'inrow-l' }, 'Pin heading here', h('small', null, 'otherwise it interpolates')),
          h(Toggle, { on: !!w.thetaOn, ariaLabel: 'Pin heading at waypoint', onChange: (v) => actions.toggleTheta(i, v) })),
        w.thetaOn && h(Num, { label: 'Heading \u03b8', value: w.theta || 0, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setWp(i, { theta: v }) }));
      icon = 'waypoint'; title = wpName(i, n); tag = isAnchor ? 'anchor' : null;
      body = h(React.Fragment, null,
        h('div', { className: 'grid2' },
          h(Num, { label: 'X', value: w.x, unit: 'm', onChange: (v) => actions.setWp(i, { x: v }) }),
          h(Num, { label: 'Y', value: w.y, unit: 'm', onChange: (v) => actions.setWp(i, { y: v }) })),

        // Heading — mode-aware
        isTank
          ? h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Tank \u2014 heading follows the path tangent.')
          : continuityOwnedHeading
            ? h(React.Fragment, null,
                h('div', { className: 'fieldlabel' }, 'Heading at this boundary'),
                h(Seg, { value: boundaryTransition.placement, ariaLabel: 'Heading at this boundary', options: boundaryHeadingOptions, onChange: (v) => actions.setHeadingTransition(i, { placement: v }) }),
                h('div', { className: 'seg-hint' }, boundaryTransition.placement === 'after'
                  ? 'Keeps the incoming ' + (incomingHeadingMode === 'tangent' ? 'tangent' : 'tracking law') + ' exact. This waypoint heading is ignored.'
                  : boundaryTransition.placement === 'split'
                    ? 'Uses this heading as the goal and blends across both segments.'
                    : 'Leaves the incoming ' + (incomingHeadingMode === 'tangent' ? 'tangent' : 'tracking law') + ' near the end to meet this heading exactly.'),
                boundaryTransition.placement !== 'after' && h(Num, { label: boundaryTransition.placement === 'before' ? 'Heading to meet' : 'Heading goal', value: w.theta || 0, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setWp(i, { theta: v, thetaOn: true }) }))
          : incomingAuthoredHeading
            ? interiorHeadingEditor(h('div', { className: 'hint' }, h(Icon, { name: 'compass', size: 14 }),
                'This heading finishes the incoming ' + incomingHeadingMode + ' law. The outgoing ' + waypointHeadingMode + ' law begins from it continuously.'))
          : waypointHeadingMode === 'lookAt'
            ? h('div', { className: 'hint' }, h(Icon, { name: 'compass', size: 14 }), 'This segment continuously faces its tracked field point. Select the segment to edit or drag it.')
          : waypointHeadingMode === 'tangent'
            ? h(React.Fragment, null,
                h('div', { className: 'hint' }, h(Icon, { name: 'compass', size: 14 }), 'This segment follows the path tangent. Set a manual heading to override only this segment.'),
                h('button', { className: 'qbtn wide', type: 'button', style: { marginTop: '4px' }, onClick: () => { actions.setSegmentHeadingMode(headingSegment, 'manual'); actions.faceWaypoint(i, 'tangent'); } }, h(Icon, { name: 'compass', size: 14 }), 'Set manual heading on segment'))
            : isAnchor
              ? h(Num, { label: 'Heading \u03b8', value: w.theta || 0, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setWp(i, { theta: v }) })
              : interiorHeadingEditor(),

        // Stop & wait
        !isAnchor && h('div', { className: 'inrow' },
          h('span', { className: 'inrow-l' }, 'Stop here', h('small', null, 'decelerate to a full stop')),
          h(Toggle, { on: !!w.stop, ariaLabel: 'Stop at waypoint', onChange: (v) => actions.setStop(i, v) })),
        !isAnchor && w.stop && h(Num, { label: 'Wait at waypoint', value: w.wait || 0, unit: 's', step: 0.1, precision: 1, min: 0, onChange: (v) => actions.setWait(i, v) }),
        !isStart && h('div', { className: 'inrow' },
          h('span', { className: 'inrow-l' }, 'Turn in place', h('small', null, 'rotate without translating')),
          h(Toggle, { on: !!w.turnInPlace, ariaLabel: 'Turn in place at waypoint', onChange: (v) => actions.setTurnInPlace(i, v) })),
        !isStart && w.turnInPlace && h(React.Fragment, null,
          h(Num, { label: 'Turn to heading', value: w.turnInPlace.headingDeg, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setTurnInPlaceMeta(i, { headingDeg: v }) }),
          h('div', { className: 'fieldlabel' }, 'Turn direction'),
          h(Seg, { value: w.turnInPlace.direction || 'shortest', ariaLabel: 'Turn direction', options: [{ v: 'shortest', label: 'Shortest' }, { v: 'counterclockwise', label: 'CCW' }, { v: 'clockwise', label: 'CW' }], onChange: (v) => actions.setTurnInPlaceMeta(i, { direction: v }) }),
          h('div', { className: 'seg-hint' }, 'Uses the angular velocity, acceleration, and jerk limits. At an interior stop, set the next segment heading to match the turn target.')),
        isAnchor && h(Num, { label: isStart ? 'Start velocity' : 'End velocity', value: isStart ? (doc.startVel || 0) : (doc.goalVel || 0), unit: 'm/s', min: 0, onChange: (v) => actions.setDoc(isStart ? { startVel: v } : { goalVel: v }) }),

        // Tangent handles only appear when the selected planner consumes them.
        handlesEffective && h(React.Fragment, null,
          h('div', { className: !isStart && !isEnd ? 'grid2' : '' },
            !isStart && h(Num, { label: 'Incoming tangent length', value: handleLen(w, 'prevC'), unit: 'm', min: 0.1, onChange: (v) => actions.setHandleLen(i, 'prevC', v) }),
            !isEnd && h(Num, { label: 'Outgoing tangent length', value: handleLen(w, 'nextC'), unit: 'm', min: 0.1, onChange: (v) => actions.setHandleLen(i, 'nextC', v) }))),

        isEnd && !isTank && h(React.Fragment, null,
          h('div', { className: 'inrow' },
            h('span', { className: 'inrow-l' }, 'Endpoint jiggle', h('small', null, 'rapid radial strokes')),
            h(Toggle, { on: !!endpointJiggle, ariaLabel: 'Endpoint jiggle', onChange: (on) => {
              if (!on) { actions.setJiggle(null); setJiggleError(false); return; }
              setJiggleError(!actions.setJiggle({ ...JIGGLE_DEFAULTS }));
            } })),
          endpointJiggle && h(React.Fragment, null,
            h('div', { className: 'grid2 compact-fields' },
              h(Num, { label: 'Distance', value: jiggleDistance, unit: 'm', min: 0.03, max: 1.5, step: 0.01, precision: 2, onChange: (v) => { setJiggleDistance(v); setJiggleError(false); } }),
              h(Num, { label: 'Stroke time', value: jiggleStrokeTime, unit: 's', min: 0.08, max: 5, step: 0.05, precision: 2, onChange: (v) => { setJiggleStrokeTime(v); setJiggleError(false); } }),
              h(Num, { label: 'Strokes', value: jiggleStrokes, min: 2, max: 12, step: 1, precision: 0, onChange: (v) => { setJiggleStrokes(v); setJiggleError(false); } }),
              h(Num, { label: 'First direction', value: jiggleStart, unit: '\u00b0 rel', step: 15, precision: 0, onChange: (v) => { setJiggleStart(v); setJiggleError(false); } }),
              h(Num, { label: 'Direction step', value: jiggleStep, unit: '\u00b0', step: 15, precision: 0, onChange: (v) => { setJiggleStep(v); setJiggleError(false); } })),
            h('button', { className: 'qbtn wide', type: 'button', onClick: () => setJiggleError(!actions.setJiggle({ distanceM: jiggleDistance, strokes: jiggleStrokes, startDeg: jiggleStart, stepDeg: jiggleStep, strokeTimeS: jiggleStrokeTime })) }, h(Icon, { name: 'route', size: 14 }), 'Update jiggle')),
          endpointJiggle && h('div', { className: 'seg-hint' }, jiggleError ? 'Keep every unique stroke on the field.' : 'Requested time may lengthen to respect path limits.')),
        isEnd && isTank && endpointJiggle && h(React.Fragment, null,
          h('div', { className: 'cgroup-h' }, 'Jiggle unavailable'),
          h('div', { className: 'seg-hint' }, 'Arbitrary-direction jiggle requires a swerve drivetrain.'),
          h('button', { className: 'qbtn', type: 'button', onClick: () => actions.setJiggle(null) }, h(Icon, { name: 'x', size: 14 }), 'Remove jiggle')),

        (!isAnchor || n > 2) && h('div', { className: 'qrow', style: { marginTop: '14px' } },
          !isAnchor && h('button', { className: 'qbtn', type: 'button', onClick: () => actions.duplicateWp(i) }, h(Icon, { name: 'copy', size: 14 }), 'Duplicate'),
          n > 2 && h('button', { className: 'qbtn danger', type: 'button', onClick: () => actions.delWp(i) }, h(Icon, { name: 'trash', size: 14 }), 'Delete')));
    }

    // ---------------- SEGMENT (true segment properties only) ----------------
    else if (sel.kind === 'seg' && wps[sel.idx] && wps[sel.idx + 1]) {
      const i = sel.idx;
      const st = segNorm(wps[i].segType);
      const segHint = (window.PM.SEGTYPES.find((s) => s.id === st) || {}).hint || '';
      const segmentLaw = (index) => {
        const mode = wps[index].segmentHeadingMode || headingMode;
        return mode === 'lookAt' ? 'lookAt:' + (wps[index].segmentLookAt ? wps[index].segmentLookAt.x + ':' + wps[index].segmentLookAt.y : '') : mode;
      };
      const incomingHeadingMode = i > 0 ? (wps[i - 1].segmentHeadingMode || headingMode) : (wps[i].segmentHeadingMode || headingMode);
      const outgoingHeadingMode = wps[i].segmentHeadingMode || headingMode;
      const continuityOwnedTransition = (incomingHeadingMode === 'tangent' || incomingHeadingMode === 'lookAt')
        && (outgoingHeadingMode === 'manual' || outgoingHeadingMode === 'targets');
      const hasHeadingTransition = !isTank && i > 0 && !wps[i].turnInPlace && segmentLaw(i) !== segmentLaw(i - 1);
      const transition = Object.assign({ placement: 'after', rotationPriority: 'heading', distanceM: 0.75 }, wps[i].headingTransition || {});
      const transitionPlacementOptions = continuityOwnedTransition ? [
        { v: 'after', label: incomingHeadingMode === 'lookAt' ? 'Keep tracking' : 'Keep tangent', title: 'Keep the incoming heading law exact through the waypoint' },
        { v: 'split', label: 'Blend', title: 'Share the heading change across both segments' },
        { v: 'before', label: 'Meet heading', title: 'Reach the authored heading at the waypoint' },
      ] : [
        { v: 'before', label: 'Before', title: 'Use the previous segment' },
        { v: 'split', label: 'Split', title: 'Share both adjacent segments' },
        { v: 'after', label: 'After', title: 'Use this segment' },
      ];
      icon = 'route'; title = 'Segment'; tag = wpName(i, n) + ' \u2192 ' + wpName(i + 1, n);
      let segLen = 0, minR = Infinity, dur = 0;
      if (derived.wpFrac && derived.sample.pts.length > 1) {
        const total = derived.sample.length || 1;
        const lo = derived.wpFrac[i], hi = derived.wpFrac[i + 1];
        segLen = (hi - lo) * total;
        const pts = derived.sample.pts;
        for (let k = 0; k < pts.length; k++) { const f = pts[k].s / total; if (f >= lo && f <= hi && pts[k].curv > 1e-4) minR = Math.min(minR, 1 / pts[k].curv); }
        if (derived.prof.t && derived.wpIdx) dur = (derived.prof.t[derived.wpIdx[i + 1]] || 0) - (derived.prof.t[derived.wpIdx[i]] || 0);
      }
      const segLo = derived.wpFrac ? derived.wpFrac[i] : 0, segHi = derived.wpFrac ? derived.wpFrac[i + 1] : 1;
      const affecting = (doc.ranges || []).map((rg, ri) => ({ rg, ri, ef: (derived.effRanges && derived.effRanges[ri]) || rg }))
        .filter((x) => { const lo = Math.min(x.ef.f0, x.ef.f1), hi = Math.max(x.ef.f0, x.ef.f1); return hi >= segLo && lo <= segHi; });
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, wpName(i, n) + ' \u2192 ' + wpName(i + 1, n)),
        Stat3([
          { v: segLen.toFixed(2) + 'm', k: 'Length' },
          { v: isFinite(minR) ? minR.toFixed(2) + 'm' : '\u221e', k: 'Min radius', color: isFinite(minR) && minR < 0.7 ? 'var(--bad)' : null },
          { v: dur.toFixed(2) + 's', k: 'Duration' },
        ]),
        h('div', { className: 'fieldlabel' }, isLabviewPlanner ? 'LabVIEW trajectory' : 'Path type'),
        isLabviewPlanner
          ? h(Seg, { value: plannerId === 'labviewClothoid' ? 'clothoid' : 'bezier', options: [{ v: 'bezier', label: 'Bezier' }, { v: 'clothoid', label: 'Clothoid' }], ariaLabel: 'LabVIEW trajectory type', onChange: actions.setLabviewTrajectoryType })
          : h(Seg, { value: st, options: window.PM.SEGTYPES.map((type) => ({ v: type.id, label: type.label, title: type.hint })), ariaLabel: 'Path type', onChange: (v) => actions.setSegMeta(i, { segType: v }) }),
        h('div', { className: 'seg-hint' }, isLabviewPlanner ? 'Applies to the entire selected path.' : segHint),
        h('div', { className: 'fieldlabel' }, 'Follow segment by'),
        h(Seg, { value: wps[i].segmentFollowMode || 'inherit', ariaLabel: 'Segment follow mode', options: [
          { v: 'inherit', label: 'Default', title: 'Use the path default' },
          { v: 'time', label: 'Time', title: 'Advance from the robot clock' },
          { v: 'position', label: 'Position', title: 'Advance from measured field position' },
        ], onChange: (v) => actions.setSegMeta(i, { segmentFollowMode: v === 'inherit' ? undefined : v }) }),
        h('div', { className: 'seg-hint' }, (wps[i].segmentFollowMode || doc.followMode) === 'position'
          ? 'Measured progress keeps this stretch active through bumps or delays.'
          : 'Follows the planned timestamps on this stretch.'),
        !isTank && h(React.Fragment, null,
          h('div', { className: 'fieldlabel' }, 'Heading on this segment'),
          h(Seg, { value: wps[i].segmentHeadingMode || 'inherit', options: [{ v: 'inherit', label: 'Default', title: 'Use path default (' + HEAD_MODES.find((mode) => mode.v === headingMode).label + ')' }, ...HEAD_MODES, { v: 'lookAt', label: 'Track point' }], ariaLabel: 'Heading on this segment', className: 'seg-heading', onChange: (v) => actions.setSegmentHeadingMode(i, v) }),
          h('div', { className: 'seg-hint' }, wps[i].segmentHeadingMode ? HEAD_HINT[wps[i].segmentHeadingMode] : 'Uses the path default. Change this segment without affecting its neighbors.')),
        !isTank && wps[i].segmentHeadingMode === 'lookAt' && wps[i].segmentLookAt && h(React.Fragment, null,
          h('div', { className: 'grid2 compact-fields' },
            h(Num, { label: 'Target X', value: wps[i].segmentLookAt.x, unit: 'm', min: 0, max: FIELD_W, onChange: (v) => actions.setSegmentLookAt(i, { x: v }) }),
            h(Num, { label: 'Target Y', value: wps[i].segmentLookAt.y, unit: 'm', min: 0, max: FIELD_H, onChange: (v) => actions.setSegmentLookAt(i, { y: v }) })),
          h('div', { className: 'seg-hint' }, 'Drag the crosshair on the field. The rotation limits still control how quickly the robot may turn.')),
        hasHeadingTransition && h(React.Fragment, null,
          h('div', { className: 'fieldlabel' }, 'Transition into this segment'),
          h(Seg, { value: transition.placement, ariaLabel: 'Heading transition side', options: transitionPlacementOptions, onChange: (v) => actions.setHeadingTransition(i, { placement: v }) }),
          h('div', { className: 'seg-hint' }, continuityOwnedTransition
            ? transition.placement === 'after'
              ? 'Keeps the incoming ' + (incomingHeadingMode === 'tangent' ? 'tangent' : 'tracking law') + ' exact. The boundary heading is ignored.'
              : transition.placement === 'split'
                ? 'Uses the boundary heading as the goal and blends across both segments.'
                : 'Leaves the incoming ' + (incomingHeadingMode === 'tangent' ? 'tangent' : 'tracking law') + ' near the end to meet the boundary heading exactly.'
            : transition.placement === 'before' ? 'The previous segment absorbs the heading change.' : transition.placement === 'split' ? 'Both adjacent segments share the heading change.' : 'This segment absorbs the heading change.'),
          continuityOwnedTransition && transition.placement !== 'after' && h(Num, { label: transition.placement === 'before' ? 'Heading to meet' : 'Heading goal', value: wps[i].theta || 0, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setWp(i, { theta: v, thetaOn: true }) }),
          h('div', { className: 'fieldlabel' }, 'Timing priority'),
          h(Seg, { value: transition.rotationPriority, ariaLabel: 'Heading transition timing priority', options: [
            { v: 'heading', label: 'Heading', title: 'Keep heading positionally exact' },
            { v: 'translation', label: 'Translation', title: 'Preserve translational timing' },
          ], onChange: (v) => actions.setHeadingTransition(i, { rotationPriority: v }) }),
          h('div', { className: 'seg-hint' }, transition.rotationPriority === 'translation' ? 'Keeps translational timing. Heading may lag, then catch up continuously.' : 'Keeps heading exact along the field. Translation may slow to stay within rotation limits.'),
          h(Num, { label: 'Blend distance', value: transition.distanceM, unit: 'm', min: 0.05, step: 0.05, precision: 2, onChange: (v) => actions.setHeadingTransition(i, { distanceM: v }) })),
        h('div', { className: 'fieldlabel' }, 'Constraint ranges here'),
        affecting.length === 0
          ? h('div', { className: 'seg-hint', style: { marginTop: '0' } }, 'None \u2014 drag the range tool along this stretch to add one.')
          : h('div', { className: 'segranges' }, affecting.map((x) => {
              const summary = constraintRangeSummary(x.rg, doc.constraints, robot);
              const label = summary ? summary.text : (x.rg.name || 'Constraint range');
              return h('button', { key: x.ri, className: 'segrange', type: 'button', 'aria-label': 'Open constraint range, ' + (summary ? summary.ariaLabel : label), onClick: () => actions.select('cr', x.ri) },
                h('span', { className: 'segrange-dot' }), label, summary && x.rg.name ? h('span', { className: 'segrange-nm' }, x.rg.name) : null);
            })),
        h('button', { className: 'qbtn wide', type: 'button', style: { marginTop: '14px' }, onClick: () => actions.insertWp(i) }, h(Icon, { name: 'plus', size: 14 }), 'Insert waypoint in segment'),
        h('div', { className: 'chint' }, 'Continuity belongs to the waypoints at each end \u2014 set Corner/Stop there. This panel edits the segment\u2019s own geometry.'));
    }

    // ---------------- ROTATION TARGET ----------------
    else if (sel.kind === 'rt' && doc.targets[sel.idx]) {
      const t = doc.targets[sel.idx];
      const targetFraction = window.PM.featureFraction(t, derived.sample);
      const targetDistance = targetFraction * (derived.sample.length || 0);
      const targetAnchor = t.anchor === 'dist' ? 'dist' : 'param';
      let targetSegment = 0;
      if (derived.wpFrac) for (let i = 0; i < derived.wpFrac.length - 1; i++) if (targetFraction >= derived.wpFrac[i] - 1e-6) targetSegment = i;
      const targetHeadingMode = isTank ? 'tangent' : (wps[targetSegment]?.segmentHeadingMode || headingMode);
      icon = 'rotation'; title = 'Rotation Target'; tag = 'heading';
      body = h(React.Fragment, null,
        targetHeadingMode !== 'targets' && h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Inactive on this segment \u2014 switch its heading mode to Targets.'),
        h(Num, { label: 'Target heading', value: t.deg, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setTarget(sel.idx, { deg: v }) }),
        h('div', { className: 'fieldlabel' }, 'Position lock'),
        h(Seg, { value: targetAnchor, ariaLabel: 'Position lock', options: [{ v: 'param', label: 'Path %' }, { v: 'dist', label: 'Distance' }], onChange: (v) => actions.setTarget(sel.idx, { anchor: v }) }),
        targetAnchor === 'dist'
          ? h(Num, { label: 'Distance from start', value: targetDistance, unit: 'm', step: 0.1, precision: 2, min: 0, max: derived.sample.length || 0, onChange: (v) => actions.setTarget(sel.idx, { d: v }) })
          : h(Num, { label: 'Position along path', value: targetFraction * 100, unit: '%', step: 1, precision: 0, min: 0, max: 100, onChange: (v) => actions.setTarget(sel.idx, { f: v / 100 }) }),
        h('div', { className: 'seg-hint' }, targetAnchor === 'dist' ? 'Stays at this traveled distance when the path grows.' : 'Scales with the path when its length changes.'),
        h('div', { className: 'seg-hint' }, 'Drag the heading arrow on the field to rotate · hold Shift for 15° steps.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delTarget(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete target'));
    }

    // ---------------- EVENT MARKER ----------------
    else if (sel.kind === 'em' && doc.markers[sel.idx]) {
      const m = doc.markers[sel.idx];
      const markerFraction = window.PM.featureFraction(m, derived.sample);
      const markerDistance = markerFraction * (derived.sample.length || 0);
      const markerAnchor = m.anchor === 'dist' ? 'dist' : 'param';
      const schedule = m.schedule || {};
      const catalog = javaProject && javaProject.catalog;
      const integration = javaProject && javaProject.integration;
      const commands = catalog ? catalog.commands || [] : [];
      const recentProjects = javaProject && javaProject.recentProjects ? javaProject.recentProjects : [];
      const currentProject = recentProjects.find((project) => project.id === (javaProject && javaProject.bookmarkId));
      const invocationId = m.invocation && m.invocation.commandId ? m.invocation.commandId : (m.cmd && m.cmd !== 'none' ? m.cmd : '');
      const selectedCommand = commands.find((command) => command.id === invocationId);
      const unresolved = invocationId && !selectedCommand;
      const pendingActionTag = m.actionIntent && m.actionIntent.semanticTag;
      const commandPickerItems = [{ value: '', label: 'No command' }]
        .concat(unresolved ? [{ value: invocationId, label: simpleJavaName(invocationId), meta: 'Saved command is unavailable', badge: 'Missing' }] : [])
        .concat(commands.map((command) => ({
          value: command.id,
          label: command.label,
          meta: (command.kind === 'constructor' ? 'Command class' : 'Factory') + ' · ' + simpleJavaName(command.ownerType),
          badge: pendingActionTag && (command.semanticTags || []).includes(pendingActionTag) ? 'Matches action' : command.runtimeReady === true ? '' : 'Not built',
          searchText: [command.description, command.id, command.ownerType, command.member].concat(command.semanticTags || [])
            .concat((command.parameters || []).map((parameter) => [parameter.name, parameter.label, parameter.description, parameter.unit, parameter.javaType].filter(Boolean).join(' ')))
            .filter(Boolean)
            .join(' '),
        })));
      const argumentParameters = selectedCommand ? (selectedCommand.parameters || []).filter((parameter) => parameter.role === 'argument') : [];
      const dependencyParameters = selectedCommand ? (selectedCommand.parameters || []).filter((parameter) => parameter.role === 'dependency') : [];
      const invocationArguments = m.invocation && m.invocation.commandId === invocationId ? (m.invocation.arguments || {}) : {};
      const reconciledArguments = Object.fromEntries(argumentParameters.map((parameter) => {
        const saved = Object.prototype.hasOwnProperty.call(invocationArguments, parameter.name) ? invocationArguments[parameter.name] : undefined;
        return [parameter.name, parameterValueError(saved, parameter) ? parameterDefaultValue(parameter) : saved];
      }));
      const argumentNames = new Set(argumentParameters.map((parameter) => parameter.name));
      const argumentSchemaMismatch = !!selectedCommand && (
        Object.keys(invocationArguments).some((name) => !argumentNames.has(name))
        || argumentParameters.some((parameter) => parameterValueError(invocationArguments[parameter.name], parameter))
      );
      const operation = javaProject && javaProject.operation;
      const catalogReady = !!(catalog && catalog.authoritative && catalog.catalogHash);
      const supportInstalled = !!(integration && integration.installed);
      const supportCompatible = !!(supportInstalled && (!catalogReady || integration.supportVersion === catalog.supportVersion));
      const javaReady = catalogReady && supportCompatible;
      const projectStateLabel = operation === 'scan' ? 'Checking project…'
        : operation === 'install' ? 'Installing support…'
          : operation === 'build' ? 'Building catalog…'
            : javaReady ? 'Ready'
              : supportInstalled && !supportCompatible ? 'Support update required'
                : supportInstalled ? 'Catalog build required'
                  : 'Support setup required';
      icon = 'flag2'; title = 'Event Marker';
      body = h(React.Fragment, null,
        h('label', { className: 'fieldlabel first', htmlFor: 'event-marker-name' }, 'Name'),
        h('input', { id: 'event-marker-name', className: 'textinput', value: m.name, autoComplete: 'off', spellCheck: false, 'data-lpignore': 'true', 'data-1p-ignore': true, onChange: (e) => actions.setMarker(sel.idx, { name: e.target.value }) }),

        h('div', { className: 'cgroup-h' }, 'Java command'),
        h('section', { className: 'cmd-project', 'aria-label': 'Linked Java project' },
          h('div', { className: 'cmd-project-head' },
            h('span', { className: 'cmd-project-icon' }, h(Icon, { name: 'folder', size: 15 })),
            h('div', { className: 'cmd-project-copy' },
              h('strong', { title: catalog ? catalog.projectName : 'No Java project linked' }, catalog ? catalog.projectName : 'No Java project linked'),
              h('span', { title: currentProject && currentProject.folderName }, currentProject ? currentProject.folderName : catalog ? catalog.sourceFileCount + ' Java source files' : 'Choose the GradleRIO project folder'))),
          catalog && h('div', { className: 'cmd-project-foot' },
            h('div', { className: 'cmd-project-summary' },
              h('span', {
                className: 'cmd-project-state ' + (javaReady ? 'ready' : ''),
                title: catalogReady && catalog.catalogHash ? catalog.catalogHash : undefined,
                role: 'status',
                'aria-live': 'polite',
              }, h('i', null), projectStateLabel),
              h('span', { className: 'cmd-project-count' }, commands.length + ' command' + (commands.length === 1 ? '' : 's'))),
            h('div', { className: 'cmd-project-actions' },
              h('button', { className: 'cmd-iconbtn', type: 'button', title: 'Refresh project', 'aria-label': operation === 'scan' ? 'Checking project' : 'Refresh Java project', disabled: !!operation, onClick: javaProject.refresh }, h(Icon, { name: 'refresh', size: 15 })),
              catalogReady && supportCompatible && h('button', { className: 'cmd-iconbtn', type: 'button', title: 'Rebuild command catalog', 'aria-label': operation === 'build' ? 'Building command catalog' : 'Rebuild command catalog', disabled: !!operation || !integration || !integration.wrapperAvailable, onClick: javaProject.build }, h(Icon, { name: 'bolt', size: 15 })),
              h('button', { className: 'cmd-iconbtn', type: 'button', title: 'Choose another project', 'aria-label': 'Choose Java project', disabled: !!operation, onClick: javaProject && javaProject.link }, h(Icon, { name: 'folder', size: 15 })))),
          catalog && !supportCompatible && h('button', { className: 'cmd-primary-action', type: 'button', disabled: !!operation || !integration || !integration.wrapperAvailable, onClick: javaProject.install }, operation === 'install' ? 'Installing support…' : integration && integration.supportVersion ? 'Update support' : 'Install support'),
          catalog && supportCompatible && !catalogReady && h('button', { className: 'cmd-primary-action', type: 'button', disabled: !!operation || !integration || !integration.wrapperAvailable, onClick: javaProject.build }, operation === 'build' ? 'Building catalog…' : 'Build command catalog'),
          operation === 'build' && h('button', { className: 'cmd-cancel-action', type: 'button', onClick: javaProject.cancelBuild }, 'Cancel build'),
          recentProjects.length > 1 && h('div', { className: 'cmd-project-switcher' },
            h(Dropdown, {
              id: 'event-marker-java-project',
              label: 'Switch project',
              value: javaProject.bookmarkId || '',
              items: recentProjects.map((project) => ({ value: project.id, label: project.projectName, meta: project.folderName })),
              placeholder: 'Choose a project',
              icon: 'folder',
              disabled: javaProject.status === 'loading',
              onChange: (projectId) => { if (projectId) javaProject.openRecent(projectId); },
            })),
          !catalog && h('button', { className: 'cmd-primary-action', type: 'button', disabled: !!operation, onClick: javaProject && javaProject.link }, 'Choose Java project'),
          integration && !integration.wrapperAvailable && h('div', { className: 'cmd-project-warning' }, 'Add a Gradle wrapper to install support or build commands.')),
        javaProject && javaProject.error && h('div', { className: 'cmd-project-error', role: 'alert' }, javaProject.error),
        javaProject && javaProject.notice && h('div', { className: 'cmd-project-notice', role: 'status' }, javaProject.notice),
        m.actionIntent && h('div', { className: 'cmd-project-notice', role: 'status' }, 'Pending action: ' + m.actionIntent.description + ' (' + m.actionIntent.semanticTag + '). Choose a generated command marked “Matches action” before Java export.'),
        catalog && catalog.warnings && catalog.warnings.length > 0 && h('div', { className: 'seg-hint' }, catalog.warnings.length + ' source discovery warning' + (catalog.warnings.length === 1 ? '' : 's') + '. Generated annotations remain authoritative.'),
        h('section', { className: 'cmd-command-editor', 'aria-label': 'Marker command' },
          h(Dropdown, {
            id: 'event-marker-command',
            label: 'Command',
            value: invocationId,
            items: commandPickerItems,
            placeholder: catalog ? 'Choose a command' : 'Choose a Java project',
            icon: 'bolt',
            searchThreshold: 6,
            disabled: !catalog || javaProject.status === 'loading',
            onChange: (commandId) => {
              const command = commands.find((candidate) => candidate.id === commandId);
              const resolvesAction = command && pendingActionTag && (command.semanticTags || []).includes(pendingActionTag);
              actions.setMarker(sel.idx, {
                cmd: command ? command.id : 'none',
                invocation: command ? { commandId: command.id, arguments: commandArguments(command) } : undefined,
                actionIntent: resolvesAction ? undefined : m.actionIntent,
              });
            },
          }),
          unresolved && h('div', { className: 'cmd-project-error', role: 'status' }, 'This command is not in the linked project. Its saved ID and arguments are unchanged.'),
          selectedCommand && selectedCommand.runtimeReady !== true && h('div', { className: 'cmd-project-error', role: 'status' }, 'Build the annotated catalog before exporting this source preview.'),
          selectedCommand && h('div', {
            className: 'cmd-command-summary',
            title: selectedCommand.source ? selectedCommand.source.file + ':' + selectedCommand.source.line : undefined,
          },
            selectedCommand.description && h('p', { className: 'cmd-command-description' }, selectedCommand.description),
            h('span', { className: 'cmd-command-meta' }, (selectedCommand.kind === 'constructor' ? 'Command class' : 'Factory') + ' · ' + simpleJavaName(selectedCommand.ownerType) + (selectedCommand.confidence === 'inferred' ? ' · inferred' : ''))),
          selectedCommand && dependencyParameters.length > 0 && h('div', { className: 'seg-hint' }, simpleJavaName(dependencyParameters[0].javaType) + (dependencyParameters.length > 1 ? ' and ' + (dependencyParameters.length - 1) + ' more dependencies are supplied by robot code.' : ' is supplied by robot code.')),
          argumentSchemaMismatch && h('div', { className: 'cmd-schema-warning', role: 'status' },
            h('span', null, 'Saved arguments no longer match this command.'),
            h('button', { className: 'qbtn', type: 'button', onClick: () => actions.setMarker(sel.idx, { invocation: { ...m.invocation, commandId: selectedCommand.id, arguments: reconciledArguments } }) }, 'Use current defaults')),
          selectedCommand && h('form', { className: 'cmd-parameters', onSubmit: (event) => event.preventDefault() },
            argumentParameters.length === 0
              ? h('div', { className: 'cmd-empty-params' }, 'No parameters')
              : argumentParameters.map((parameter) => h(CommandParameterEditor, {
                  key: parameter.name,
                  id: 'event-command-param-' + safeControlId(parameter.name),
                  label: parameter.label || parameter.name,
                  schema: parameter.schema,
                  parameter,
                  value: reconciledArguments[parameter.name],
                  onChange: (value) => actions.setMarker(sel.idx, { invocation: { ...m.invocation, commandId: selectedCommand.id, arguments: { ...reconciledArguments, [parameter.name]: value } } }),
                  depth: 0,
                })),
            h('label', { className: 'cmd-toggle-row', htmlFor: 'event-command-cancel' },
              h('span', { className: 'cmd-toggle-copy' },
                h('strong', null, 'Stop when path ends'),
                h('small', null, 'Cancel this command if it is still running.')),
              h('input', {
                id: 'event-command-cancel',
                className: 'cmd-toggle-input',
                type: 'checkbox',
                checked: m.invocation && m.invocation.cancelOnPathEnd === true,
                onChange: (event) => actions.setMarker(sel.idx, { invocation: { ...m.invocation, commandId: selectedCommand.id, arguments: reconciledArguments, cancelOnPathEnd: event.target.checked } }),
              }),
              h('span', { className: 'cmd-toggle-track', 'aria-hidden': true }, h('span', null))))),
        h('div', { className: 'fieldlabel' }, 'Group type'),
        h(Seg, { value: m.group || 'sequential', ariaLabel: 'Group type', options: [{ v: 'sequential', label: 'Seq' }, { v: 'parallel', label: 'Parallel' }, { v: 'deadline', label: 'Deadline' }], onChange: (v) => actions.setMarker(sel.idx, { group: v }) }),
        h('div', { className: 'fieldlabel' }, 'Trigger from'),
        h(Seg, { value: schedule.trigger || 'time', ariaLabel: 'Event trigger', options: [
          { v: 'time', label: 'Time', title: 'Fire when planned time reaches this marker' },
          { v: 'position', label: 'Position', title: 'Fire when measured progress reaches this marker' },
        ], onChange: (v) => actions.setMarker(sel.idx, { schedule: { ...schedule, trigger: v } }) }),
        h('div', { className: 'seg-hint' }, schedule.trigger === 'position'
          ? 'Uses measured robot progress, even on a time-followed path.'
          : 'Uses the marker’s planned arrival time.'),
        h('div', { className: 'inrow' },
          h('span', { className: 'inrow-l' }, 'Repeat command', h('small', null, 'while the window is active')),
          h(Toggle, { on: schedule.repeatEveryS != null, ariaLabel: 'Repeat event', onChange: (on) => actions.setMarker(sel.idx, { schedule: { ...schedule, repeatEveryS: on ? 0.1 : undefined } }) })),
        schedule.repeatEveryS != null && h(Num, { label: 'Repeat every', value: schedule.repeatEveryS, unit: 's', min: 0.001, step: 0.02, precision: 3, onChange: (v) => actions.setMarker(sel.idx, { schedule: { ...schedule, repeatEveryS: v } }) }),
        h('div', { className: 'inrow' },
          h('span', { className: 'inrow-l' }, 'End time', h('small', null, 'expire or stop repeating')),
          h(Toggle, { on: schedule.endTimeS != null, ariaLabel: 'Limit event end time', onChange: (on) => actions.setMarker(sel.idx, { schedule: { ...schedule, endTimeS: on ? (derived.prof.totalTime || 0) : undefined } }) })),
        schedule.endTimeS != null && h(Num, { label: 'End path time', value: schedule.endTimeS, unit: 's', min: 0, max: derived.prof.totalTime || 0, step: 0.1, precision: 2, onChange: (v) => actions.setMarker(sel.idx, { schedule: { ...schedule, endTimeS: v } }) }),
        h(Dropdown, { id: 'event-condition-id', label: 'Condition ID · optional', value: schedule.conditionId || '',
          items: window.AUTO.pickerItems(window.AUTO.CONDITIONS, schedule.conditionId || '', 'No condition'),
          placeholder: 'Choose a registered condition', icon: 'branch', allowCustom: true,
          customLabel: 'Enter exact event condition ID', customPlaceholder: 'Exact condition ID',
          onChange: (value) => actions.setMarker(sel.idx, { schedule: { ...schedule, conditionId: value || undefined } }) }),
        h('div', { className: 'marker-position-group' },
          h('div', { className: 'fieldlabel' }, 'Position lock'),
          h(Seg, { value: markerAnchor, ariaLabel: 'Position lock', options: [{ v: 'param', label: 'Path %' }, { v: 'dist', label: 'Distance' }], onChange: (v) => actions.setMarker(sel.idx, { anchor: v }) }),
          markerAnchor === 'dist'
            ? h(Num, { label: 'Distance from start', value: markerDistance, unit: 'm', step: 0.1, precision: 2, min: 0, max: derived.sample.length || 0, onChange: (v) => actions.setMarker(sel.idx, { d: v }) })
            : h(Num, { label: 'Position along path', value: markerFraction * 100, unit: '%', step: 1, precision: 0, min: 0, max: 100, onChange: (v) => actions.setMarker(sel.idx, { f: v / 100 }) }),
          h('div', { className: 'seg-hint' }, markerAnchor === 'dist' ? 'Stays at this traveled distance when the path grows.' : 'Scales with the path when its length changes.')),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delMarker(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete marker'));
    }

    // ---------------- CONSTRAINT RANGE ----------------
    else if (sel.kind === 'cr' && doc.ranges && doc.ranges[sel.idx]) {
      const rg = doc.ranges[sel.idx];
      const len = derived.sample.length || 1;
      const effR = (derived.effRanges && derived.effRanges[sel.idx]) || { f0: rg.f0 || 0, f1: rg.f1 || 0 };
      const loF = Math.min(effR.f0, effR.f1), hiF = Math.max(effR.f0, effR.f1);
      const clampFraction = (value) => Math.max(0, Math.min(1, value / 100));
      const rangeAnchor = rg.anchor === 'dist' ? 'dist' : rg.anchor === 'wp' ? 'wp' : 'param';
      const anchorOptions = [{ v: 'param', label: 'Proportional' }, { v: 'wp', label: 'Local' }].concat(rangeAnchor === 'dist' ? [{ v: 'dist', label: 'Distance (legacy)' }] : []);
      icon = 'gauge'; title = 'Constraint Range';
      tag = (loF * len).toFixed(1) + '\u2013' + (hiF * len).toFixed(1) + ' m';
      body = h(React.Fragment, null,
        h(Num, { label: 'Max velocity', value: rg.maxVel, unit: 'm/s', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxVel: v }) }),
        h('section', { className: 'range-anchor-editor', 'aria-label': 'Range position lock' },
          h('div', { className: 'fieldlabel' }, 'Position lock'),
          h(Seg, { value: rangeAnchor, ariaLabel: 'Position lock', options: anchorOptions, onChange: (v) => actions.setRangeAnchor(sel.idx, v) }),
          rangeAnchor === 'dist'
            ? h('div', { className: 'grid2' },
                h(Num, { label: 'Start distance', value: loF * len, unit: 'm', min: 0, max: len, step: 0.1, precision: 2, onChange: (v) => actions.setRange(sel.idx, { d0: Math.min(v, hiF * len) }) }),
                h(Num, { label: 'End distance', value: hiF * len, unit: 'm', min: 0, max: len, step: 0.1, precision: 2, onChange: (v) => actions.setRange(sel.idx, { d1: Math.max(v, loF * len) }) }))
            : rangeAnchor === 'wp'
              ? h('div', { className: 'range-local' },
                  h('div', null, h('b', null, 'From'), h('span', null, wpName(Math.max(0, Math.min(n - 2, rg.w0 || 0)), n) + ' \u00b7 ' + Math.round((rg.t0 || 0) * 100) + '%')),
                  h('div', null, h('b', null, 'To'), h('span', null, wpName(Math.max(0, Math.min(n - 2, rg.w1 || 0)), n) + ' \u00b7 ' + Math.round((rg.t1 || 0) * 100) + '%')))
              : h('div', { className: 'grid2' },
                  h(Num, { label: 'Start position', value: loF * 100, unit: '%', min: 0, max: 100, step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { f0: Math.min(clampFraction(v), hiF), f1: hiF }) }),
                  h(Num, { label: 'End position', value: hiF * 100, unit: '%', min: 0, max: 100, step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { f0: loF, f1: Math.max(clampFraction(v), loF) }) })),
          h('div', { className: 'seg-hint' }, rangeAnchor === 'dist' ? 'Legacy distance from the path start. Local keeps the range attached to these segments.' : rangeAnchor === 'wp' ? 'Stays attached to these segment positions.' : 'Scales with the whole path.')),
        h('div', { className: 'fieldlabel' }, 'Timing priority'),
        h(Seg, { value: drive === 'tank' ? 'heading' : (rg.rotationPriority || 'heading'), ariaLabel: 'Timing priority', options: drive === 'tank'
          ? [{ v: 'heading', label: 'Heading', ariaLabel: 'Heading priority, required for tank drive' }]
          : [
              { v: 'heading', label: 'Heading', ariaLabel: 'Heading priority, adjust translation so rotation stays on schedule' },
              { v: 'translation', label: 'Translation', ariaLabel: 'Translation priority, preserve translational timing while rotation catches up' },
            ], onChange: (v) => actions.setRange(sel.idx, { rotationPriority: v }) }),
        h('div', { className: 'seg-hint' }, drive === 'tank' ? 'Tank drive must follow the path heading.' : rg.rotationPriority === 'translation' ? 'Keeps this stretch moving. Heading may finish settling afterward.' : 'Adjusts translation so rotation stays on schedule.'),
        h('button', { className: 'range-disclosure' + (moreRangeLimits ? ' on' : ''), type: 'button', 'aria-expanded': moreRangeLimits, onClick: () => setMoreRangeLimits(!moreRangeLimits) },
          h('span', { className: 'range-disclosure-copy' }, h('strong', null, 'Acceleration & rotation'), h('small', null, 'Optional local limits')),
          h(Icon, { name: 'chevron', size: 14 })),
        moreRangeLimits && h(React.Fragment, null,
          h('div', { className: 'cgroup-h' }, 'Translation'),
          h('div', { className: 'grid2' },
            h(Num, { label: 'Max accel', value: rg.maxAccel, unit: 'm/s\u00b2', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxAccel: v }) }),
            h(Num, { label: 'Max decel', value: rg.maxDecel, unit: 'm/s\u00b2', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxDecel: v }) })),
          h('div', { className: 'cgroup-h' }, 'Rotation'),
          h('div', { className: 'grid2' },
            h(Num, { label: 'Max \u03c9', value: rg.maxAngVel, unit: '\u00b0/s', step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { maxAngVel: v }) }),
            h(Num, { label: 'Max \u03b1', value: rg.maxAngAccel, unit: '\u00b0/s\u00b2', step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { maxAngAccel: v }) }))),
        h('label', { className: 'fieldlabel', htmlFor: 'constraint-range-label' }, 'Label'),
        h('input', { id: 'constraint-range-label', className: 'textinput', value: rg.name || '', placeholder: 'e.g. Reef approach', autoComplete: 'off', spellCheck: false, 'data-lpignore': 'true', 'data-1p-ignore': true, onChange: (e) => actions.setRange(sel.idx, { name: e.target.value }) }),
        h('div', { className: 'chint' }, 'Drag endpoints on the field. Overlaps use the tightest limits.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delRange(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete range'));
    } else {
      return null;
    }

    return h('div', { className: 'ctxinsp' },
      h('div', { className: 'ctxinsp-hd' },
        h('span', { className: 'ctxinsp-ic' }, h(Icon, { name: icon, size: 15 })),
        h('span', { className: 'ctxinsp-t', title }, title),
        tag && h('span', { className: 'ctxinsp-tag' }, tag),
        h('button', { className: 'ctxinsp-x', type: 'button', title: 'Hide inspector', 'aria-label': 'Hide inspector', onClick: onClose }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'ctxinsp-body' }, body));
  }

  window.ContextInspector = ContextInspector;
  window.BordeauxCommandEditor = { CommandParameterEditor, commandArguments, parameterValueError, safeControlId };
})();
