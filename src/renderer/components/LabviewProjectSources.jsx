import * as React from "react";

const h = React.createElement;

export function LabviewCommandInspection({ catalog, onInspect, operation }) {
  const inspection = catalog.labviewDiscovery && catalog.labviewDiscovery.inspection;
  const windows = typeof window !== 'undefined' && window.bordeauxAPI && window.bordeauxAPI.platform === 'win32';
  return h('div', { className: 'labview-inspection' },
    h('button', { className: 'cmd-primary-action', type: 'button', disabled: !!operation || !onInspect || !windows, onClick: onInspect },
      operation === 'inspect' ? 'Inspecting LabVIEW commands…' : 'Inspect commands in LabVIEW'),
    h('p', { className: 'seg-hint' }, windows
      ? 'Reads connector inputs and saved defaults from the open LabVIEW project.'
      : 'Inspect on Windows with LabVIEW. Saved connector types remain available on this Mac.'),
    inspection && h('p', { className: 'seg-hint', role: 'status' }, inspection.reason ||
      (inspection.commandCount + ' LabVIEW command' + (inspection.commandCount === 1 ? '' : 's') + ' inspected.')),
    inspection && inspection.unsupported.length > 0 && h('details', { className: 'labview-source-warnings' },
      h('summary', null, inspection.unsupported.length + ' unsupported source' + (inspection.unsupported.length === 1 ? '' : 's')),
      h('div', { className: 'source-warning-list' }, inspection.unsupported.map((item) => h('p', { key: item.target + ':' + item.file },
        h('strong', null, item.file), ', ' + item.target, h('div', null, item.reason))))));
}

/** Project membership is useful evidence, but does not establish a VI's connector contract. */
export function LabviewProjectSources({ catalog }) {
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(40);
  const discovery = catalog && catalog.labviewDiscovery;
  if (!discovery) return null;
  const search = query.trim().toLowerCase();
  const sources = discovery.items.filter((item) => item.file || item.status !== 'present');
  const matches = sources.filter((item) => [item.name, item.target, item.file, item.type, item.reason].filter(Boolean).join(' ').toLowerCase().includes(search));
  const warnings = catalog.warnings || [];
  return h('details', { className: 'labview-sources' },
    h('summary', null, 'Project sources, ' + discovery.viCount + ' VIs'),
    h('p', { className: 'seg-hint' }, 'Inspect VI connectors to discover command parameters.'),
    h('p', { className: 'labview-source-meta' }, discovery.projectFile + ', ' + discovery.targets.map((target) => target.name).join(', ')),
    h('label', { className: 'fieldlabel' }, 'Find a project source',
      h('input', { className: 'textinput', type: 'search', value: query, placeholder: 'Name, folder, or target',
        onChange: (event) => { setQuery(event.target.value); setLimit(40); },
        onKeyDown: (event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); setLimit(40); } },
      })),
    h('div', { className: 'labview-source-list', tabIndex: 0, role: 'region', 'aria-label': 'LabVIEW project sources' },
      matches.slice(0, limit).map((item) => h('div', { className: 'labview-source-row', key: item.target + ':' + item.projectPath + ':' + item.file },
        h('strong', null, item.name),
        h('span', { className: 'labview-source-meta' }, item.target + ', ' + (item.file || item.projectPath)),
        item.status !== 'present' && h('span', { className: 'cmd-project-warning' }, item.reason || item.status))),
      !matches.length && h('p', { className: 'seg-hint' }, sources.length ? 'No sources match this search.' : 'This project has no file references.')),
    matches.length > limit && h('button', { className: 'morebtn', type: 'button', onClick: () => setLimit(limit + 40) }, 'Show more sources (' + (matches.length - limit) + ' remaining)'),
    discovery.truncated && h('p', { className: 'cmd-project-warning' }, 'The project exceeded discovery limits. Some sources are not shown.'),
    warnings.length > 0 && h('details', { className: 'labview-source-warnings' },
      h('summary', null, warnings.length + ' discovery warning' + (warnings.length === 1 ? '' : 's')),
      h('div', { className: 'source-warning-list' }, warnings.map((warning, index) => h('p', { key: index }, warning)))));
}
