import * as React from "react";
import { createPortal } from "react-dom";

const { useEffect, useRef, useState } = React;
const h = React.createElement;

function message(error) {
  return error && error.message ? error.message : String(error || 'The robot push failed');
}

function shortHash(value) {
  if (!value) return '—';
  return value.length > 24 ? value.slice(0, 19) + '…' + value.slice(-8) : value;
}

function revisionLabels(entry, status, localRevisionId) {
  const labels = [];
  if (entry.revisionId === status.activeRevisionId) labels.push('Active');
  if (entry.pinned) labels.push('Pinned');
  labels.push(entry.availability === 'retained' ? 'Retained on robot' : 'Missing on robot');
  if (entry.revisionId === localRevisionId) labels.push('Local current');
  return labels;
}

export function RobotPushDialog({ getProject }) {
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState(null);
  const [probe, setProbe] = useState(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [phase, setPhase] = useState('idle');
  const [preview, setPreview] = useState(null);
  const [retentionStatus, setRetentionStatus] = useState(null);
  const [localRevisionId, setLocalRevisionId] = useState(null);
  const [retentionPreview, setRetentionPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [toolbarTarget, setToolbarTarget] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    setToolbarTarget(document.querySelector('.toolbar .tb-right'));
  }, []);

  useEffect(() => {
    if (!window.bordeauxAPI || typeof window.bordeauxAPI.getRobotPairing !== 'function') return;
    window.bordeauxAPI.getRobotPairing().then((saved) => {
      setPairing(saved || null);
      if (saved) {
        setHost(saved.endpoint.host);
        setPort(String(saved.endpoint.port));
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.bordeauxAPI || typeof window.bordeauxAPI.onRobotPushState !== 'function') return undefined;
    return window.bordeauxAPI.onRobotPushState((progress) => {
      if (!preview || progress.operationId !== preview.operationId) return;
      setPhase(progress.state);
      if (progress.state === 'rejected') setResult(progress);
    });
  }, [preview]);

  useEffect(() => {
    if (!window.bordeauxAPI || typeof window.bordeauxAPI.onRobotRetentionState !== 'function') return undefined;
    return window.bordeauxAPI.onRobotRetentionState((progress) => {
      if (!retentionPreview || progress.operationId !== retentionPreview.operationId) return;
      setPhase(progress.state);
      if (progress.state === 'rejected') setResult(progress);
    });
  }, [retentionPreview]);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current && closeRef.current.focus();
    const onKey = (event) => {
      if (event.key === 'Escape' && !['preparing', 'retention-preparing', 'uploaded', 'staged'].includes(phase)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase]);

  const desktopAvailable = Boolean(window.bordeauxAPI && typeof window.bordeauxAPI.prepareRobotPush === 'function');
  const busy = ['probing', 'pairing', 'preparing', 'retention-preparing', 'uploading', 'uploaded', 'staged'].includes(phase);
  const canClose = !busy;

  const openDialog = () => {
    setOpen(true);
    setRetentionStatus(null); setLocalRevisionId(null);
    setError('');
    if (!pairing) setPhase('idle');
  };

  const probeRobot = async () => {
    if (!window.bordeauxAPI || typeof window.bordeauxAPI.probeRobot !== 'function') return;
    setPhase('probing'); setError(''); setProbe(null);
    try {
      const observed = await window.bordeauxAPI.probeRobot({ host: host.trim(), port: Number(port) });
      setProbe(observed); setPhase('pair-review');
    } catch (failure) {
      setPhase('idle'); setError(message(failure));
    }
  };

  const confirmPairing = async () => {
    if (!probe || !window.bordeauxAPI || typeof window.bordeauxAPI.confirmRobotPairing !== 'function') return;
    setPhase('pairing'); setError('');
    try {
      const saved = await window.bordeauxAPI.confirmRobotPairing(probe.hostKeyFingerprint, probe.status.runtimeId);
      setPairing(saved); setProbe(null); setRetentionStatus(null); setLocalRevisionId(null); setPhase('ready');
      inspectRetention(saved);
    } catch (failure) {
      setPhase('pair-review'); setError(message(failure));
    }
  };

  const inspectRetention = async (knownPairing = pairing) => {
    if (!knownPairing || !window.bordeauxAPI || typeof window.bordeauxAPI.inspectRobotRetention !== 'function') return;
    try {
      const inspected = await window.bordeauxAPI.inspectRobotRetention(getProject());
      setRetentionStatus(inspected.status);
      setLocalRevisionId(inspected.localRevisionId);
    } catch (failure) {
      setRetentionStatus(null); setLocalRevisionId(null); setError(message(failure));
    }
  };

  useEffect(() => {
    if (open && pairing) void inspectRetention();
  }, [open, pairing]);

  const preparePush = async () => {
    if (!desktopAvailable) return;
    setPhase('preparing'); setPreview(null); setResult(null); setError('');
    try {
      const reviewed = await window.bordeauxAPI.prepareRobotPush(getProject());
      setPreview(reviewed); setPhase('review');
    } catch (failure) {
      setPhase('ready'); setError(message(failure));
    }
  };

  const confirmPush = async () => {
    if (!preview || !window.bordeauxAPI) return;
    setPhase('uploading'); setResult(null); setError('');
    try {
      const finished = await window.bordeauxAPI.confirmRobotPush(preview.operationId);
      setResult(finished); setPhase(finished.state);
      if (finished.state === 'active') {
        setRetentionStatus(null); setLocalRevisionId(null); inspectRetention();
      }
    } catch (failure) {
      setPhase('failed'); setError(message(failure));
    }
  };

  const cancelPush = async () => {
    if (!preview || !window.bordeauxAPI || typeof window.bordeauxAPI.cancelRobotPush !== 'function') return;
    await window.bordeauxAPI.cancelRobotPush(preview.operationId).catch(() => undefined);
    setPhase('cancelled');
  };

  const prepareRetention = async (action, target) => {
    if (!window.bordeauxAPI || typeof window.bordeauxAPI.prepareRobotRetention !== 'function') return;
    setPhase('retention-preparing'); setRetentionPreview(null); setPreview(null); setResult(null); setError('');
    try {
      const reviewed = await window.bordeauxAPI.prepareRobotRetention(getProject(), action, target);
      setRetentionPreview(reviewed); setPhase('retention-review');
    } catch (failure) {
      setPhase('ready'); setError(message(failure));
    }
  };

  const confirmRetention = async () => {
    if (!retentionPreview || !window.bordeauxAPI) return;
    setPhase('uploading'); setResult(null); setError('');
    try {
      const finished = await window.bordeauxAPI.confirmRobotRetention(retentionPreview.operationId);
      setResult(finished); setPhase(finished.state);
      if (finished.state === 'active' || finished.state === 'pinned') {
        setRetentionStatus(null); setLocalRevisionId(null); inspectRetention();
      }
    } catch (failure) {
      setPhase('failed'); setError(message(failure));
    }
  };

  const cancelRetention = async () => {
    if (!retentionPreview || !window.bordeauxAPI || typeof window.bordeauxAPI.cancelRobotRetention !== 'function') return;
    await window.bordeauxAPI.cancelRobotRetention(retentionPreview.operationId).catch(() => undefined);
    setPhase('cancelled');
  };

  const chooseAnotherRobot = () => {
    setPairing(null); setProbe(null); setPreview(null); setRetentionStatus(null); setLocalRevisionId(null); setRetentionPreview(null); setResult(null); setError(''); setPhase('idle');
  };

  const trigger = h('button', { className: 'robot-push-trigger', type: 'button', onClick: openDialog, disabled: !desktopAvailable },
    h('span', { 'aria-hidden': true }, '⇧'), ' Push to Robot');

  return h(React.Fragment, null,
    toolbarTarget ? createPortal(trigger, toolbarTarget) : null,
    open && h('div', { className: 'robot-push-backdrop', onMouseDown: (event) => {
      if (event.target === event.currentTarget && canClose) setOpen(false);
    } },
      h('section', { className: 'robot-push-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'robot-push-title' },
        h('header', null,
          h('div', null, h('p', { className: 'robot-push-eyebrow' }, 'Explicit deployment'), h('h2', { id: 'robot-push-title' }, 'Push to Robot')),
          h('button', { ref: closeRef, className: 'robot-push-close', type: 'button', 'aria-label': 'Close robot push', disabled: !canClose, onClick: () => setOpen(false) }, '×')),
        h('p', { className: 'robot-push-intro' }, 'Saving never contacts the robot. This action reviews and sends one immutable revision over SFTP; the runtime activates it only while disabled.'),
        error && h('div', { className: 'robot-push-alert', role: 'alert' }, error),

        !pairing && phase !== 'pair-review' && h('div', { className: 'robot-push-section' },
          h('h3', null, 'Connect to a robot'),
          h('p', null, 'Use a pit USB or Ethernet connection, or another network where the robot exposes SSH/SFTP. Port 22 is unavailable on the FMS field network.'),
          h('div', { className: 'robot-push-endpoint' },
            h('label', null, h('span', null, 'Robot host'), h('input', { value: host, placeholder: 'roborio-2468-frc.local', autoComplete: 'off', spellCheck: false, onChange: (event) => setHost(event.target.value) })),
            h('label', null, h('span', null, 'Port'), h('input', { value: port, inputMode: 'numeric', onChange: (event) => setPort(event.target.value) }))),
          h('div', { className: 'robot-push-actions' }, h('button', { className: 'primary', type: 'button', disabled: phase === 'probing' || !host.trim(), onClick: probeRobot }, phase === 'probing' ? 'Probing…' : 'Probe Robot'))),

        probe && phase === 'pair-review' && h('div', { className: 'robot-push-section' },
          h('h3', null, 'Verify robot identity'),
          h('p', null, 'Confirm these identities against the robot you intend to trust. A future change to either identity requires pairing again.'),
          h('dl', { className: 'robot-push-details' },
            h('div', null, h('dt', null, 'Team'), h('dd', null, String(probe.status.teamNumber))),
            h('div', null, h('dt', null, 'SSH host key'), h('dd', { title: probe.hostKeyFingerprint }, probe.hostKeyFingerprint)),
            h('div', null, h('dt', null, 'Runtime identity'), h('dd', null, probe.status.runtimeId))),
          h('div', { className: 'robot-push-actions' },
            h('button', { type: 'button', onClick: chooseAnotherRobot }, 'Back'),
            h('button', { className: 'primary', type: 'button', disabled: phase === 'pairing', onClick: confirmPairing }, phase === 'pairing' ? 'Saving…' : 'Trust and Pair'))),

        pairing && !preview && !retentionPreview && !['preparing', 'retention-preparing'].includes(phase) && h('div', { className: 'robot-push-section' },
          h('h3', null, 'Paired robot'),
          h('dl', { className: 'robot-push-details compact' },
            h('div', null, h('dt', null, 'Robot'), h('dd', null, 'Team ' + pairing.teamNumber)),
            h('div', null, h('dt', null, 'Endpoint'), h('dd', null, pairing.endpoint.host + ':' + pairing.endpoint.port)),
            h('div', null, h('dt', null, 'Runtime'), h('dd', { title: pairing.runtimeId }, shortHash(pairing.runtimeId)))),
          h('div', { className: 'robot-retention' },
            h('h3', null, 'Revision history'),
            !retentionStatus && h('p', null, 'Inspect the paired runtime to check whether it reports revision retention.'),
            retentionStatus && !retentionStatus.retention && h('p', null, 'This paired runtime does not report revision retention support.'),
            retentionStatus && retentionStatus.retention && h(React.Fragment, null,
              h('p', null, 'The robot retains its five newest accepted revisions and may keep one older pinned revision.'),
              h('ul', { className: 'robot-retention-list' }, retentionStatus.retention.revisions.map((entry) =>
                h('li', { key: entry.revisionId, className: entry.availability === 'missing' ? 'missing' : '' },
                  h('div', null,
                    h('strong', { title: entry.revisionId }, shortHash(entry.revisionId)),
                    h('span', { title: entry.payloadSha256 }, shortHash(entry.payloadSha256)),
                    h('p', { className: 'robot-retention-labels' }, revisionLabels(entry, retentionStatus, localRevisionId).join(' · '))),
                  entry.availability === 'retained' && h('div', { className: 'robot-retention-actions' },
                    h('button', { type: 'button', onClick: () => prepareRetention('pin', entry) }, entry.pinned ? 'Pin Again' : 'Pin'),
                    h('button', { type: 'button', disabled: entry.revisionId === retentionStatus.activeRevisionId, onClick: () => prepareRetention('rollback', entry) }, entry.revisionId === retentionStatus.activeRevisionId ? 'Active' : 'Roll Back')),
                  entry.availability === 'missing' && h('span', { className: 'robot-retention-unavailable' }, 'Rollback unavailable')))),
              !retentionStatus.retention.revisions.some((entry) => entry.revisionId === localRevisionId) && h('p', { className: 'robot-retention-local' }, 'Local only: ' + shortHash(localRevisionId)))),
          h('div', { className: 'robot-push-actions split' },
            h('button', { type: 'button', onClick: chooseAnotherRobot }, 'Pair Another Robot'),
            h('button', { type: 'button', onClick: inspectRetention }, 'Refresh History'),
            h('button', { className: 'primary', type: 'button', onClick: preparePush }, 'Prepare Push'))),

        phase === 'preparing' && h('div', { className: 'robot-push-status', role: 'status' }, h('span', { className: 'robot-push-spinner' }), h('strong', null, 'Validating and building the reviewed revision…')),
        phase === 'retention-preparing' && h('div', { className: 'robot-push-status', role: 'status' }, h('span', { className: 'robot-push-spinner' }), h('strong', null, 'Validating the reviewed revision retention change…')),

        preview && phase === 'review' && h('div', { className: 'robot-push-section' },
          h('h3', null, 'Review exact revision'),
          h('dl', { className: 'robot-push-details' },
            h('div', null, h('dt', null, 'Robot'), h('dd', null, preview.robot)),
            h('div', null, h('dt', null, 'Project'), h('dd', null, preview.project)),
            h('div', null, h('dt', null, 'Catalog'), h('dd', null, preview.catalog)),
            h('div', null, h('dt', null, 'Revision'), h('dd', { title: preview.revision }, preview.revision)),
            h('div', null, h('dt', null, 'Payload hash'), h('dd', { title: preview.payloadHash }, preview.payloadHash)),
            h('div', null, h('dt', null, 'Envelope size'), h('dd', null, preview.size.toLocaleString() + ' bytes')),
            h('div', null, h('dt', null, 'Transport'), h('dd', null, preview.transport))),
          h('div', { className: 'robot-push-actions' },
            h('button', { type: 'button', onClick: cancelPush }, 'Cancel'),
            h('button', { className: 'primary', type: 'button', onClick: confirmPush }, 'Push This Revision'))),

        retentionPreview && phase === 'retention-review' && h('div', { className: 'robot-push-section' },
          h('h3', null, retentionPreview.action === 'rollback' ? 'Review rollback' : 'Review pin'),
          h('p', null, 'This sends one immutable retention control over SFTP. The robot applies it only while disabled.'),
          h('dl', { className: 'robot-push-details' },
            h('div', null, h('dt', null, 'Robot'), h('dd', null, retentionPreview.robot)),
            h('div', null, h('dt', null, 'Current active'), h('dd', { title: retentionPreview.activeRevision }, shortHash(retentionPreview.activeRevision))),
            h('div', null, h('dt', null, 'Target revision'), h('dd', { title: retentionPreview.targetRevision }, retentionPreview.targetRevision)),
            h('div', null, h('dt', null, 'Payload hash'), h('dd', { title: retentionPreview.payloadHash }, retentionPreview.payloadHash)),
            h('div', null, h('dt', null, 'Catalog'), h('dd', null, retentionPreview.catalog)),
            h('div', null, h('dt', null, 'Transport'), h('dd', null, retentionPreview.transport))),
          h('div', { className: 'robot-push-actions' },
            h('button', { type: 'button', onClick: cancelRetention }, 'Cancel'),
            h('button', { className: 'primary', type: 'button', onClick: confirmRetention }, retentionPreview.action === 'rollback' ? 'Roll Back to This Revision' : 'Pin This Revision'))),

        (preview || retentionPreview) && ['uploading', 'uploaded', 'staged'].includes(phase) && !result && h('div', { className: 'robot-push-status', role: 'status' },
          h('span', { className: 'robot-push-spinner' }),
          h('strong', null, phase === 'uploading' ? 'Uploading temporary control…' : phase === 'uploaded' ? 'Upload verified; committing the staged request…' : 'Staged; waiting for the disabled robot runtime acknowledgment…'),
          h('p', null, phase === 'staged' ? 'The request has been committed. Keep the robot disabled while Bordeaux waits for its nonce-bound result.' : 'The current active revision remains selected until the runtime accepts this request.'),
          phase !== 'staged' && h('button', { type: 'button', onClick: retentionPreview ? cancelRetention : cancelPush }, 'Cancel Upload')),

        (preview || retentionPreview) && (['active', 'pinned', 'rejected', 'failed', 'cancelled'].includes(phase) || (phase === 'staged' && result)) && h('div', { className: 'robot-push-section robot-push-outcome ' + phase, role: ['active', 'pinned'].includes(phase) ? 'status' : 'alert' },
          h('h3', null, phase === 'active' ? 'Revision active' : phase === 'pinned' ? 'Revision pinned' : phase === 'rejected' ? 'Activation rejected' : phase === 'cancelled' ? 'Operation cancelled' : phase === 'staged' ? 'Request staged; acknowledgment unconfirmed' : 'Operation failed'),
          h('p', null, phase === 'active' || phase === 'pinned'
            ? 'The robot acknowledged this exact nonce, revision, payload, catalog, and runtime identity.'
            : result && result.message ? result.message : error || 'The prior active robot revision was preserved.'),
          result && result.boundary && h('p', { className: 'robot-push-boundary' }, 'Failed boundary: ' + result.boundary),
          h('div', { className: 'robot-push-actions' },
            h('button', { type: 'button', onClick: () => setOpen(false) }, 'Close'),
            !['active', 'pinned'].includes(phase) && h('button', { className: 'primary', type: 'button', onClick: retentionPreview ? inspectRetention : preparePush }, retentionPreview ? 'Refresh History' : 'Review a New Push'))),

      )),
  );
}
