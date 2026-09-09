const { contextBridge, ipcRenderer } = require('electron');
const noop = () => () => undefined;
contextBridge.exposeInMainWorld('bordeauxAPI', {
  platform: 'linux', robotDeliveryCapabilities: { pathPush: false, routinePush: false },
  restoreLastProject: () => ipcRenderer.invoke('fixture:restore'),
  openProject: () => ipcRenderer.invoke('fixture:open', 'folder'),
  openProjectFolder: () => ipcRenderer.invoke('fixture:open', 'new-folder'),
  openProjectFile: () => ipcRenderer.invoke('fixture:open', 'file'),
  newProject: () => ipcRenderer.invoke('fixture:reset'),
  saveProject: (project, saveAs) => ipcRenderer.invoke('fixture:save', project, saveAs),
  autosaveProject: (project) => ipcRenderer.invoke('fixture:autosave', project),
  setDirty: (dirty) => ipcRenderer.send('fixture:dirty', dirty),
  listRecentRobotProjects: async () => [], getMcpStatus: async () => ({ enabled: false }), getActiveAgentProposal: async () => null,
  onMcpStatus: noop, onAgentProposal: noop, onRobotPushState: noop,
  onMenuCommand: (listener) => { const handler = (_event, command) => listener({ command }); ipcRenderer.on('fixture:menu', handler); return () => ipcRenderer.removeListener('fixture:menu', handler); },
});
