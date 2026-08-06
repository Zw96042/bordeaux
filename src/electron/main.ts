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
    integration,
    bookmarkId: linkedJavaProjectBookmarkId!,
    recentProjects: summarizeJavaProjectBookmarks(javaProjectBookmarks),
    ...((warning || integrationWarning) ? { warning: [warning, integrationWarning].filter(Boolean).join(" ") } : {}),
  };
}

async function assertSafeJavaExportTarget(projectRoot: string, fileName: string): Promise<string> {
  const relativeDirectory = path.join("src", "main", "deploy", "bordeaux");
  let current = projectRoot;
  for (const component of relativeDirectory.split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Java export path ${path.relative(projectRoot, current)} must be a regular directory`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await fs.promises.mkdir(path.join(projectRoot, relativeDirectory), { recursive: true });
  const directory = await fs.promises.realpath(path.join(projectRoot, relativeDirectory));
  if (directory !== projectRoot && !directory.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Java export destination escaped the linked project");
  const target = path.join(directory, fileName);
  try {
    const stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Existing Java export target must be a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

async function javaExportTargetSnapshot(target: string): Promise<string> {
  try {
    const stat = await fs.promises.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Existing Java export target must be a regular file");
    if (stat.size > 64 * 1024 * 1024) throw new Error("Existing Java export target exceeds the 64 MiB safety limit");
    const hash = createHash("sha256").update(await fs.promises.readFile(target)).digest("hex");
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${hash}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return listener(event, ...args);
  });
}

function createWindow() {
  currentProjectPath = null;
  dirty = false;
  allowClose = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Bordeaux",
    backgroundColor: "#12151b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const window = mainWindow;
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("did-start-loading", () => {
    rejectProposalReceipts("The Bordeaux editor reloaded before acknowledging the proposal.");
    agentSessions.clearSnapshot();
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on("close", (event) => {
    if (allowClose || !dirty) return;
    event.preventDefault();
    if (smokeDirectory) {
      smokeCloseGuardTriggered = true;
      return;
    }
    void dialog.showMessageBox(window, {
      type: "warning",
      title: "Unsaved Bordeaux project",
      message: "Discard unsaved changes?",
      detail: "Save the project first if you want to keep your latest path and routine edits.",
      buttons: ["Cancel", "Save Project…", "Discard Changes"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response === 1) {
        sendCommand("save-project");
      } else if (response === 2) {
        allowClose = true;
        window.close();
      }
    });
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    rejectProposalReceipts("The Bordeaux editor closed before acknowledging the proposal.");
    agentSessions.clearSnapshot();
    currentProjectPath = null;
    dirty = false;
    allowClose = false;
  });

  void window.webContents.session.clearCache().finally(() => {
    if (!window.isDestroyed()) void window.loadFile(path.join(__dirname, "../../public/legacy/index.html"));
  });

  if (process.env.BORDEAUX_SMOKE_TEST === "1") {
    window.webContents.once("did-finish-load", async () => {
