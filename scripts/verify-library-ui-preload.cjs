const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
// MCP access stays off unless a check enables it; proposals then arrive as the main process would send them.
const agent = { status: null, proposal: null, sessions: [], statuses: [] };
const listen = (key) => (listener) => { agent[key] = listener; return () => { if (agent[key] === listener) agent[key] = null; }; };
contextBridge.exposeInMainWorld('bordeauxAPI', {
  robotDeliveryCapabilities: { pathPush: true, routinePush: true }, // Mock receiver for generic delivery UI coverage only.
  platform: 'linux', restoreLastProject: () => ipcRenderer.invoke('library:restore'),
  saveProject: (project) => ipcRenderer.invoke('library:save', project), autosaveProject: async () => ({ saved: false }),
  setDirty: () => undefined, listRecentRobotProjects: async () => [], getMcpStatus: async () => ({ enabled: false }), getActiveAgentProposal: async () => null,
  onMcpStatus: listen('status'), onAgentProposal: listen('proposal'), onMenuCommand: noop, onRobotPushState: noop,
  publishAgentSession: (snapshot) => { agent.sessions.push(JSON.parse(JSON.stringify(snapshot))); },
  updateAgentProposalStatus: (id, status) => { agent.statuses.push({ id, status }); },
  acknowledgeAgentProposal: (id, _sessionId, _revision, _activePathId, accepted = true) => { if (!accepted) agent.statuses.push({ id, status: 'stale' }); },
  __libraryAgent: {
    setAccess: (enabled, generation) => agent.status?.({ enabled, generation }),
    latestSession: () => agent.sessions.at(-1) || null,
    propose: (proposal) => agent.proposal?.(JSON.parse(JSON.stringify(proposal))),
    statuses: () => agent.statuses.slice(),
  },
  getRobotPairing: async () => ({ teamNumber: 2468, endpoint: { host: 'fixture', port: 22 }, runtimeId: 'fixture-runtime' }),
  previewBetaDiagnostic: (project) => ipcRenderer.invoke('library:diagnostic-preview', project),
  saveBetaDiagnostic: (previewId) => ipcRenderer.invoke('library:diagnostic-save', previewId),
  prepareRobotPush: (project, scope) => ipcRenderer.invoke('library:prepare', project, scope),
  confirmRobotPush: (id) => ipcRenderer.invoke('library:confirm', id),
  cancelRobotPush: async () => ({ canceled: true, boundary: 'review' }),
  inspectRobotLibrary: () => ipcRenderer.invoke('library:inspect'),
  probeRobot: async () => ({ hostKeyFingerprint: 'fixture-fingerprint', status: { teamNumber: 2468, runtimeId: 'fixture-runtime' } }),
  confirmRobotPairing: async () => ({ teamNumber: 2468, endpoint: { host: 'fixture', port: 22 }, runtimeId: 'fixture-runtime' }),
});
