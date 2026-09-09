import type { RobotFileEndpoint, RobotFileConnection, RobotFilePreview, RobotFileResult } from "../shared/robotFileDelivery";
import type { RobotPushScope, RobotDeploymentComparison } from "../shared/export/robotDeployment";
import { contextBridge, ipcRenderer } from "electron";
import type { BordeauxProject, RobotDeliveryCapabilities } from "../shared/types";
import type { AgentProposal, AgentSessionSnapshot } from "../shared/agent/types";
import type { RobotEndpoint, RobotPairing, RobotProbe, RobotRuntimeStatus } from "./robotSftpTransport";
import type { RobotPushPreview, RobotPushProgress, RobotPushResult } from "./robotPush";
import type { RobotRetentionOperationResult, RobotRetentionPreview, RobotRetentionProgress } from "./robotRetention";

const bordeauxAPI = {
  platform: process.platform,
  robotDeliveryCapabilities: Object.freeze({ pathPush: true, routinePush: false, fileTransfer: true } satisfies RobotDeliveryCapabilities),
  getRobotFileConnection: (): Promise<RobotFileConnection | null> => ipcRenderer.invoke("robotFiles:connection"),
  probeRobotFiles: (endpoint: RobotFileEndpoint): Promise<RobotFileConnection> => ipcRenderer.invoke("robotFiles:probe", endpoint),
  trustRobotFiles: (fingerprint: string): Promise<RobotFileConnection> => ipcRenderer.invoke("robotFiles:trust", fingerprint),
  prepareRobotFiles: (project: BordeauxProject, pathIds: string[]): Promise<RobotFilePreview> => ipcRenderer.invoke("robotFiles:prepare", project, pathIds),
  confirmRobotFiles: (operationId: string): Promise<RobotFileResult> => ipcRenderer.invoke("robotFiles:confirm", operationId),
  cancelRobotFiles: (operationId: string): Promise<{ canceled: boolean }> => ipcRenderer.invoke("robotFiles:cancel", operationId),
  exportBdx: (project: BordeauxProject, pathId: string) => ipcRenderer.invoke("project:exportBdx", project, pathId),
  getProjectLocation: () => ipcRenderer.invoke("project:location"),
  openProjectFolder: () => ipcRenderer.invoke("project:openFolder"),
  openProject: () => ipcRenderer.invoke("project:open"),
  openRecentProject: (index: number) => ipcRenderer.invoke("project:openRecent", index),
  restoreLastProject: () => ipcRenderer.invoke("project:restoreLast"),
  newProject: () => ipcRenderer.invoke("project:new"),
  saveProject: (project: BordeauxProject, saveAs = false) => ipcRenderer.invoke("project:save", project, saveAs),
  autosaveProject: (project: BordeauxProject) => ipcRenderer.invoke("project:autosave", project),
  previewBetaDiagnostic: (project: BordeauxProject) => ipcRenderer.invoke("diagnostics:preview", project),
  saveBetaDiagnostic: (previewId: string) => ipcRenderer.invoke("diagnostics:save", previewId),
  validateProject: (project: BordeauxProject) => ipcRenderer.invoke("project:validate", project),
  listRecentRobotProjects: () => ipcRenderer.invoke("robotProject:listRecent"),
  linkRobotProject: () => ipcRenderer.invoke("robotProject:link"),
  openRecentRobotProject: (id: string) => ipcRenderer.invoke("robotProject:openRecent", id),
  refreshRobotProject: () => ipcRenderer.invoke("robotProject:refresh"),
  inspectLabviewCommands: () => ipcRenderer.invoke("robotProject:inspectLabview"),
  buildRobotCatalog: () => ipcRenderer.invoke("robotProject:buildCatalog"),
  getRobotPairing: (): Promise<RobotPairing | null> => ipcRenderer.invoke("robot:getPairing"),
  probeRobot: (endpoint: RobotEndpoint): Promise<RobotProbe> => ipcRenderer.invoke("robot:probe", endpoint),
  confirmRobotPairing: (hostKeyFingerprint: string, runtimeId: string): Promise<RobotPairing> => ipcRenderer.invoke("robot:confirmPairing", hostKeyFingerprint, runtimeId),
  inspectPairedRobot: (): Promise<RobotRuntimeStatus> => ipcRenderer.invoke("robot:inspect"),
  inspectRobotRetention: (project: BordeauxProject): Promise<{ status: RobotRuntimeStatus; localRevisionId: string }> => ipcRenderer.invoke("robot:inspectRetention", project),
  inspectRobotLibrary: (project: BordeauxProject): Promise<{ status: RobotRuntimeStatus; comparison: RobotDeploymentComparison | null; verifiedAt: string; message?: string }> => ipcRenderer.invoke("robot:inspectLibrary", project),
  prepareRobotPush: (project: BordeauxProject, scope?: RobotPushScope): Promise<RobotPushPreview> => ipcRenderer.invoke("robot:preparePush", project, scope),
  confirmRobotPush: (operationId: string, adoptBaseline = false): Promise<RobotPushResult | {
    operationId: string;
    state: "failed" | "cancelled";
    boundary: "upload" | "staging";
    message: string;
  }> => ipcRenderer.invoke("robot:confirmPush", operationId, adoptBaseline),
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
