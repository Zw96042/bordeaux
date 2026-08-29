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
