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
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readProjectFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  const project = JSON.parse(raw) as BordeauxProject;
  const validation = validateProject(project);
  if (!validation.ok) {
    const message = validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n");
    throw new Error(`Invalid project file:\n${message}`);
  }
  rememberFile(filePath);
  return { path: filePath, project };
}

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Open Bordeaux Project",
    properties: ["openFile"],
    filters: [{ name: "Bordeaux Project", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return readProjectFile(result.filePaths[0]);
});

ipcMain.handle("project:openRecent", async (_event, filePath: string) => readProjectFile(filePath));

ipcMain.handle("project:save", async (_event, project: BordeauxProject, savePath?: string | null) => {
  let target = savePath ?? null;
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Bordeaux Project",
      defaultPath: `${project.name || "project"}.bordeaux.json`,
      filters: [{ name: "Bordeaux Project", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  await fs.writeFile(target, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  rememberFile(target);
  return { path: target };
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
