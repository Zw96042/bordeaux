import * as React from 'react';

const h = React.createElement;

export function RoutineWorkspace({ routine, flow, field, transport, status }) {
  const [view, setView] = React.useState('flow');
  React.useEffect(() => setView('flow'), [routine.id]);

  return h('section', { className: 'routine-workspace', 'aria-label': 'Routine workspace' },
    h('header', { className: 'routine-workspace-head' },
      h('div', { className: 'routine-workspace-title' },
        h('span', null, 'Routine'),
        h('strong', { title: routine.name }, routine.name)),
      h('div', { className: 'routine-workspace-views', role: 'group', 'aria-label': 'Routine view' },
        h('button', { type: 'button', 'aria-pressed': view === 'flow', onClick: () => setView('flow') }, 'Flow'),
        h('button', { type: 'button', 'aria-pressed': view === 'field', onClick: () => setView('field') }, 'Field preview'))),
    h('div', { className: 'routine-workspace-body' },
      h('div', { className: 'routine-workspace-flow', hidden: view !== 'flow', 'aria-label': 'Routine flow' }, flow),
      h('div', { className: 'fieldcol routine-workspace-field', hidden: view !== 'field', 'aria-label': 'Routine field preview' }, field)),
    status,
    h('div', { className: 'routine-workspace-transport' }, transport));
}
