    intent.current = { project: clone(projectRef.current()), scope: clone(scope), projectKey: context.current.projectKey };
    setPreview(null); setRetentionPreview(null); setResult(null); setError(''); show();
    if (pairing) await prepareCaptured(); else setPhase('idle');
  };
  const probeRobot = async () => {
    const request = ++generation.current;
    setPhase('probing'); setError(''); setProbe(null);
    try {
      const observed = await api.probeRobot({ host: host.trim(), port: Number(port) });
      if (request === generation.current) { setProbe(observed); setPhase('pair-review'); }
    } catch (failure) { if (request === generation.current) { setPhase('idle'); setError(errorMessage(failure)); } }
  };
  const confirmPairing = async () => {
    if (!probe) return;
    setPhase('pairing'); setError('');
    try {
      const saved = await api.confirmRobotPairing(probe.hostKeyFingerprint, probe.status.runtimeId);
      setPairing(saved); setProbe(null); setInspection(null); setStatus(null); setPhase('ready');
      if (intent.current) await prepareCaptured();
    } catch (failure) { setPhase('pair-review'); setError(errorMessage(failure)); }
  };
  const confirmPush = async () => {
    if (!preview || state.current.busy || confirmationLock.current) return;
    confirmationLock.current = true; setConfirming(true);
    setPhase('uploading'); setResult(null); setError('');
    inspectGeneration.current += 1; setInspection(null); setRefreshing(false);
    try {
      const finished = await api.confirmRobotPush(preview.operationId, adoptBaseline);
      setResult(finished); setPhase(finished.state);
      if (finished.receiptWarning) setError(finished.receiptWarning);
      if (finished.state === 'active') void refreshStatus();
    } catch (failure) { setPhase('failed'); setError(errorMessage(failure)); }
    finally { confirmationLock.current = false; setConfirming(false); }
  };
  const cancel = async () => {
    const current = state.current;
    try {
      const operationId = current.retentionPreview?.operationId || current.preview?.operationId;
      if (!operationId) return;
      const answer = current.retentionPreview ? await api.cancelRobotRetention(operationId) : await api.cancelRobotPush(operationId);
      if (answer.canceled && answer.boundary === 'review') { setPhase('cancelled'); setResult({ state: 'cancelled' }); }
      else if (!answer.canceled) setError('This request can no longer be cancelled. Refresh to check the robot.');
    } catch (failure) { setError(errorMessage(failure)); }
  };
  const prepareRetention = async (action, target) => {
    if (state.current.busy) return;
    const request = ++generation.current;
    intent.current = null; setPhase('retention-preparing'); setPreview(null); setRetentionPreview(null); setResult(null); setError('');
    try {
      const reviewed = await api.prepareRobotRetention(clone(projectRef.current()), action, target);
      if (request !== generation.current) { await api.cancelRobotRetention(reviewed.operationId); return; }
      setRetentionPreview(reviewed); setPhase('retention-review');
    } catch (failure) { if (request === generation.current) { setPhase('ready'); setError(errorMessage(failure)); } }
  };
  const confirmRetention = async () => {
    if (!retentionPreview || state.current.busy || confirmationLock.current) return;
    confirmationLock.current = true; setConfirming(true);
    setPhase('uploading'); setResult(null); setError(''); setInspection(null);
    inspectGeneration.current += 1; setRefreshing(false);
    try {
      const finished = await api.confirmRobotRetention(retentionPreview.operationId);
      setResult(finished); setPhase(finished.state);
      if (['active', 'pinned'].includes(finished.state)) void refreshStatus();
    } catch (failure) { setPhase('failed'); setError(errorMessage(failure)); }
    finally { confirmationLock.current = false; setConfirming(false); }
  };
  const connectionHome = () => { if (state.current.busy) return; intent.current = null; setPreview(null); setRetentionPreview(null); setResult(null); setPhase('ready'); setError(''); };
  const chooseAnotherRobot = () => {
    if (state.current.busy) return;
    generation.current += 1; inspectGeneration.current += 1;
    setRefreshing(false);
    if (state.current.phase === 'review' && state.current.preview) void api.cancelRobotPush(state.current.preview.operationId).catch((failure) => setError(errorMessage(failure)));
    if (state.current.phase === 'retention-review' && state.current.retentionPreview) void api.cancelRobotRetention(state.current.retentionPreview.operationId).catch((failure) => setError(errorMessage(failure)));
    setPairing(null); setProbe(null); setPreview(null); setRetentionPreview(null); setInspection(null); setStatus(null); setResult(null); setError(''); setPhase('idle');
  };
  const itemStatus = (kind, id) => {
    const selected = preview?.summary?.pathIds || intent.current?.scope?.pathIds || [];
    const routineSelected = intent.current?.scope?.kind === 'routine' && intent.current.scope.routineId === id;
    if (state.current.busy && intent.current?.projectKey === context.current.projectKey && (kind === 'path' ? selected.includes(id) : routineSelected)) {
      return { label: phase === 'staged' ? 'Awaiting acceptance' : phase === 'preparing' ? 'Preparing' : 'Sending', tone: 'pending' };
    }
    const list = kind === 'path' ? 'paths' : 'routines';
    return deploymentItemStatus(inspection?.comparison?.[list]?.[id], inspection?.keys?.[list]?.[id],
      deploymentInputKey(projectRef.current(), kind, id, context.current.catalogKey), inspection?.verifiedAt, clock);
  };
  const connectionLabel = busy ? (phase === 'staged' ? 'Awaiting robot' : 'Robot · Working')
    : !pairing ? 'Connect robot' : status ? 'Team ' + pairing.teamNumber : 'Team ' + pairing.teamNumber + ' · Not checked';
  return { open, close, pairing, probe, host, setHost, port, setPort, phase, preview, retentionPreview, status, inspection,
    refreshing, result, error, adoptBaseline, setAdoptBaseline, desktopAvailable, busy, connectionLabel, itemStatus,
    requestPush, openConnection, refreshStatus, probeRobot, confirmPairing, confirmPush, cancel, prepareRetention,
    confirmRetention, chooseAnotherRobot, connectionHome, retry: () => intent.current && requestPush(intent.current.scope) };
}
