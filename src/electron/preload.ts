import { contextBridge, ipcRenderer } from "electron";
import type { BordeauxProject } from "../shared/types";
import type { AgentProposal, AgentSessionSnapshot } from "../shared/agent/types";

contextBridge.exposeInMainWorld("bordeauxAPI", {
  openProject: () => ipcRenderer.invoke("project:open"),
  openRecentProject: (index: number) => ipcRenderer.invoke("project:openRecent", index),
  newProject: () => ipcRenderer.invoke("project:new"),
  saveProject: (project: BordeauxProject, saveAs = false) => ipcRenderer.invoke("project:save", project, saveAs),
  exportBdx: (project: BordeauxProject, pathId?: string) => ipcRenderer.invoke("project:exportBdx", project, pathId),
  exportJava: (project: BordeauxProject, destination: "linked" | "saveAs" = "linked") => ipcRenderer.invoke("project:exportJava", project, destination),
  validateProject: (project: BordeauxProject) => ipcRenderer.invoke("project:validate", project),
  listRecentJavaProjects: () => ipcRenderer.invoke("javaProject:listRecent"),
  linkJavaProject: () => ipcRenderer.invoke("javaProject:link"),
  openRecentJavaProject: (id: string) => ipcRenderer.invoke("javaProject:openRecent", id),
  refreshJavaProject: () => ipcRenderer.invoke("javaProject:refresh"),
