const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
contextBridge.exposeInMainWorld('bordeauxAPI', {
  platform: 'linux',
  restoreLastProject: () => ipcRenderer.invoke('optimizer-ui:restore'),
  saveProject: (project) => ipcRenderer.invoke('optimizer-ui:save', project),
  autosaveProject: async () => ({ saved: false }),
  setDirty: () => undefined,
  listRecentRobotProjects: async () => [],
  getMcpStatus: async () => ({ enabled: true }),
  getActiveAgentProposal: async () => null,
  onMcpStatus: noop, onAgentProposal: noop, onMenuCommand: noop,
});
