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

export function RobotPushDialog({ getProject }) {
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState(null);
  const [probe, setProbe] = useState(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [phase, setPhase] = useState('idle');
  const [preview, setPreview] = useState(null);
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
    if (!open) return undefined;
    closeRef.current && closeRef.current.focus();
    const onKey = (event) => {
      if (event.key === 'Escape' && !['preparing', 'uploaded', 'staged'].includes(phase)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase]);

  const desktopAvailable = Boolean(window.bordeauxAPI && typeof window.bordeauxAPI.prepareRobotPush === 'function');
  const busy = ['probing', 'pairing', 'preparing', 'uploading', 'uploaded', 'staged'].includes(phase);
  const canClose = !busy;

  const openDialog = () => {
    setOpen(true);
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
      setPairing(saved); setProbe(null); setPhase('ready');
    } catch (failure) {
      setPhase('pair-review'); setError(message(failure));
    }
  };

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
    } catch (failure) {
      setPhase('failed'); setError(message(failure));
    }
  };

  const cancelPush = async () => {
    if (!preview || !window.bordeauxAPI || typeof window.bordeauxAPI.cancelRobotPush !== 'function') return;
    await window.bordeauxAPI.cancelRobotPush(preview.operationId).catch(() => undefined);
    setPhase('cancelled');
  };

  const chooseAnotherRobot = () => {
    setPairing(null); setProbe(null); setPreview(null); setResult(null); setError(''); setPhase('idle');
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

        pairing && !preview && !['preparing'].includes(phase) && h('div', { className: 'robot-push-section' },
          h('h3', null, 'Paired robot'),
          h('dl', { className: 'robot-push-details compact' },
            h('div', null, h('dt', null, 'Robot'), h('dd', null, 'Team ' + pairing.teamNumber)),
            h('div', null, h('dt', null, 'Endpoint'), h('dd', null, pairing.endpoint.host + ':' + pairing.endpoint.port)),
            h('div', null, h('dt', null, 'Runtime'), h('dd', { title: pairing.runtimeId }, shortHash(pairing.runtimeId)))),
          h('div', { className: 'robot-push-actions split' },
            h('button', { type: 'button', onClick: chooseAnotherRobot }, 'Pair Another Robot'),
            h('button', { className: 'primary', type: 'button', onClick: preparePush }, 'Prepare Push'))),

        phase === 'preparing' && h('div', { className: 'robot-push-status', role: 'status' }, h('span', { className: 'robot-push-spinner' }), h('strong', null, 'Validating and building the reviewed revision…')),

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

        preview && ['uploading', 'uploaded', 'staged'].includes(phase) && !result && h('div', { className: 'robot-push-status', role: 'status' },
          h('span', { className: 'robot-push-spinner' }),
          h('strong', null, phase === 'uploading' ? 'Uploading temporary revision…' : phase === 'uploaded' ? 'Upload verified; committing the staged request…' : 'Staged; waiting for the disabled robot runtime acknowledgment…'),
          h('p', null, phase === 'staged' ? 'The activation request has been committed. Keep the robot disabled while Bordeaux waits for its nonce-bound result.' : 'The prior active revision remains selected until the runtime accepts this one.'),
          phase !== 'staged' && h('button', { type: 'button', onClick: cancelPush }, 'Cancel Upload')),

        preview && (['active', 'rejected', 'failed', 'cancelled'].includes(phase) || (phase === 'staged' && result)) && h('div', { className: 'robot-push-section robot-push-outcome ' + phase, role: phase === 'active' ? 'status' : 'alert' },
          h('h3', null, phase === 'active' ? 'Revision active' : phase === 'rejected' ? 'Activation rejected' : phase === 'cancelled' ? 'Push cancelled' : phase === 'staged' ? 'Revision staged; activation unconfirmed' : 'Push failed'),
          h('p', null, phase === 'active'
            ? 'The robot acknowledged this exact nonce, revision, payload, catalog, and runtime identity.'
            : result && result.message ? result.message : error || 'The prior active robot revision was preserved.'),
          result && result.boundary && h('p', { className: 'robot-push-boundary' }, 'Failed boundary: ' + result.boundary),
          h('div', { className: 'robot-push-actions' },
            h('button', { type: 'button', onClick: () => setOpen(false) }, 'Close'),
            phase !== 'active' && h('button', { className: 'primary', type: 'button', onClick: preparePush }, 'Review a New Push'))),

      )),
  );
}
