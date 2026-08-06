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
  const recentSubmenu =
    recentFiles.length > 0
      ? recentFiles.map((filePath) => ({
          label: path.basename(filePath),
          sublabel: filePath,
          click: () => sendCommand("open-recent", filePath),
        }))
      : [{ label: "No Recent Projects", enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-project") },
        { label: "Open Project...", accelerator: "CmdOrCtrl+O", click: () => sendCommand("open-project") },
        { label: "Open Recent", submenu: recentSubmenu },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendCommand("save-project") },
        { label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", click: () => sendCommand("save-project-as") },
        { type: "separator" },
        { label: "Export .bdx...", accelerator: "CmdOrCtrl+E", click: () => sendCommand("export-bdx") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
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
