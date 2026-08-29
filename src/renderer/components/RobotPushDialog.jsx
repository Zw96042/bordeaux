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
