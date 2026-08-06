import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildLabviewBdx } from "../shared/export/labviewBdx";
import { buildJavaTrajectory, javaTrajectoryFileName } from "../shared/export/javaTrajectory";
import type { BordeauxProject, JavaCommandCatalog, JavaIntegrationStatus } from "../shared/types";
import type { AgentSessionSnapshot } from "../shared/agent/types";
import { validateProject } from "../shared/validation";
import { discoverJavaProject, readableJavaProjectError } from "./javaProject";
import {
  type JavaProjectBookmark,
  readJavaProjectBookmarks,
  rememberJavaProject,
  summarizeJavaProjectBookmarks,
  writeJavaProjectBookmarks,
} from "./javaProjectBookmarks";
import { readProject, saveTargetForOpenedProject, writeBufferAtomically, writeProject } from "./projectFiles";
import {
  applyJavaSupportInstall,
  cancelJavaCatalogBuild,
  inspectJavaSupport,
  installPreviewSummary,
  prepareJavaSupportInstall,
  runJavaCatalogBuild,
} from "./javaSupport";
import { AgentBridgeClient, AgentBridgeServer } from "./agentBridge";
import { AgentSessionService } from "./agentSession";
import { serveBordeauxMcp } from "../mcp/server";

let mainWindow: BrowserWindow | null = null;
let recentFiles: string[] = [];
let currentProjectPath: string | null = null;
let dirty = false;
let allowClose = false;
let smokeCloseGuardTriggered = false;
let linkedJavaProjectPath: string | null = null;
let linkedJavaProjectBookmarkId: string | null = null;
let linkedJavaCatalog: JavaCommandCatalog | null = null;
let linkedJavaIntegration: JavaIntegrationStatus | null = null;
let javaProjectBookmarks: JavaProjectBookmark[] = [];
const smokeDirectory = process.env.BORDEAUX_SMOKE_DIRECTORY;
const mcpStdioMode = process.argv.includes("--mcp-stdio");
const enableMcpAccessOnLaunch = process.argv.includes("--enable-mcp-access");
let agentBridge: AgentBridgeServer | null = null;
const proposalReceipts = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

function rejectProposalReceipts(message: string): void {
  for (const receipt of proposalReceipts.values()) {
    clearTimeout(receipt.timer);
    receipt.reject(new Error(message));
  }
  proposalReceipts.clear();
}

const agentSessions = new AgentSessionService(
  (proposal, requireReceipt) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) throw new Error("The Bordeaux editor is not ready to preview an agent proposal.");
    if (!requireReceipt) {
      mainWindow.webContents.send("agent:proposal", proposal);
      return;
    }
    const receipt = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        proposalReceipts.delete(proposal.id);
        reject(new Error("The Bordeaux editor did not acknowledge the proposal preview."));
      }, 2_000);
      proposalReceipts.set(proposal.id, { resolve, reject, timer });
    });
    mainWindow.webContents.send("agent:proposal", proposal);
    return receipt;
  },
  () => linkedJavaCatalog,
);

app.setName("Bordeaux");
app.setAppUserModelId("org.frc2468.bordeaux");

function rememberFile(filePath: string, saveTarget: string | null = filePath) {
  currentProjectPath = saveTarget;
  recentFiles = [filePath, ...recentFiles.filter((item) => item !== filePath)].slice(0, 8);
  app.addRecentDocument(filePath);
  buildMenu();
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Unauthorized renderer request");
  }
}

function javaProjectBookmarksFile(): string {
  const directory = smokeDirectory ?? app.getPath("userData");
  return path.join(directory, "java-projects.json");
}

function javaSupportArtifactsDirectory(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "java") : path.resolve(__dirname, "../../java/dist");
}

async function rememberLinkedJavaProject(projectPath: string, projectName: string): Promise<string | undefined> {
  javaProjectBookmarks = rememberJavaProject(javaProjectBookmarks, projectPath, projectName);
  linkedJavaProjectBookmarkId = javaProjectBookmarks[0].id;
  try {
    await writeJavaProjectBookmarks(javaProjectBookmarksFile(), javaProjectBookmarks);
    return undefined;
  } catch (error) {
    console.warn("Could not save Java project bookmarks:", error);
    return "The project is linked for this session, but Bordeaux could not save it to Recent projects.";
  }
}

async function connectJavaProject(projectPath: string) {
  const canonicalPath = await fs.promises.realpath(projectPath);
  const catalog = await discoverJavaProject(canonicalPath);
  let integration: JavaIntegrationStatus;
  let integrationWarning: string | undefined;
  try {
    integration = await inspectJavaSupport(canonicalPath, catalog, javaSupportArtifactsDirectory());
  } catch (error) {
    integration = {
      installed: false,
      generatedCatalog: catalog.authoritative === true,
      ...(catalog.catalogHash ? { catalogHash: catalog.catalogHash } : {}),
      buildFile: "build.gradle",
      wrapperAvailable: false,
    };
    integrationWarning = error instanceof Error ? error.message : String(error);
  }
  linkedJavaProjectPath = canonicalPath;
  linkedJavaCatalog = catalog;
  linkedJavaIntegration = integration;
  const warning = await rememberLinkedJavaProject(canonicalPath, catalog.projectName);
  return {
    catalog,
});

ipcMain.handle("project:exportBdx", async (_event, project: BordeauxProject, outputPath?: string | null) => {
  const exportData = buildBdxExport(project);
  let target = outputPath ?? null;
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export Bordeaux Trajectories",
      defaultPath: `${project.name || "trajectories"}.bdx`,
      filters: [{ name: "Bordeaux Trajectory Export", extensions: ["bdx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  await fs.writeFile(target, `${JSON.stringify(exportData, null, 2)}\n`, "utf8");
  return { path: target, export: exportData };
});

ipcMain.handle("project:validate", (_event, project: BordeauxProject) => validateProject(project));
ipcMain.handle("shell:showItem", (_event, filePath: string) => shell.showItemInFolder(filePath));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
