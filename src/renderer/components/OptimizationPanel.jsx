import * as React from 'react';
import { UI } from './ui';

const h = React.createElement;
const seconds = (value) => Number.isFinite(value) ? `${value.toFixed(2)} s` : '—';

export function OptimizationPanel({ path, paths, state, candidate, accepted, stale, baselineTime, pending, error, recovery, mode,
  unitSystem, onCorridor, onStart, onStartAll, onCancel, onCompare, onApply, onNormal, onSelectPath, onClose }) {
  const entry = state.paths[path.id];
  // The controller runs one job at a time; only its searching entry owns progress.
  const activePathId = state.running ? Object.keys(state.paths).find((id) => state.paths[id].status === 'searching') : null;
  const searchingCurrentPath = activePathId === path.id;
  const backgroundPath = activePathId && !searchingCurrentPath
    ? paths.find((item) => item.id === activePathId) : null;
  const result = candidate?.finalTrajectory;
  const details = result?.optimization;
  const baseTime = baselineTime ?? details?.baselineTimeS;
  const gain = result && Number.isFinite(baseTime) ? baseTime - result.totalTimeS : 0;
  const improved = result && gain >= Math.max(0.02, baseTime * 0.005) - 1e-8;
  // Equal duration alone does not mean the same route is applied.
  const alreadyApplied = React.useMemo(() => Boolean(accepted && result && accepted.totalTimeS === result.totalTimeS
    && JSON.stringify([accepted.samples, accepted.optimizedPath, accepted.stationaryActions, accepted.markers])
      === JSON.stringify([result.samples, result.optimizedPath, result.stationaryActions, result.markers])), [accepted, result]);
  const newCandidate = improved && !alreadyApplied;
  const distance = (value) => `${(value * (unitSystem === 'imperial' ? 3.280839895 : 1)).toFixed(2)} ${unitSystem === 'imperial' ? 'ft' : 'm'}`;
  const outcome = searchingCurrentPath ? 'Find a faster path'
    : improved ? `${seconds(gain)} faster, ${(gain / baseTime * 100).toFixed(1)}%`
    : stale ? 'Needs update'
    : details?.termination === 'unsupported' ? 'Normal only'
    : result ? 'No meaningful gain'
    : entry?.status === 'failure' ? 'Couldn’t optimize'
    : entry?.status === 'timeout' ? 'Search timed out'
    : entry?.status === 'canceled' ? 'Search canceled'
    : accepted ? 'Optimization applied' : 'Find a faster path';
  const row = (label, time, value, applied, disabled = false) => h('button', {
    key: value, type: 'button', className: 'optimizer-choice', disabled,
    'aria-label': `Preview ${label.toLowerCase()} trajectory`,
    'aria-pressed': mode === value || (mode === 'selected' && value === 'normal' && !accepted),
    onClick: () => onCompare(value),
  }, h('span', { className: 'optimizer-choice-name' }, label, applied && h('small', null, 'In use')),
  h('b', null, seconds(time)));
  const terminationLabel = { completed: 'Finished', 'work-budget': 'Search complete', 'time-budget': 'Time limit reached', cancelled: 'Canceled', unsupported: 'Unsupported path' }[details?.termination];
  return h('section', { className: 'optimizer-panel', 'aria-label': 'Path optimization' },
    h('div', { className: 'optimizer-heading' }, h('strong', null, 'Optimize'),
      h(UI.IconBtn, { icon: 'x', title: 'Close optimization', onClick: onClose })),
    h('div', { className: 'optimizer-body' },
      backgroundPath && h('div', { className: 'optimizer-background', role: 'status' },
        h('span', null, 'Search in progress', h('strong', null, backgroundPath.name)),
        h('button', { type: 'button', onClick: onCancel,
          'aria-label': state.batch ? 'Cancel all optimization searches' : `Cancel optimization for ${backgroundPath.name}` },
        state.batch ? 'Cancel all' : 'Cancel search')),
      error ? h(React.Fragment, null,
      h('p', { className: 'optimizer-failure', role: 'alert' }, 'Couldn’t plan this path. ', error.message || String(error)),
      h('button', { type: 'button', className: 'optimizer-main', onClick: recovery?.onClick || onClose }, recovery?.label || 'Edit path')) : h(React.Fragment, null,
      h('div', { className: 'optimizer-status', 'aria-busy': pending || searchingCurrentPath },
        h('p', { className: 'optimizer-outcome' + (improved && !searchingCurrentPath ? ' gain' : ''), role: 'status' }, outcome),
        (pending || searchingCurrentPath) && h('progress', { className: 'optimizer-progress', 'aria-label': searchingCurrentPath ? 'Optimizing path' : 'Preparing path' })),
      h('div', { className: 'optimizer-comparison', 'aria-label': 'Trajectory comparison' },
        h('div', { className: 'optimizer-label' }, 'Preview'),
        row('Normal', baseTime, 'normal', !accepted && !stale, pending),
        accepted && row(newCandidate ? 'Applied' : 'Optimized', accepted.totalTimeS, 'selected', true),
        newCandidate && row('Optimized', result.totalTimeS, 'candidate', false)),
      searchingCurrentPath ? h('button', { type: 'button', className: 'optimizer-main', onClick: onCancel }, 'Cancel')
        : newCandidate ? h('button', { type: 'button', className: 'optimizer-main primary', onClick: onApply }, 'Apply optimized')
        : accepted && !stale ? h('button', { type: 'button', className: 'optimizer-main', disabled: true }, 'Applied')
        : h('button', { type: 'button', className: 'optimizer-main primary', disabled: pending || state.running, onClick: () => onStart('common') },
          stale ? 'Update optimization' : entry ? 'Try again' : 'Optimize'),
      (accepted || stale) && h('button', { type: 'button', className: 'optimizer-reset', onClick: onNormal }, 'Use normal'),
      h('details', { className: 'optimizer-settings', key: `settings-${path.id}` },
        h('summary', null, 'Search settings', h('span', null, distance(path.optimization?.corridorM ?? 0.15))),
        h('div', { className: 'optimizer-corridor' },
          h(UI.Num, { value: path.optimization?.corridorM ?? 0.15, min: 0.03, max: 1.5,
            step: 0.01, unit: 'm', label: 'Path freedom', onChange: onCorridor })),
        h('p', { className: 'optimizer-help' }, 'Waypoints and headings stay fixed.'),
        h('div', { className: 'optimizer-search-actions' },
          h('button', { type: 'button', disabled: pending || state.running, onClick: () => onStart('common') }, 'Quick search', h('small', null, '5 s')),
          h('button', { type: 'button', disabled: pending || state.running, onClick: () => onStart('stress') }, 'Search deeper', h('small', null, '15 s')),
          h('button', { type: 'button', disabled: pending || state.running, onClick: onStartAll }, 'Optimize all'))),
      (details || entry?.error) && h('details', { className: 'optimizer-details', key: `details-${path.id}` },
        h('summary', null, 'Details'),
        h('dl', null,
          result && h(React.Fragment, null, h('dt', null, 'Path shift'), h('dd', null, distance(details?.maxDeviationM || 0))),
          terminationLabel && h(React.Fragment, null, h('dt', null, 'Search'), h('dd', null, terminationLabel)),
          details && h(React.Fragment, null, h('dt', null, 'Candidates'), h('dd', null, `${details.evaluations || 0} checked`))),
        details?.activeConstraints?.length > 0 && h('p', null, 'Limited by ', [...new Set(details.activeConstraints)].map((name) => name.replaceAll('-', ' ')).join(', ')),
        details?.fallbackReason && h('p', null, details.fallbackReason),
        entry?.error && h('p', { className: 'optimizer-error' }, entry.error),
        details?.rejectionReasons?.length > 0 && h('ul', null, details.rejectionReasons.map((item) => h('li', { key: item.reason }, `${item.reason}: ${item.count}`)))),
      state.batch && h('details', { className: 'optimizer-batch', open: true },
        h('summary', null, `${state.batch.completed} of ${state.batch.total} paths searched`),
        h('div', null, paths.map((item) => h('button', { key: item.id, type: 'button', onClick: () => onSelectPath(item.id) },
          h('span', null, item.name), h('small', null, state.paths[item.id]?.status === 'success' ? 'Ready' : state.paths[item.id]?.status || 'Queued'))))))));
}
