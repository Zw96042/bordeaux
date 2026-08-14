import { contextBridge, ipcRenderer } from "electron";
import type { BordeauxProject } from "../shared/types";
import type { AgentProposal, AgentSessionSnapshot } from "../shared/agent/types";
import type { RobotEndpoint, RobotPairing, RobotProbe, RobotRuntimeStatus } from "./robotSftpTransport";
import type { RobotPushPreview, RobotPushProgress, RobotPushResult } from "./robotPush";
import type { RobotRetentionOperationResult, RobotRetentionPreview, RobotRetentionProgress } from "./robotRetention";

const bordeauxAPI = {
  platform: process.platform,
  openProject: () => ipcRenderer.invoke("project:open"),
  openRecentProject: (index: number) => ipcRenderer.invoke("project:openRecent", index),
  restoreLastProject: () => ipcRenderer.invoke("project:restoreLast"),
  newProject: () => ipcRenderer.invoke("project:new"),
  saveProject: (project: BordeauxProject, saveAs = false) => ipcRenderer.invoke("project:save", project, saveAs),
  autosaveProject: (project: BordeauxProject) => ipcRenderer.invoke("project:autosave", project),
  exportJava: (project: BordeauxProject, destination: "linked" | "saveAs" = "linked") => ipcRenderer.invoke("project:exportJava", project, destination),
  validateProject: (project: BordeauxProject) => ipcRenderer.invoke("project:validate", project),
  listRecentJavaProjects: () => ipcRenderer.invoke("javaProject:listRecent"),
  linkJavaProject: () => ipcRenderer.invoke("javaProject:link"),
  openRecentJavaProject: (id: string) => ipcRenderer.invoke("javaProject:openRecent", id),
  refreshJavaProject: () => ipcRenderer.invoke("javaProject:refresh"),
  installJavaSupport: () => ipcRenderer.invoke("javaProject:installSupport"),
  buildJavaCatalog: () => ipcRenderer.invoke("javaProject:buildCatalog"),
  cancelJavaCatalogBuild: () => ipcRenderer.invoke("javaProject:cancelBuild"),
  getRobotPairing: (): Promise<RobotPairing | null> => ipcRenderer.invoke("robot:getPairing"),
  probeRobot: (endpoint: RobotEndpoint): Promise<RobotProbe> => ipcRenderer.invoke("robot:probe", endpoint),
  confirmRobotPairing: (hostKeyFingerprint: string, runtimeId: string): Promise<RobotPairing> => ipcRenderer.invoke("robot:confirmPairing", hostKeyFingerprint, runtimeId),
  inspectPairedRobot: (): Promise<RobotRuntimeStatus> => ipcRenderer.invoke("robot:inspect"),
  inspectRobotRetention: (project: BordeauxProject): Promise<{ status: RobotRuntimeStatus; localRevisionId: string }> => ipcRenderer.invoke("robot:inspectRetention", project),
  prepareRobotPush: (project: BordeauxProject): Promise<RobotPushPreview> => ipcRenderer.invoke("robot:preparePush", project),
  confirmRobotPush: (operationId: string): Promise<RobotPushResult | {
    operationId: string;
    state: "failed" | "cancelled";
    boundary: "upload" | "staging";
    message: string;
  }> => ipcRenderer.invoke("robot:confirmPush", operationId),
  cancelRobotPush: (operationId: string): Promise<{ canceled: boolean; boundary?: "review" | "upload" }> => ipcRenderer.invoke("robot:cancelPush", operationId),
  onRobotPushState: (handler: (progress: RobotPushProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: RobotPushProgress) => handler(progress);
    ipcRenderer.on("robot:pushState", listener);
    return () => ipcRenderer.removeListener("robot:pushState", listener);
  },
  prepareRobotRetention: (project: BordeauxProject, action: "rollback" | "pin", target: { revisionId: string; payloadSha256: string }): Promise<RobotRetentionPreview> => ipcRenderer.invoke("robot:prepareRetention", project, action, target),
  confirmRobotRetention: (operationId: string): Promise<RobotRetentionOperationResult | {
    operationId: string;
    state: "failed" | "cancelled";
    boundary: "upload" | "staging";
    message: string;
  }> => ipcRenderer.invoke("robot:confirmRetention", operationId),
  cancelRobotRetention: (operationId: string): Promise<{ canceled: boolean; boundary?: "review" | "upload" }> => ipcRenderer.invoke("robot:cancelRetention", operationId),
  onRobotRetentionState: (handler: (progress: RobotRetentionProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: RobotRetentionProgress) => handler(progress);
    ipcRenderer.on("robot:retentionState", listener);
    return () => ipcRenderer.removeListener("robot:retentionState", listener);
  },
  setDirty: (dirty: boolean) => ipcRenderer.send("project:setDirty", dirty),
  publishAgentSession: (snapshot: AgentSessionSnapshot) => ipcRenderer.send("agent:publishSession", snapshot),
  updateAgentProposalStatus: (proposalId: string, status: "applied" | "rejected" | "stale", revision?: number) => ipcRenderer.send("agent:proposalStatus", proposalId, status, revision),
  acknowledgeAgentProposal: (proposalId: string, sessionId: string, revision: number, activePathId: string, accepted = true) => ipcRenderer.send("agent:proposalReceipt", proposalId, sessionId, revision, activePathId, accepted),
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
};

export type BordeauxAPI = typeof bordeauxAPI;

contextBridge.exposeInMainWorld("bordeauxAPI", bordeauxAPI);
