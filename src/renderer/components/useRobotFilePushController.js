import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ROBOT_PATH_DIRECTORY } from '../../shared/robotFileDelivery';

const message = (error) => error?.message || String(error || 'File transfer failed');
const working = (phase) => ['loading', 'probing', 'trusting', 'preparing', 'uploading'].includes(phase);

export function useRobotFilePushController({ getProject, projectKey, catalogKey, bookmarkKey }) {
  const api = window.bordeauxAPI;
  const [view, setView] = useState({ open: false, phase: 'loading', connection: null, probe: null, preview: null, result: null, error: '' });
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [directory, setDirectory] = useState(DEFAULT_ROBOT_PATH_DIRECTORY);
  const state = useRef(view);
  const generation = useRef(0);
  const intent = useRef(null);
  const origin = useRef(null);
  const source = useRef(getProject); source.current = getProject;
  const context = useRef({ projectKey, catalogKey, bookmarkKey });
  const update = (patch) => { state.current = { ...state.current, ...patch }; setView(state.current); };
  const discard = async (preview) => { if (preview) await api.cancelRobotFiles(preview.operationId); };
  const prepare = async () => {
    if (!intent.current) return;
    const request = ++generation.current;
    const captured = intent.current;
    update({ phase: 'preparing', preview: null, result: null, error: '' });
    try {
      const preview = await api.prepareRobotFiles(captured.project, captured.pathIds);
      if (request !== generation.current) { await discard(preview); return; }
      update({ preview, phase: 'review' });
    } catch (error) { if (request === generation.current) update({ phase: 'failed', error: message(error) }); }
  };
  useEffect(() => {
    let live = true;
    const request = generation.current;
    api.getRobotFileConnection().then((connection) => {
      if (!live || request !== generation.current) return;
      if (connection) { setHost(connection.endpoint.host); setPort(String(connection.endpoint.port)); setDirectory(connection.endpoint.directory); }
      update({ connection, phase: 'idle' });
      if (connection && intent.current) void prepare();
    }).catch((error) => { if (live && request === generation.current) update({ phase: 'idle', error: message(error) }); });
    return () => { live = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    const previous = context.current;
    context.current = { projectKey, catalogKey, bookmarkKey };
    if (previous.projectKey === projectKey && previous.catalogKey === catalogKey && previous.bookmarkKey === bookmarkKey) return;
    intent.current = null;
    // An already confirmed upload owns its immutable files even after navigation.
    if (state.current.phase === 'uploading') return;
    generation.current += 1;
    void discard(state.current.preview).catch(() => undefined);
    update({ preview: null, result: null, phase: 'idle', error: 'The project or catalog changed. Select the paths and review again.' });
  }, [projectKey, catalogKey, bookmarkKey]);
  const show = () => { if (!state.current.open) origin.current = document.activeElement; update({ open: true }); };
  const close = () => { update({ open: false }); requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus(); }); };
  const requestPush = async (scope) => {
    show();
    if (working(state.current.phase) && state.current.phase !== 'loading') return;
    if (scope?.kind !== 'paths') {
      intent.current = null;
      void discard(state.current.preview).catch(() => undefined);
      update({ error: 'SFTP uploads path files. Routine delivery and full-project replacement are not supported.', phase: 'unsupported', preview: null, result: null }); return;
    }
    if (!scope.pathIds?.length) { update({ error: 'Select at least one path to upload.', phase: 'failed' }); return; }
    const previous = state.current.preview;
    intent.current = { project: structuredClone(source.current()), pathIds: [...scope.pathIds], projectKey };
    const request = generation.current;
    const wasLoading = state.current.phase === 'loading';
    update({ preview: null, result: null, error: '', phase: wasLoading ? 'loading' : 'preparing' });
    try { await discard(previous); }
    catch (error) { update({ phase: 'failed', error: message(error) }); return; }
    if (request !== generation.current || !intent.current) return;
    if (state.current.connection) await prepare();
    else if (!wasLoading) update({ phase: 'idle' });
  };
  const probeRobot = async () => {
    if (working(state.current.phase)) return;
    const request = ++generation.current;
    update({ phase: 'probing', probe: null, error: '' });
    try {
      const probe = await api.probeRobotFiles({ host: host.trim(), port: Number(port), directory: directory.trim() });
      if (request === generation.current) update({ probe, phase: 'identity' });
    } catch (error) { if (request === generation.current) update({ phase: 'idle', error: message(error) }); }
  };
  const confirmPairing = async () => {
    if (working(state.current.phase) || !state.current.probe) return;
    const request = ++generation.current;
    update({ phase: 'trusting', error: '' });
    try {
      const connection = await api.trustRobotFiles(state.current.probe.hostKeyFingerprint);
      if (request !== generation.current) return;
      update({ connection, probe: null, phase: 'idle' });
      if (intent.current) await prepare();
    } catch (error) { if (request === generation.current) update({ phase: 'identity', error: message(error) }); }
  };
  const confirmPush = async () => {
    if (state.current.phase !== 'review' || !state.current.preview) return;
    const operationId = state.current.preview.operationId;
    update({ phase: 'uploading', error: '' });
    try { const result = await api.confirmRobotFiles(operationId); update({ result, phase: 'transferred' }); }
    catch (error) { update({ phase: 'failed', error: message(error) }); }
  };
  const cancel = async () => {
    const preview = state.current.preview;
    if (!preview) return;
    const uploading = state.current.phase === 'uploading';
    if (!uploading) update({ phase: 'preparing' });
    try {
      const answer = await api.cancelRobotFiles(preview.operationId);
      if (state.current.preview?.operationId !== preview.operationId) return;
      if (answer.canceled && !uploading) { intent.current = null; update({ preview: null, phase: 'cancelled' }); }
      else if (!answer.canceled) update({ error: 'Transfer can no longer be canceled. Wait for its verified result.', ...(!uploading ? { phase: 'review' } : {}) });
      // Keep the upload locked until its confirmation promise settles.
    } catch (error) { update({ error: message(error), ...(!uploading ? { phase: 'review' } : {}) }); }
  };
  const chooseAnotherRobot = async () => {
    if (working(state.current.phase)) return;
    const request = ++generation.current;
    const previous = state.current;
    update({ phase: 'preparing' });
    try { await discard(previous.preview); if (request === generation.current) update({ connection: null, probe: null, preview: null, result: null, phase: 'idle', error: '' }); }
    catch (error) { if (request === generation.current) update({ phase: previous.phase, error: message(error) }); }
  };
  const connectionHome = async () => {
    if (working(state.current.phase)) return;
    intent.current = null;
    const request = ++generation.current;
    const previous = state.current;
    update({ phase: 'preparing' });
    try { await discard(previous.preview); if (request === generation.current) update({ preview: null, result: null, phase: 'idle', error: '' }); }
    catch (error) { if (request === generation.current) update({ phase: previous.phase, error: message(error) }); }
  };
  return { ...view, fileTransfer: true, host, setHost, port, setPort, directory, setDirectory,
    busy: working(view.phase), desktopAvailable: true, deliveryAvailable: true,
    connectionLabel: working(view.phase) ? 'Robot, Working' : view.connection ? 'Robot files' : 'Connect robot',
    itemStatus: (kind, id) => kind === 'path' && working(view.phase) && intent.current?.projectKey === projectKey && intent.current.pathIds.includes(id)
      ? { label: view.phase === 'uploading' ? 'Uploading' : 'Preparing', detail: 'Selected for SFTP upload.', tone: 'pending' }
      : { label: 'Local', detail: 'Saved locally. Push uploads selected path files over SFTP.', tone: 'muted' },
    openConnection: show, close, requestPush, probeRobot, confirmPairing, confirmPush, cancel, chooseAnotherRobot, connectionHome,
    retry: () => intent.current && requestPush({ kind: 'paths', pathIds: intent.current.pathIds }) };
}
