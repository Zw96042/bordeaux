import * as React from 'react';

const h = React.createElement;
const button = (label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, label);
const detail = (label, value) => h('div', { key: label }, h('dt', null, label), h('dd', null, value));

export function RobotFilePushDialog({ controller: c }) {
  const dialog = React.useRef(null);
  React.useEffect(() => {
    if (c.open && !dialog.current.open) dialog.current.showModal();
    else if (!c.open && dialog.current.open) dialog.current.close();
  }, [c.open]);
  const identity = c.probe && ['identity', 'trusting'].includes(c.phase);
  const review = c.phase === 'review' && c.preview;
  const outcome = ['transferred', 'failed', 'cancelled', 'unsupported'].includes(c.phase);
  const endpoint = c.preview?.connection.endpoint || c.connection?.endpoint;
  const title = identity ? 'Verify SSH identity' : review ? 'Review path upload' : c.phase === 'transferred' ? 'Files uploaded and verified' : 'Robot files';
  return h('dialog', { ref: dialog, className: 'robot-push-dialog robot-manager', style: { overflowWrap: 'anywhere' }, 'aria-labelledby': 'robot-file-title', onCancel: (event) => { event.preventDefault(); c.close(); } },
    h('header', null, h('h2', { id: 'robot-file-title' }, title), button('×', c.close, { className: 'robot-push-close', 'aria-label': 'Close robot files' })),
    c.error && h('p', { className: 'robot-push-alert', role: 'alert' }, c.error),
    !c.connection && !identity && ['idle', 'probing'].includes(c.phase) && h('section', { className: 'robot-push-section' },
      h('p', null, 'Upload BDX path files directly with SFTP over SSH.'),
      h('div', { className: 'robot-push-endpoint' },
        h('label', null, 'Robot host', h('input', { value: c.host, autoComplete: 'off', placeholder: 'roborio-2468-frc.local', disabled: c.busy, onChange: (e) => c.setHost(e.target.value) })),
        h('label', null, 'Port', h('input', { value: c.port, inputMode: 'numeric', disabled: c.busy, onChange: (e) => c.setPort(e.target.value) }))),
      h('div', { className: 'robot-push-endpoint' }, h('label', null, 'Destination directory', h('input', { value: c.directory, disabled: c.busy, onChange: (e) => c.setDirectory(e.target.value) }))),
      h('div', { className: 'robot-push-actions' }, button(c.busy ? 'Connecting…' : 'Connect', c.probeRobot, { className: 'primary', disabled: c.busy || !c.host.trim() || !c.directory.trim() || !/^\d+$/.test(c.port) || Number(c.port) < 1 || Number(c.port) > 65535 }))),
    identity && h('section', { className: 'robot-push-section', 'aria-busy': c.busy },
      h('p', null, 'Check this SSH host key against the robot you intend to trust.'),
      h('dl', { className: 'robot-push-details compact' }, detail('Address', c.probe.endpoint.host + ':' + c.probe.endpoint.port), detail('SSH host key', c.probe.hostKeyFingerprint), detail('Directory', c.probe.endpoint.directory)),
      h('div', { className: 'robot-push-actions' }, button('Back', c.chooseAnotherRobot, { disabled: c.busy }), button(c.busy ? 'Trusting…' : 'Trust SSH identity', c.confirmPairing, { className: 'primary', disabled: c.busy }))),
    c.connection && c.phase === 'idle' && h('section', { className: 'robot-push-section' },
      h('dl', { className: 'robot-push-details compact' }, detail('Address', endpoint.host + ':' + endpoint.port), detail('Directory', endpoint.directory)),
      h('p', null, 'Select paths in the library and choose Push to review their files.'),
      h('div', { className: 'robot-push-actions' }, button('Edit connection', c.chooseAnotherRobot))),
    review && h('section', { className: 'robot-push-section' },
      h('dl', { className: 'robot-push-details compact' }, detail('Send to', endpoint.host + ':' + endpoint.port), detail('Directory', endpoint.directory)),
      h('ul', { className: 'robot-retention-list' }, c.preview.files.map((file) => h('li', { key: file.pathId }, h('div', { style: { minWidth: 0 } }, h('strong', null, file.name), h('p', null, file.fileName + ' · ' + file.size.toLocaleString() + ' bytes'))))),
      h('p', null, 'These reviewed files are fixed. Upload replaces files with the same names and leaves other files in the directory unchanged.'),
      h('p', null, 'Uploading does not activate a routine or start robot execution.'),
      h('div', { className: 'robot-push-actions' }, button('Cancel', c.cancel), button('Upload ' + c.preview.files.length + (c.preview.files.length === 1 ? ' path' : ' paths'), c.confirmPush, { className: 'primary', disabled: c.busy }))),
    ['loading', 'preparing', 'uploading'].includes(c.phase) && h('section', { className: 'robot-push-status', role: 'status' },
      h('strong', null, c.phase === 'uploading' ? 'Uploading and verifying files…' : c.phase === 'loading' ? 'Loading saved connection…' : 'Preparing selected path files…'),
      c.phase === 'uploading' && button('Cancel upload', c.cancel)),
    outcome && h('section', { className: 'robot-push-section' },
      c.phase === 'transferred' ? h('div', { role: 'status' }, h('p', null, c.result.files.length + ' path files uploaded and verified in ' + c.result.directory + '.'), h('p', null, 'This confirms the stored files. It does not activate a routine or start robot execution.'))
        : c.phase === 'cancelled' ? h('p', null, 'Upload canceled before sending.') : c.phase === 'failed' ? h('p', null, 'Upload did not complete. Some files may have transferred; review before retrying.') : null,
      h('div', { className: 'robot-push-actions' }, button('Connection', c.connectionHome), c.phase === 'failed' && button('Review current edits', c.retry))),
    !review && !c.busy && h('div', { className: 'robot-connection-diagnostics' }));
}
