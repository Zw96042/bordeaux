import { contextBridge, ipcRenderer } from "electron";
import type { BordeauxProject } from "../shared/types";
import type { AgentProposal, AgentSessionSnapshot } from "../shared/agent/types";

contextBridge.exposeInMainWorld("bordeauxAPI", {
  openProject: () => ipcRenderer.invoke("project:open"),
  openRecentProject: (index: number) => ipcRenderer.invoke("project:openRecent", index),
  restoreLastProject: () => ipcRenderer.invoke("project:restoreLast"),
  newProject: () => ipcRenderer.invoke("project:new"),
  saveProject: (project: BordeauxProject, saveAs = false) => ipcRenderer.invoke("project:save", project, saveAs),
  exportBdx: (project: BordeauxProject, pathId?: string) => ipcRenderer.invoke("project:exportBdx", project, pathId),
  exportJava: (project: BordeauxProject, destination: "linked" | "saveAs" = "linked") => ipcRenderer.invoke("project:exportJava", project, destination),
  validateProject: (project: BordeauxProject) => ipcRenderer.invoke("project:validate", project),
  listRecentJavaProjects: () => ipcRenderer.invoke("javaProject:listRecent"),
  linkJavaProject: () => ipcRenderer.invoke("javaProject:link"),
  openRecentJavaProject: (id: string) => ipcRenderer.invoke("javaProject:openRecent", id),
  refreshJavaProject: () => ipcRenderer.invoke("javaProject:refresh"),
  installJavaSupport: () => ipcRenderer.invoke("javaProject:installSupport"),
  buildJavaCatalog: () => ipcRenderer.invoke("javaProject:buildCatalog"),
  cancelJavaCatalogBuild: () => ipcRenderer.invoke("javaProject:cancelBuild"),
  setDirty: (dirty: boolean) => ipcRenderer.send("project:setDirty", dirty),
  publishAgentSession: (snapshot: AgentSessionSnapshot) => ipcRenderer.send("agent:publishSession", snapshot),
  updateAgentProposalStatus: (proposalId: string, status: "applied" | "rejected" | "stale", revision?: number) => ipcRenderer.send("agent:proposalStatus", proposalId, status, revision),
  acknowledgeAgentProposal: (proposalId: string) => ipcRenderer.send("agent:proposalReceipt", proposalId),
  getActiveAgentProposal: (): Promise<AgentProposal | null> => ipcRenderer.invoke("agent:getActiveProposal"),
  getMcpStatus: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke("agent:getMcpStatus"),
  onMcpStatus: (handler: (status: { enabled: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { enabled: boolean }) => handler(status);
    ipcRenderer.on("agent:mcpStatus", listener);
    return () => ipcRenderer.removeListener("agent:mcpStatus", listener);
  },
  onAgentProposal: (handler: (proposal: AgentProposal) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, proposal: AgentProposal) => handler(proposal);
    ipcRenderer.on("agent:proposal", listener);
    return () => ipcRenderer.removeListener("agent:proposal", listener);
  },
  onMenuCommand: (handler: (event: { command: string; payload?: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { command: string; payload?: unknown }) => handler(payload);
    ipcRenderer.on("menu-command", listener);
    return () => ipcRenderer.removeListener("menu-command", listener);
  },
});
