const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
contextBridge.exposeInMainWorld('bordeauxAPI', {
  platform: 'darwin', restoreLastProject: () => ipcRenderer.invoke('branches:restore'),
  openRecentRobotProject: () => ipcRenderer.invoke('branches:catalog'),
  saveProject: (project) => ipcRenderer.invoke('branches:save', project),
  autosaveProject: async () => ({ saved: false }), setDirty: () => undefined,
  listRecentRobotProjects: async () => [], getMcpStatus: async () => ({ enabled: false }),
  getActiveAgentProposal: async () => null, onMcpStatus: noop, onAgentProposal: noop, onMenuCommand: noop,
});
