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
      };
      document.addEventListener('pointerdown', closeFromOutside);
      return () => document.removeEventListener('pointerdown', closeFromOutside);
    }, [open]);

    React.useEffect(() => {
      if (!open) { setQuery(''); return; }
      const selectedIndex = Math.max(0, visibleItems.findIndex((item) => item.value === value));
      setActiveIndex(selectedIndex);
      requestAnimationFrame(() => {
        if (showSearch) searchRef.current && searchRef.current.focus();
        else optionRefs.current[selectedIndex] && optionRefs.current[selectedIndex].focus();
      });
    }, [open]);

    React.useEffect(() => {
      if (!open) return;
      setActiveIndex(0);
    }, [query]);

    const choose = (nextValue) => {
      onChange(nextValue);
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current && triggerRef.current.focus());
    };
    const focusOption = (nextIndex) => {
      if (!visibleItems.length) return;
      const wrapped = (nextIndex + visibleItems.length) % visibleItems.length;
      setActiveIndex(wrapped);
      requestAnimationFrame(() => optionRefs.current[wrapped] && optionRefs.current[wrapped].focus());
    };
    const handleKeyDown = (event) => {
      if (!open) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpen(true);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current && triggerRef.current.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(activeIndex - 1);
      } else if (event.key === 'Enter' && visibleItems[activeIndex]) {
        event.preventDefault();
        choose(visibleItems[activeIndex].value);
      }
    };

    return h('div', {
      className: 'cmd-picker',
      ref: rootRef,
      onKeyDown: handleKeyDown,
      onBlur: (event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      },
    },
      h('span', { id: labelId, className: 'fieldlabel' }, label),
      h('button', {
        id,
        ref: triggerRef,
        className: 'cmd-picker-trigger',
        type: 'button',
        role: 'combobox',
        'aria-labelledby': labelId + ' ' + id + '-value',
        'aria-controls': listboxId,
        'aria-expanded': open,
        'aria-haspopup': 'listbox',
        disabled,
        onClick: () => setOpen((current) => !current),
      },
        icon && h(Icon, { name: icon, size: 14 }),
        h('span', { id: id + '-value', title: selected ? selected.label : placeholder }, selected ? selected.label : placeholder),
        selected && selected.badge && h('small', null, selected.badge),
        h(Icon, { name: 'chevron', size: 13 })),
      open && h('div', { className: 'cmd-picker-panel' },
        showSearch && h('div', { className: 'cmd-picker-search' },
          h(Icon, { name: 'search', size: 14 }),
          h('label', { className: 'sr-only', htmlFor: id + '-search' }, 'Filter ' + label.toLowerCase()),
          h('input', {
            id: id + '-search',
            ref: searchRef,
            type: 'search',
            value: query,
            placeholder: 'Filter ' + label.toLowerCase() + '…',
            autoComplete: 'off',
            spellCheck: false,
            'data-lpignore': 'true',
            'data-1p-ignore': true,
            'aria-controls': listboxId,
            onChange: (event) => setQuery(event.target.value),
          })),
        h('div', { id: listboxId, className: 'cmd-picker-list', role: 'listbox', 'aria-labelledby': labelId },
          visibleItems.length === 0
            ? h('div', { className: 'cmd-picker-empty' }, 'No matches')
            : visibleItems.map((item, index) => h('button', {
                key: item.value,
                ref: (node) => { optionRefs.current[index] = node; },
                className: 'cmd-picker-option' + (index === activeIndex ? ' active' : ''),
                type: 'button',
                role: 'option',
                tabIndex: -1,
                'aria-selected': item.value === value,
                'data-value': item.value,
                onMouseEnter: () => setActiveIndex(index),
                onClick: () => choose(item.value),
              },
                h('span', { className: 'cmd-picker-check' }, item.value === value && h(Icon, { name: 'check', size: 13 })),
                h('span', { className: 'cmd-picker-option-copy' },
                  h('strong', { title: item.label }, item.label),
                  item.meta && h('small', null, item.meta)),
                item.badge && h('span', { className: 'cmd-picker-badge' }, item.badge))),
          hiddenMatchCount > 0 && h('div', { className: 'cmd-picker-more', role: 'status' },
            visibleItems.length + ' of ' + filteredItems.length + ' shown · Keep typing to narrow results'))));
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
      return h(InlinePicker, {
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

  function ContextInspector(props) {
    const { doc, sel, derived, actions, drive, robot, plannerId, javaProject, onClose } = props;
    const [moreLimits, setMoreLimits] = React.useState(false);
    const [moreBdx, setMoreBdx] = React.useState(false);
    const [jiggleDistance, setJiggleDistance] = React.useState(0.18);
    const [jiggleStrokes, setJiggleStrokes] = React.useState(4);
    const [jiggleStart, setJiggleStart] = React.useState(90);
    const [jiggleStep, setJiggleStep] = React.useState(-90);
    const [jiggleStrokeTime, setJiggleStrokeTime] = React.useState(0.4);
    const [jiggleError, setJiggleError] = React.useState(false);
    const wps = doc.waypoints;
    const isTank = drive === 'tank';
    const n = wps.length;
    const headingMode = isTank ? 'tangent' : (doc.headingMode || 'targets');
    const handlesEffective = plannerId !== 'labviewClothoid' && !(plannerId === 'labviewBezier' && doc.labview?.bezierTangentMode === 'automatic');
    const endpointJiggle = wps[n - 1] && wps[n - 1].jiggle;

    React.useEffect(() => {
      if (!endpointJiggle) return;
      setJiggleDistance(endpointJiggle.distanceM);
      setJiggleStrokes(endpointJiggle.strokes);
      setJiggleStart(endpointJiggle.startDeg);
      setJiggleStep(endpointJiggle.stepDeg);
      setJiggleStrokeTime(endpointJiggle.strokeTimeS);
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
      icon = 'waypoint'; title = wpName(i, n); tag = isAnchor ? 'anchor' : null;
      body = h(React.Fragment, null,
        h('div', { className: 'grid2' },
          h(Num, { label: 'X', value: w.x, unit: 'm', onChange: (v) => actions.setWp(i, { x: v }) }),
          h(Num, { label: 'Y', value: w.y, unit: 'm', onChange: (v) => actions.setWp(i, { y: v }) })),

        // Heading — mode-aware
        h('div', { className: 'fieldlabel' }, 'Heading \u03b8'),
        isTank
          ? h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Tank \u2014 heading follows the path tangent.')
          : waypointHeadingMode === 'lookAt'
            ? h('div', { className: 'hint' }, h(Icon, { name: 'compass', size: 14 }), 'This segment continuously faces its tracked field point. Select the segment to edit or drag it.')
          : waypointHeadingMode === 'tangent'
            ? h(React.Fragment, null,
                h('div', { className: 'hint' }, h(Icon, { name: 'compass', size: 14 }), 'This segment follows the path tangent. Set a manual heading to override only this segment.'),
                h('button', { className: 'qbtn wide', type: 'button', style: { marginTop: '4px' }, onClick: () => { actions.setSegmentHeadingMode(headingSegment, 'manual'); actions.faceWaypoint(i, 'tangent'); } }, h(Icon, { name: 'compass', size: 14 }), 'Set manual heading on segment'))
