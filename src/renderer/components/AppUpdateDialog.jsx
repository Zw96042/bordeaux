import * as React from 'react';
import '../styles/app-update.css';

const h = React.createElement;
export function releaseNoteBlocks(text = '') {
  const blocks = [];
  let code = null;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (/^```/.test(line)) { if (code) { blocks.push({ kind: 'code', text: code.join('\n') }); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; }
    if (!line.trim()) continue;
    const clean = line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
    if (/^#{1,6}\s/.test(clean)) blocks.push({ kind: 'heading', text: clean.replace(/^#+\s*/, '') });
    else if (/^\s*(?:[-*]|\d+\.)\s/.test(clean)) blocks.push({ kind: 'item', text: clean.replace(/^\s*(?:[-*]|\d+\.)\s*/, '') });
    else blocks.push({ kind: 'paragraph', text: clean });
  }
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}
export const updateBytes = (bytes) => Number.isFinite(bytes) && bytes >= 0 ? `${(bytes / 1048576).toFixed(1)} MB` : '—';

export function AppUpdateDialog({ state, onClose, onCheck, onDownload, onCancel, onInstall, onOpenReleases, onCopyDetails }) {
  const dialog = React.useRef(null), returnFocus = React.useRef(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (state?.visible && !node.open) { returnFocus.current = document.activeElement; setCopied(false); node.showModal(); }
    else if (!state?.visible && node.open) { node.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }
  }, [state?.visible]);
  if (!state) return null;
  const { phase, version, currentVersion, progress, projectDirty, error } = state;
  const busy = ['checking', 'downloading', 'installing'].includes(phase);
  const title = ({ available: 'An update is available', downloading: 'Download in progress', downloaded: 'Ready to install', upToDate: 'You’re up to date', error: 'Update interrupted', unsupported: 'Manual update available', installing: 'Restarting Bordeaux' })[phase] || 'Software updates';
  const subtitle = ({ available: 'Review what’s new before downloading.', downloading: 'Keep working while the update downloads.', downloaded: projectDirty ? 'Save your project before restarting to install.' : 'Restart Bordeaux to finish installing the update.', checking: 'Looking for a new version.', upToDate: 'You have the latest version on this channel.', unsupported: 'Download an installer from the official releases page.', installing: 'Your update is ready. Bordeaux will reopen shortly.' })[phase] || (phase === 'error' ? error : 'Keep Bordeaux up to date.');
  const notes = releaseNoteBlocks(state.releaseNotes);
  const percent = Number.isFinite(progress?.percent) ? Math.min(100, Math.max(0, progress.percent)) : null;
  const close = () => { if (phase !== 'installing') onClose?.(); };
  return h('dialog', { ref: dialog, className: 'app-update-dialog', 'aria-labelledby': 'app-update-title', onCancel: (event) => { event.preventDefault(); close(); } },
    h('header', { className: 'app-update-header' }, h('div', null,
      h('div', { className: 'app-update-eyebrow' }, 'Bordeaux', h('span', null, state.channel === 'beta' ? 'Beta channel' : 'Stable channel')),
      h('h2', { id: 'app-update-title' }, title)),
      h('button', { type: 'button', className: 'app-update-close', 'aria-label': 'Close updates', disabled: phase === 'installing', onClick: close }, '×')),
    h('div', { className: 'app-update-summary' },
      h('p', { role: phase === 'error' ? 'alert' : 'status' }, subtitle),
      h('div', { className: 'app-update-versions' }, h('span', null, `Installed ${currentVersion || '—'}`), version && h('span', null, `Update ${version}`))),
    h('section', { className: 'app-update-notes', 'aria-label': 'Release notes', tabIndex: 0 },
      h('h3', null, 'What’s new'), notes.length ? notes.map((block, index) =>
        h(block.kind === 'heading' ? 'h4' : block.kind === 'code' ? 'pre' : 'p', { key: index, className: block.kind === 'item' ? 'app-update-note-item' : undefined }, block.text))
        : h('p', { className: 'app-update-empty' }, phase === 'checking' ? 'Release notes will appear here when an update is found.' : 'No release notes are available for this version.')),
    h('div', { className: 'app-update-transfer', 'aria-busy': busy },
      busy && h('progress', { max: 100, value: phase === 'downloading' && percent != null ? percent : undefined, 'aria-label': phase === 'downloading' ? 'Update download' : phase === 'checking' ? 'Checking for updates' : 'Installing update' }),
      phase === 'downloading' && h('div', { className: 'app-update-transfer-values' }, h('span', null, `${updateBytes(progress?.transferred)} of ${updateBytes(progress?.total)}`), h('span', null, percent == null ? '' : `${Math.round(percent)}%`), h('span', null, progress?.bytesPerSecond > 0 ? `${updateBytes(progress.bytesPerSecond)}/s` : ''))),
    h('footer', { className: 'app-update-footer' },
      h('div', { className: 'app-update-secondary' }, h('button', { type: 'button', onClick: onOpenReleases }, 'All releases'), phase === 'error' && h('button', { type: 'button', onClick: async () => { await onCopyDetails?.(); setCopied(true); } }, copied ? 'Copied' : 'Copy details')),
      h('div', { className: 'app-update-primary' }, phase === 'downloading' ? h('button', { type: 'button', onClick: onCancel }, 'Cancel download')
        : phase === 'downloaded' ? h('button', { type: 'button', className: 'primary', disabled: !!projectDirty, onClick: onInstall }, 'Restart and install')
        : phase === 'available' ? h('button', { type: 'button', className: 'primary', onClick: onDownload }, 'Download update')
        : phase === 'error' ? h('button', { type: 'button', className: 'primary', onClick: state.errorStage === 'install' ? onInstall : state.errorStage === 'download' ? onDownload : onCheck, disabled: state.errorStage === 'install' && !!projectDirty }, state.errorStage === 'install' ? 'Retry install' : state.errorStage === 'download' ? 'Retry download' : 'Try again')
        : !busy && phase !== 'unsupported' ? h('button', { type: 'button', className: 'primary', onClick: onCheck }, 'Check for updates') : null)));
}
