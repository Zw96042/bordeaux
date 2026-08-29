export function SharedWaypointPosition({ project, doc, index, onLink, onName }) {
  const waypoint = doc.waypoints[index];
  const [name, setName] = React.useState(waypoint.positionName || '');
  React.useEffect(() => setName(waypoint.positionName || ''), [doc.id, index, waypoint.positionName]);
  const { candidates, members } = sharedPositionChoices(project, doc.id, index);
  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== waypoint.positionName) { onName(index, trimmed); setName(trimmed); }
    else setName(waypoint.positionName || '');
  };
  return h('div', { className: 'shared-waypoint-position' },
    h('div', { className: 'inrow first' },
      h('span', { className: 'inrow-l' }, 'Linkable', h('small', null, 'Make this point available to other paths')),
      h(UI.Toggle, { on: !!waypoint.positionName, ariaLabel: 'Linkable waypoint', onChange: (on) => onName(index, on ? waypointName(index, doc.waypoints.length) : undefined) })),
    waypoint.positionName && h('label', { className: 'linkable-name' }, 'Point name',
      h('input', { className: 'textinput', 'aria-label': 'Linkable point name', maxLength: 80, value: name,
        onChange: (event) => setName(event.target.value), onBlur: saveName,
        onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.stopPropagation(); setName(waypoint.positionName); } } })),

    h(UI.Dropdown, { id: 'waypoint-position-link', label: 'Shared position', value: '',
      placeholder: candidates.length ? 'Use named point…' : 'No linkable points yet',
      items: candidates,
      disabled: !candidates.length,
      onChange: (value) => { const target = candidates.find((item) => item.value === value); if (target) onLink(index, target); } }),
    (waypoint.positionLink || members.length > 0) && h('div', { className: 'inrow' },
      h('span', { className: 'inrow-l', style: { minWidth: 0, overflowWrap: 'anywhere' }, title: members.map((item) => item.label).join('\n') },
        members.length ? members[0].label + (members.length > 1 ? ' + ' + (members.length - 1) + ' more' : '') : 'No other linked waypoints'),
      h('button', { type: 'button', className: 'btn', onClick: () => onLink(index, null) }, 'Unlink')),
    h('div', { className: 'seg-hint' }, members.length ? 'Linked position only. Heading and tangent stay local.' : 'Only named, linkable points appear here.'));
}
