const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
contextBridge.exposeInMainWorld('bordeauxAPI', {
  platform: 'darwin', restoreLastProject: () => ipcRenderer.invoke('refresh:restore'),
  openProjectFolder: () => ipcRenderer.invoke('refresh:open-folder'),
  saveProject: (project) => ipcRenderer.invoke('refresh:save', project),
  autosaveProject: (project) => ipcRenderer.invoke('refresh:autosave', project),
  newProject: async () => undefined, setDirty: () => undefined,
  listRecentRobotProjects: async () => [], getRobotPairing: async () => null,
  getMcpStatus: async () => ({ enabled: false }), getActiveAgentProposal: async () => null,
  onMcpStatus: noop, onAgentProposal: noop, onMenuCommand: noop, onRobotPushState: noop,
});
