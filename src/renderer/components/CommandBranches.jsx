import * as React from 'react';
import { AUTO } from '../lib/routineModel';
import { CommandParameterEditor } from './ContextInspector';
import { UI } from './ui';

const h = React.createElement;
const { Dropdown } = UI;
const operators = [
  ['eq', 'Equals'], ['neq', 'Does not equal'], ['lt', 'Less than'],
  ['lte', 'At most'], ['gt', 'Greater than'], ['gte', 'At least'],
].map(([value, label]) => ({ value, label }));

export function CommandBranches({ node, command, set, acq }) {
  const branch = node.outputBranch;
  const outputs = AUTO.branchOutputs(command);
  const current = outputs.find((output) => output.name === branch?.output);
  const changed = branch && current && JSON.stringify(current.schema) !== JSON.stringify(branch.schema);
  const populated = branch?.routes.some((route) => route.nodes.length);
  const replace = (value) => {
    if (value === branch?.output && !changed) return;
    if (populated && !confirm('Changing the branch output removes its branch steps. Continue?')) return;
    const output = outputs.find((item) => item.name === value);
    set({ outputBranch: output ? AUTO.newOutputBranch(output) : undefined });
  };
  const patchRoute = (id, patch) => set({ outputBranch: { ...branch,
    routes: branch.routes.map((route) => route.id === id ? { ...route, ...patch } : route) } });
  const numeric = branch && !['boolean', 'enum'].includes(branch.schema.kind);
  return h('section', { className: 'command-branches', 'aria-label': 'Command output branches' },
    h('div', { className: 'fieldlabel' }, 'After command completes'),
    h(Dropdown, { id: 'command-branch-output', label: 'Branch on output', value: branch?.output || '',
      items: [{ value: '', label: 'Continue to next step' },
        ...(branch && !current ? [{ value: branch.output, label: branch.output, meta: 'Output unavailable — sync commands or choose another output', badge: 'Missing' }] : []),
        ...outputs.map((output) => ({ value: output.name, label: output.label || output.name, meta: output.schema.kind === 'enum' ? 'Named outcomes' : output.schema.kind }))],
      onChange: replace }),
    !branch && !outputs.length && h('p', { className: 'seg-hint' }, 'Sync a command with boolean, named, or numeric outputs to add branches.'),
    branch && h(React.Fragment, null,
      h('p', { className: 'seg-hint' }, 'Preview only. Output branches can be saved locally; robot execution and routine export are not available yet.'),
      (!current || changed) && h('div', { className: 'cmd-project-error', role: 'status' },
        changed ? 'This output’s type changed. Rebuild its routes before using it.' : 'The saved output is missing from this command. Its routes are preserved.',
        changed && h('button', { type: 'button', className: 'rt-openbtn', onClick: () => replace(branch.output) }, 'Rebuild routes')),
      h('p', { className: 'seg-hint' }, numeric
        ? 'Checks run top to bottom. The first match wins; Otherwise handles the rest. Each route rejoins the next step.'
        : 'Add steps beneath each route in the routine. Each route rejoins the next step.'),
      branch.routes.map((route, index) => h('div', { key: route.id, className: 'command-branch-route' },
        h('label', { className: 'fieldlabel', htmlFor: 'route-label-' + route.id }, `${index + 1}. ${AUTO.routeSummary(route)}`),
        h('input', { id: 'route-label-' + route.id, className: 'textinput', 'aria-label': 'Branch name ' + (index + 1), value: route.label,
          onChange: (event) => patchRoute(route.id, { label: event.target.value }) }),
        numeric && route.operator !== 'otherwise' && h(React.Fragment, null,
          h(Dropdown, { id: 'route-operator-' + route.id, label: 'Comparison ' + (index + 1), value: route.operator, items: operators, onChange: (operator) => patchRoute(route.id, { operator }) }),
          h(CommandParameterEditor, { id: 'route-value-' + route.id, label: 'Value ' + (index + 1), schema: branch.schema,
            value: route.value, parameter: current || {}, onChange: (value) => patchRoute(route.id, { value }) }),
          h('div', { className: 'command-branch-actions' },
            h('button', { type: 'button', className: 'rt-openbtn', disabled: index === 0, onClick: () => {
              const routes = [...branch.routes];
              [routes[index - 1], routes[index]] = [routes[index], routes[index - 1]];
              set({ outputBranch: { ...branch, routes } });
            } }, 'Check earlier'),
            h('button', { type: 'button', className: 'rt-openbtn', disabled: branch.routes.length <= 2, onClick: () => {
              if (route.nodes.length && !confirm('Remove this comparison and all of its branch steps?')) return;
              set({ outputBranch: { ...branch, routes: branch.routes.filter((item) => item.id !== route.id) } });
            } }, 'Remove comparison'))))),
      numeric && h('button', { type: 'button', className: 'rt-openbtn', disabled: branch.routes.length >= 256, onClick: () => {
        const added = AUTO.newOutputBranch({ name: branch.output, schema: branch.schema }).routes[0];
        set({ outputBranch: { ...branch, routes: [...branch.routes.slice(0, -1), added, branch.routes.at(-1)] } });
      } }, 'Add comparison'),
      h(Dropdown, { id: 'command-preview-route', label: 'Preview route', value: AUTO.selectedBranch(node, acq.outcomes)?.id,
        items: branch.routes.map((route) => ({ value: route.id, label: route.label || AUTO.routeSummary(route), meta: AUTO.routeSummary(route) })),
        onChange: (id) => acq.setOutcome(node.id, id) })));
}
