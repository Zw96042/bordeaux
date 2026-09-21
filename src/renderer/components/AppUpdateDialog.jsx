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
    const clean = line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
    if (/^#{1,6}\s/.test(clean)) blocks.push({ kind: 'heading', text: clean.replace(/^#+\s*/, '') });
    else if (/^\s*(?:[-*]|\d+\.)\s/.test(clean)) blocks.push({ kind: 'item', text: clean.replace(/^\s*(?:[-*]|\d+\.)\s*/, '') });
    else blocks.push({ kind: 'paragraph', text: clean });
  }
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}
function noteInline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) =>
    /^`[^`]+`$/.test(part) ? h('code', { key: index }, part.slice(1, -1))
      : /^\*\*[^*]+\*\*$/.test(part) ? h('strong', { key: index }, part.slice(2, -2)) : part);
}
function noteContent(blocks) {
  const content = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind === 'item') {
      const items = [h('li', { key: index }, noteInline(block.text))];
      while (blocks[index + 1]?.kind === 'item') {
        index += 1;
        items.push(h('li', { key: index }, noteInline(blocks[index].text)));
      }
      content.push(h('ul', { key: index }, items));
    } else content.push(h(block.kind === 'heading' ? 'h4' : block.kind === 'code' ? 'pre' : 'p',
      { key: index }, block.kind === 'code' ? block.text : noteInline(block.text)));
  }
  return content;
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
  const { phase, version, currentVersion, progress, error } = state;
  const stalled = phase === 'installing' && state.installStalled;
  const busy = !stalled && ['checking', 'downloading', 'installing'].includes(phase);
  const title = stalled ? 'Restart is taking longer than expected' : ({ available: 'An update is available', downloading: 'Download in progress', downloaded: 'Ready to install', upToDate: 'You’re up to date', error: 'Update interrupted', unsupported: 'Manual update available', installing: 'Restarting Bordeaux' })[phase] || 'Bordeaux';
  const subtitle = stalled ? 'You can close this panel. If Bordeaux does not restart, save your work and install the update from All releases.' : phase === 'error' ? error : phase === 'unsupported' ? 'Download an installer from the official releases page.' : '';
  const notes = releaseNoteBlocks(state.releaseNotes);
  const percent = Number.isFinite(progress?.percent) ? Math.min(100, Math.max(0, progress.percent)) : null;
  const close = () => { if (phase !== 'installing' || stalled) onClose?.(); };
  const action = stalled ? { label: 'Close', onClick: close } : phase === 'downloading' ? { label: 'Cancel download', onClick: onCancel }
    : phase === 'downloaded' ? { label: 'Restart and install', onClick: onInstall }
    : phase === 'available' ? { label: 'Download update', onClick: onDownload }
    : phase === 'error' ? {
        label: state.errorStage === 'install' ? 'Retry install' : state.errorStage === 'download' ? 'Retry download' : 'Try again',
        onClick: state.errorStage === 'install' ? onInstall : state.errorStage === 'download' ? onDownload : onCheck,
      }
    : phase === 'upToDate' || phase === 'unsupported' ? { label: 'Done', onClick: close }
    : !busy ? { label: 'Check for updates', onClick: onCheck } : null;
  return h('dialog', { ref: dialog, className: 'app-update-dialog', 'aria-labelledby': 'app-update-title', onCancel: (event) => { event.preventDefault(); close(); } },
    h('header', { className: 'app-update-header' },
      h('h2', { id: 'app-update-title' }, 'Software updates'),
      h('button', { type: 'button', className: 'app-update-close', 'aria-label': 'Close updates', disabled: phase === 'installing' && !stalled, onClick: close }, '×')),
    h('div', { className: 'app-update-summary' },
      h('div', { className: 'app-update-status-row' },
        h('p', { className: 'app-update-status', role: phase === 'error' ? undefined : 'status' }, title),
        h('span', { className: 'app-update-versions' }, `Installed ${currentVersion || '—'}`)),
      !busy && subtitle && h('p', { className: 'app-update-description', role: phase === 'error' ? 'alert' : undefined }, subtitle),
      busy && h('div', { className: 'app-update-transfer', 'aria-busy': true },
        h('progress', { max: 100, value: phase === 'downloading' && percent != null ? percent : undefined, 'aria-label': phase === 'downloading' ? 'Update download' : phase === 'checking' ? 'Checking for updates' : 'Installing update' }),
        phase === 'downloading' && h('div', { className: 'app-update-transfer-values' }, h('span', null, `${updateBytes(progress?.transferred)} of ${updateBytes(progress?.total)}`), h('span', null, percent == null ? '' : `${Math.round(percent)}%`), h('span', null, progress?.bytesPerSecond > 0 ? `${updateBytes(progress.bytesPerSecond)}/s` : '')))),
    h('section', { className: 'app-update-notes', 'aria-label': 'Release notes', tabIndex: 0 },
      h('div', { className: 'app-update-notes-heading' }, h('h3', null, 'Release notes'), h('span', null, version || currentVersion)),
      notes.length ? noteContent(notes) : phase !== 'checking' && h('p', { className: 'app-update-empty' }, 'No release notes available.')),
    h('footer', { className: 'app-update-footer' },
      h('div', { className: 'app-update-secondary' }, h('button', { type: 'button', onClick: onOpenReleases }, 'All releases'),
        phase === 'upToDate' && h('button', { type: 'button', onClick: onCheck }, 'Check again'),
        phase === 'error' && h('button', { type: 'button', onClick: async () => { await onCopyDetails?.(); setCopied(true); } }, copied ? 'Copied' : 'Copy details')),
      action && h('button', {
        type: 'button', className: phase === 'downloading' ? undefined : 'app-update-action', onClick: action.onClick, disabled: action.disabled,
      }, action.label)));
}
