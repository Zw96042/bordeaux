// Mocked desktop bridge for the notification check: local project, export and update fixtures only.
// Every robot operation reports to the harness and fails, so nothing reaches a transport.
const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
const forbidden = (name) => (...args) => ipcRenderer.invoke('notices:robot-call', name, args);
contextBridge.exposeInMainWorld('bordeauxAPI', {
  platform: 'win32', restoreLastProject: () => ipcRenderer.invoke('notices:restore'),
  openRecentRobotProject: () => ipcRenderer.invoke('notices:catalog'),
  linkRobotProject: () => ipcRenderer.invoke('notices:catalog'),
  saveProject: (project) => ipcRenderer.invoke('notices:save', project),
  autosaveProject: async () => ({ saved: false }), setDirty: () => undefined,
  exportBdx: (project, pathId) => ipcRenderer.invoke('notices:export', 'path', pathId),
  exportRoutine: (project, routineId) => ipcRenderer.invoke('notices:export', 'routine', routineId),
  getAppUpdateState: () => ipcRenderer.invoke('notices:update-state'),
  setAppUpdatesVisible: (visible) => ipcRenderer.invoke('notices:update-visible', visible),
  onAppUpdateState: (handler) => { const listener = (_event, state) => handler(state); ipcRenderer.on('notices:update-changed', listener); return () => ipcRenderer.removeListener('notices:update-changed', listener); },
  ...Object.fromEntries(['checkAppUpdates', 'downloadAppUpdate', 'cancelAppUpdateDownload', 'installAppUpdate', 'openAppUpdateReleases', 'copyAppUpdateDetails']
    .map(name => [name, () => ipcRenderer.invoke('notices:update-call', name)])),
  publishAgentSession: (snapshot) => ipcRenderer.send('notices:published', snapshot.project),
  robotDeliveryCapabilities: Object.freeze({ pathPush: true, routinePush: false, fileTransfer: true }),
  getRobotFileConnection: async () => null, // Local offline settings read, not a transport.
  ...Object.fromEntries(['prepareRobotFiles', 'probeRobotFiles', 'saveRobotFileSettings', 'trustRobotFiles', 'confirmRobotFiles', 'cancelRobotFiles',
    'prepareRobotPush', 'confirmRobotPush', 'cancelRobotPush', 'pinRobotRevision', 'rollbackRobotRevision', 'connectRobot', 'disconnectRobot', 'exportRobot'].map(name => [name, forbidden(name)])),
  listRecentRobotProjects: async () => [], getMcpStatus: async () => ({ enabled: false }),
  getActiveAgentProposal: async () => null, onMcpStatus: noop, onAgentProposal: noop,
  onMenuCommand: (listener) => { const receive = (_event, command) => listener(command); ipcRenderer.on('notices:menu', receive); return () => ipcRenderer.removeListener('notices:menu', receive); },
});
