const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
contextBridge.exposeInMainWorld('bordeauxAPI', {
  platform: 'linux', restoreLastProject: () => ipcRenderer.invoke('library:restore'),
  saveProject: (project) => ipcRenderer.invoke('library:save', project), autosaveProject: async () => ({ saved: false }),
  setDirty: () => undefined, listRecentJavaProjects: async () => [], getMcpStatus: async () => ({ enabled: false }), getActiveAgentProposal: async () => null,
  onMcpStatus: noop, onAgentProposal: noop, onMenuCommand: noop, onRobotPushState: noop,
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
