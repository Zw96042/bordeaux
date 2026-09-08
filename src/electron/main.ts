import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, clipboard, dialog, ipcMain, Menu } from "electron";
import { autoUpdater as updateClient } from "electron-updater";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { robotCatalogSemanticSignature } from "../shared/agent/catalogSignature";
import type { BordeauxProject, RobotCommandCatalog, RobotIntegrationStatus } from "../shared/types";
import type { AgentSessionSnapshot } from "../shared/agent/types";
import { createDemoProject } from "../shared/project/defaults";
import { validateProject } from "../shared/validation";
import { prepareBdxBindings } from "./bdxBindings";
import { buildBdxOffThread } from "./bdxWorkerClient";
import { buildLabviewCatalog, resolveLabviewProject } from "./labviewProject";
import { inspectLabviewCommands, withCachedLabviewCommands } from "./labviewNiInspection";
function readableRobotProjectError(error: unknown, name = "LabVIEW project"): Error { return new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
import { discoverRobotProject, type RobotProjectRuntime } from "./robotProjectRuntime";
import {
  type RobotProjectBookmark,
  readRobotProjectBookmarks,
  rememberRobotProject,
  summarizeRobotProjectBookmarks,
  writeRobotProjectBookmarks,
} from "./robotProjectBookmarks";
import { readProject, saveTargetForOpenedProject, writeBufferAtomically, openProjectFolder, autosaveProjectFolder, projectFileName } from "./projectFiles";
import { readRecentProjectFiles, rememberRecentProject, writeRecentProjectFiles } from "./recentProjectFiles";
import { AgentBridgeClient, AgentBridgeServer } from "./agentBridge";
import { appUpdateChannel, AppUpdateController, usesGitHubAppUpdates } from "./appUpdates";
import {
  DiagnosticBundleCapability,
  buildDiagnosticBundle,
  diagnosticFieldPin,
  saveDiagnosticPreview,
  type DiagnosticBundleInput,
  type DiagnosticRobotAcknowledgement,
} from "./diagnosticBundle";
import { AgentSessionService } from "./agentSession";
import { runAgentPlanningInWorker } from "./agentPlanningWorkerClient";
import { quitAfterMcpInputEnds } from "./mcpStdioLifecycle";
import { serveBordeauxMcp } from "../mcp/server";
import { RobotPairingController, readRobotPairing, writeRobotPairing } from "./robotPairings";
import { connectRobotSftp } from "./robotSsh2Session";
import {
  BordeauxRobotTransport,
  type RobotEndpoint,
} from "./robotSftpTransport";

function ignoreClosedStandardStream(error: NodeJS.ErrnoException): void {
  if (error.code !== "EIO" && error.code !== "EPIPE") throw error;
}

process.stdout.on("error", ignoreClosedStandardStream);
process.stderr.on("error", ignoreClosedStandardStream);

let mainWindow: BrowserWindow | null = null;
let recentFiles: string[] = [];
let currentProjectPath: string | null = null;
let currentProjectFolder: string | null = null;
function projectLocation() { return { folderPath: currentProjectFolder, projectPath: currentProjectPath }; }
let projectTargetGeneration = 0;
let dirty = false;
let allowClose = false;
let appUpdates: AppUpdateController | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let backgroundShutdownPromise: Promise<void> | null = null;
let backgroundServicesReadyForExit = false;
let finalQuitInProgress = false;

let smokeCloseGuardTriggered = false;
let linkedRobotProjectPath: string | null = null;
let linkedLabviewProjectFile: string | null = null;
let labviewInspectionInProgress = false;
let linkedRobotProjectBookmarkId: string | null = null;
let linkedRobotCatalog: RobotCommandCatalog | null = null;
let linkedRobotIntegration: RobotIntegrationStatus | null = null;
let robotConnectionGeneration = 0;
let robotProjectBookmarks: RobotProjectBookmark[] = [];
let robotPairings = new RobotPairingController();
const robotTransport = new BordeauxRobotTransport(connectRobotSftp);
const diagnosticBundleCapability = new DiagnosticBundleCapability();
let lastDiagnosticRobotAcknowledgement: DiagnosticRobotAcknowledgement = { state: "not-observed" };
const smokeDirectory = process.env.BORDEAUX_SMOKE_DIRECTORY;
const mcpStdioMode = process.argv.includes("--mcp-stdio");
const enableMcpAccessOnLaunch = process.argv.includes("--enable-mcp-access");
let agentBridge: AgentBridgeServer | null = null;
const proposalReceipts = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

function clearLinkedRobotProject(): void {
  robotConnectionGeneration += 1;
  linkedRobotProjectPath = null;
  linkedLabviewProjectFile = null;
  linkedRobotProjectBookmarkId = null;
  linkedRobotCatalog = null;
  linkedRobotIntegration = null;
  agentSessions.refreshRobotCatalog();
}

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
  () => linkedRobotCatalog,
  runAgentPlanningInWorker,
);

app.setName("Bordeaux");
if (smokeDirectory) app.setPath("userData", smokeDirectory);
app.setAppUserModelId("org.frc2468.bordeaux");
const ownsDesktopInstance = mcpStdioMode || app.requestSingleInstanceLock();
if (!ownsDesktopInstance) app.quit();

function showUpdateMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const window = mainWindow;
  return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function stopBackgroundServices(): Promise<void> {
  diagnosticBundleCapability.clear();
  rejectProposalReceipts("Bordeaux is shutting down.");
  if (backgroundShutdownPromise) return backgroundShutdownPromise;
  const bridge = agentBridge;
  agentBridge = null;
  if (!bridge) return Promise.resolve();
  backgroundShutdownPromise = bridge.stop();
  return backgroundShutdownPromise;
}

function createAppUpdateController(): AppUpdateController {
  const supported = usesGitHubAppUpdates(
    process.platform,
    process.windowsStore,
    process.env.PORTABLE_EXECUTABLE_FILE !== undefined,
    process.env.APPIMAGE !== undefined,
  );
  if (supported) nativeAutoUpdater.on("before-quit-for-update", () => { allowClose = true; });
  const packaged = app.isPackaged;
  return new AppUpdateController(packaged && supported ? updateClient : null, {
    available: async (version, releaseNotes) => {
      const result = await showUpdateMessage({ type: "info", title: "Bordeaux update available", message: `Bordeaux ${version} is available`, detail: releaseNotes, buttons: ["Later", "Download Update"], defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 1 ? "download" : "later";
    },
    unavailable: (currentVersion) => showUpdateMessage({
      type: "info",
      title: "Bordeaux updates",
      message: "Update checks are available in installed builds.",
      detail: `Bordeaux ${currentVersion} can update automatically from a macOS install, Windows setup install, or Linux AppImage. Store and portable builds use their distribution channel.`,
      buttons: ["OK"],
    }).then(() => undefined),
    downloading: (version) => showUpdateMessage({
      type: "info",
      title: "Bordeaux update found",
      message: `Downloading Bordeaux ${version}…`,
      detail: "Bordeaux will let you know when the update is ready to install.",
      buttons: ["OK"],
    }).then(() => undefined),
    upToDate: (currentVersion) => showUpdateMessage({
      type: "info",
      title: "Bordeaux updates",
      message: "Bordeaux is up to date.",
      detail: `You are running Bordeaux ${currentVersion} on the ${appUpdateChannel(currentVersion) === "beta" ? "beta" : "production"} channel.`,
      buttons: ["OK"],
    }).then(() => undefined),
    failed: (message) => showUpdateMessage({
      type: "error",
      title: "Bordeaux update failed",
      message: "Bordeaux could not complete the update.",
      detail: message,
      buttons: ["OK"],
    }).then(() => undefined),
    ready: async (version, projectDirty) => {
      const result = await showUpdateMessage(projectDirty ? {
        type: "info",
        title: "Bordeaux update ready",
        message: `Bordeaux ${version} has been downloaded.`,
        detail: "Save or discard the current project, then choose Check for Updates again to install it.",
        buttons: ["Later"],
      } : {
        type: "info",
        title: "Bordeaux update ready",
        message: `Restart to install Bordeaux ${version}?`,
        detail: "Bordeaux will close, install the downloaded update, and reopen.",
        buttons: ["Later", "Restart and Update"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return !projectDirty && result.response === 1 ? "restart" : "later";
    },
  }, {
    packaged,
    supported,
    currentVersion: app.getVersion(),
    isProjectDirty: () => dirty,
    prepareToInstall: async () => {
      await stopBackgroundServices();
      if (dirty) throw new Error("The project changed while Bordeaux was preparing the update. Save or discard it, then try again.");
      backgroundServicesReadyForExit = true;
      allowClose = true;
    },
    warn: (message, error) => console.warn(message, error),
  });
}

function activateProjectTarget(filePath: string | null): void {
  currentProjectPath = filePath;
  currentProjectFolder = filePath ? path.dirname(filePath) : null;
  projectTargetGeneration += 1;
}

async function rememberFile(filePath: string) {
  recentFiles = rememberRecentProject(recentFiles, filePath);
  app.addRecentDocument(filePath);
  buildMenu();
  try {
    await writeRecentProjectFiles(recentProjectsFile(), recentFiles);
  } catch (error) {
    console.warn("Could not save recent Bordeaux projects:", error);
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Unauthorized renderer request");
  }
}

function robotProjectBookmarksFile(): string {
  const directory = smokeDirectory ?? app.getPath("userData");
  return path.join(directory, "robot-projects.json");
}

function recentProjectsFile(): string {
  const directory = smokeDirectory ?? app.getPath("userData");
  return path.join(directory, "recent-projects.json");
}

function robotPairingFile(): string {
  const directory = smokeDirectory ?? app.getPath("userData");
  return path.join(directory, "robot-pairing.json");
}





function labviewDiscoveryCacheDirectory(): string {
  return path.join(smokeDirectory ?? app.getPath("userData"), "labview-discovery");
}

async function rememberLinkedRobotProject(projectPath: string, projectName: string, runtime: RobotProjectRuntime): Promise<{ bookmarkId: string; warning?: string }> {
  robotProjectBookmarks = rememberRobotProject(robotProjectBookmarks, projectPath, projectName, new Date(), runtime);
  const bookmarkId = robotProjectBookmarks[0].id;
  try {
    await writeRobotProjectBookmarks(robotProjectBookmarksFile(), robotProjectBookmarks);
    return { bookmarkId };
  } catch (error) {
    console.warn("Could not save Robot project bookmarks:", error);
    return { bookmarkId, warning: "The project is linked for this session, but Bordeaux could not save it to Recent projects." };
  }
}

async function connectRobotProject(projectPath: string, runtime: RobotProjectRuntime, inspectedCatalog?: RobotCommandCatalog) {
  const generation = ++robotConnectionGeneration;
  const selectedPath = await fs.promises.realpath(projectPath);
  const labviewProject = runtime === "labview" ? await resolveLabviewProject(selectedPath) : null;
  const canonicalPath = labviewProject?.root ?? selectedPath;
  const exactSelection = labviewProject?.projectFile ?? selectedPath;
  const diskCatalog = await discoverRobotProject(exactSelection, runtime);
  const discoveredCatalog = inspectedCatalog ?? (runtime === "labview"
    ? await withCachedLabviewCommands(exactSelection, diskCatalog, labviewDiscoveryCacheDirectory())
    : diskCatalog);
  const catalog: RobotCommandCatalog = {
    ...discoveredCatalog,
    semanticFingerprint: `sha256:${createHash("sha256").update(robotCatalogSemanticSignature(discoveredCatalog), "utf8").digest("hex")}`,
  };
  const integration: RobotIntegrationStatus = {
    installed: catalog.authoritative === true,
    generatedCatalog: catalog.authoritative === true,
    supportVersion: catalog.supportVersion,
    ...(catalog.catalogHash ? { catalogHash: catalog.catalogHash } : {}),
    buildFile: "bordeaux-catalog.json",
    runtime: "labview",
    wrapperAvailable: true,
  };
  const integrationWarning: string | undefined = undefined;
  const remembered = await rememberLinkedRobotProject(exactSelection, catalog.projectName, runtime);
  if (generation !== robotConnectionGeneration) throw new Error("LabVIEW project connection was superseded by another project");
  linkedRobotProjectPath = canonicalPath;
  linkedLabviewProjectFile = labviewProject?.projectFile ?? null;
  linkedRobotProjectBookmarkId = remembered.bookmarkId;
  linkedRobotCatalog = catalog;
  linkedRobotIntegration = integration;
  agentSessions.refreshRobotCatalog();
  return {
    catalog,
    integration,
    bookmarkId: remembered.bookmarkId,
    recentProjects: summarizeRobotProjectBookmarks(robotProjectBookmarks),
    ...((remembered.warning || integrationWarning) ? { warning: [remembered.warning, integrationWarning].filter(Boolean).join(" ") } : {}),
  };
}

async function replaceRobotProject(projectPath: string, runtime: RobotProjectRuntime) {
  const pending = connectRobotProject(projectPath, runtime);
  const generation = robotConnectionGeneration;
  try {
    return await pending;
  } catch (error) {
    if (generation === robotConnectionGeneration) clearLinkedRobotProject();
    throw error;
  }
}

async function robotExportTargetSnapshot(target: string): Promise<string> {
  try {
    const stat = await fs.promises.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Existing Robot export target must be a regular file");
    if (stat.size > 64 * 1024 * 1024) throw new Error("Existing Robot export target exceeds the 64 MiB safety limit");
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

function diagnosticCatalog(catalog: RobotCommandCatalog | null): DiagnosticBundleInput["catalog"] {
  if (!catalog?.authoritative || !catalog.catalogId || !catalog.catalogHash || !catalog.supportVersion
    || (catalog.generatedSchemaVersion !== "1.0" && catalog.generatedSchemaVersion !== "1.1" && catalog.generatedSchemaVersion !== "1.2" && catalog.generatedSchemaVersion !== "1.3")) {
    return null;
  }
  return {
    schemaVersion: catalog.generatedSchemaVersion,
    catalogId: catalog.catalogId,
    catalogHash: catalog.catalogHash,
    supportVersion: catalog.supportVersion,
  };
}

function diagnosticIssueCount(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  return Math.max(1, Math.min(1_000, message.split("\n").filter((line) => line.trim()).length));
}

function createWindow() {
  activateProjectTarget(null);
  dirty = false;
  allowClose = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Bordeaux",
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 14, y: 18 },
    } : {}),
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
  window.once("ready-to-show", () => {
    window.show();
    if (appUpdates?.available && !updateCheckTimer) {
      updateCheckTimer = setTimeout(() => {
        void appUpdates?.check(false);
        updateCheckTimer = setInterval(() => { void appUpdates?.check(false); }, 6 * 60 * 60 * 1000);
        updateCheckTimer.unref();
      }, 10_000);
      updateCheckTimer.unref();
    }
  });
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
    activateProjectTarget(null);
    dirty = false;
    allowClose = false;
  });

  void window.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));

  if (process.env.BORDEAUX_SMOKE_TEST === "1") {
    window.webContents.once("did-finish-load", async () => {
      let inputRunning = false;
      const inputTimer = setInterval(() => {
        if (inputRunning || window.isDestroyed()) return;
        inputRunning = true;
        void window.webContents.executeJavaScript('window.__bordeauxSmokeInput || null').then(async (point) => {
          if (!point) return;
          window.focus();
          window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'M' });
          window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'M' });
          await new Promise((resolve) => setTimeout(resolve, 30));
          window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
          window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
          window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
          await window.webContents.executeJavaScript('window.__bordeauxSmokeInput = null');
        }).catch(() => undefined).finally(() => { inputRunning = false; });
      }, 10);
      try {
        if (!smokeDirectory) throw new Error("Smoke test requires a fixture directory");
        if (process.platform === "darwin") app.focus({ steal: true });
        window.show();
        window.focus();
        const smokeScript = await fs.promises.readFile(path.join(smokeDirectory, "renderer.js"), "utf8");
        const result: Record<string, unknown> = await window.webContents.executeJavaScript(smokeScript);
        if (process.env.BORDEAUX_SMOKE_CAPTURE_PATH) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const capture = await window.webContents.capturePage();
          await fs.promises.writeFile(process.env.BORDEAUX_SMOKE_CAPTURE_PATH, capture.toPNG());
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        window.close();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const filesWritten = fs.existsSync(path.join(smokeDirectory, "project.bordeaux")) && fs.existsSync(path.join(smokeDirectory, "Smoke.bdx")) && fs.existsSync(path.join(smokeDirectory, "Paths")) && fs.existsSync(path.join(smokeDirectory, "Routines"));
        result.filesWritten = filesWritten;
        result.closeGuard = smokeCloseGuardTriggered && !window.isDestroyed();
        clearInterval(inputTimer);
        console.log(`BORDEAUX_SMOKE_RESULT ${JSON.stringify(result)}`);
        allowClose = true;
        await stopBackgroundServices();
        backgroundServicesReadyForExit = true;
        app.exit(0);
      } catch (error) {
        clearInterval(inputTimer);
        console.error("BORDEAUX_SMOKE_FAILED", error);
        app.exit(1);
      }
    });
  }
}

function sendCommand(command: string, payload?: unknown) {
  mainWindow?.webContents.send("menu-command", { command, payload });
}

function sendMcpStatus(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("agent:mcpStatus", { enabled: agentBridge?.enabled === true });
}

function updateMenuItem(): Electron.MenuItemConstructorOptions {
  return process.windowsStore
    ? { label: "Updates are managed by Microsoft Store", enabled: false }
    : { label: "Check for Updates…", click: () => { void appUpdates?.check(true); } };
}

function buildMenu() {
  const recentSubmenu = recentFiles.length > 0
    ? recentFiles.map((filePath, index) => ({ label: path.basename(filePath), sublabel: filePath, click: () => sendCommand("open-recent", index) }))
    : [{ label: "No Recent Projects", enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [
      { role: "about" },
      updateMenuItem(),
      { type: "separator" },
      { role: "quit" },
    ] } as Electron.MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-project") },
        { label: "Open Project...", accelerator: "CmdOrCtrl+O", click: () => sendCommand("open-project") },
        { label: "Open Recent", submenu: recentSubmenu },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendCommand("save-project") },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+Shift+O", click: () => sendCommand("open-folder") },
        { label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", click: () => sendCommand("save-project-as") },
        { type: "separator" },
        { label: "Export selected path as BDX…", accelerator: "CmdOrCtrl+E", click: () => sendCommand("export-bdx") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Robot",
      submenu: [
        { label: "Link Robot Project…", click: () => sendCommand("robot-link") },
        { label: "Build Command Catalog…", click: () => sendCommand("robot-build") },
        { type: "separator" },
      ],
    },
    {
      label: "Agents",
      submenu: [
        {
          label: "Enable MCP Access",
          type: "checkbox",
          checked: agentBridge?.enabled === true,
          click: () => {
            if (!agentBridge) return;
            const operation = agentBridge.enabled ? agentBridge.stop() : agentBridge.start().then(() => undefined);
            void operation.then(() => { buildMenu(); sendMcpStatus(); }).catch((error) => {
              buildMenu();
              sendMcpStatus();
              void dialog.showErrorBox("Bordeaux MCP access", error instanceof Error ? error.message : String(error));
            });
          },
        },
        {
          label: agentBridge?.enabled ? "MCP access is available to this user" : "MCP access is off",
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Copy MCP Configuration",
          click: () => {
            const electronArgs = app.isPackaged ? ["--mcp-stdio"] : [path.join(__dirname, "main.js"), "--mcp-stdio"];
            const launch = process.platform === "win32"
              ? { command: process.execPath, args: electronArgs }
              : { command: "/usr/bin/env", args: ["-u", "ELECTRON_RUN_AS_NODE", process.execPath, ...electronArgs] };
            clipboard.writeText(JSON.stringify({ mcpServers: { bordeaux: launch } }, null, 2));
          },
        },
      ],
    },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    ...(process.platform === "darwin" ? [] : [{ label: "Help", submenu: [
      updateMenuItem(),
      { type: "separator" },
      { label: `Bordeaux ${app.getVersion()}`, enabled: false },
    ] } as Electron.MenuItemConstructorOptions]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openProjectFile(filePath: string) {
  if ((await fs.promises.lstat(filePath)).isDirectory()) return activateProjectFolder(filePath);
  if (/\.(path|routine)$/i.test(filePath) && ["Paths", "Routines"].includes(path.basename(path.dirname(filePath)))) {
    const folder = path.dirname(path.dirname(filePath));
    if (fs.existsSync(path.join(folder, ".bordeaux-workspace.json"))) {
      const opened = await activateProjectFolder(folder);
      const item = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
      if (opened.project.paths.some((entry) => entry.id === item.id)) opened.project.editor = { ...opened.project.editor, activePathId: item.id };
      if (opened.project.routines.some((entry) => entry.id === item.id)) opened.project.activeRoutineId = item.id;
      return opened;
    }
  }
  const decoded = await readProject(filePath);
  let { project } = decoded;
  const folder = path.dirname(filePath);
  if (fs.existsSync(path.join(folder, ".bordeaux-workspace.json"))) {
    const recovered = await openProjectFolder(folder);
    if (recovered.project && recovered.projectPath && path.resolve(recovered.projectPath) === path.resolve(filePath)) project = recovered.project;
  }
  clearLinkedRobotProject();
  await rememberFile(filePath);
  activateProjectTarget(saveTargetForOpenedProject(filePath, decoded));
  dirty = false;
  currentProjectFolder = path.dirname(filePath);
  return { project, location: projectLocation() };
}

handle("project:open", async () => {
  if (smokeDirectory) return openProjectFile(path.join(smokeDirectory, "project.bordeaux"));
  const result = await dialog.showOpenDialog(mainWindow!, { title: "Open Bordeaux Project or Path", properties: ["openFile"], filters: [{ name: "Bordeaux Project", extensions: ["bordeaux", "path", "json"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return openProjectFile(result.filePaths[0]);
});

handle("project:openRecent", async (_event, rawIndex) => {
  if (!Number.isInteger(rawIndex) || typeof rawIndex !== "number" || rawIndex < 0 || rawIndex >= recentFiles.length) throw new Error("Recent project is no longer available");
  return openProjectFile(recentFiles[rawIndex]);
});

handle("project:restoreLast", async () => {
  if (!recentFiles[0]) return null;
  try {
    return await openProjectFile(recentFiles[0]);
  } catch (error) {
    console.warn("Could not restore the last Bordeaux project:", error);
    return null;
  }
});

handle("project:new", () => {
  activateProjectTarget(null);
  dirty = false;
  clearLinkedRobotProject();
});

handle("project:location", () => projectLocation());
handle("project:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { title: "Open Bordeaux Folder", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  return activateProjectFolder(result.filePaths[0]);
});

async function activateProjectFolder(folder: string) {
  const opened = await openProjectFolder(folder);
  const project = opened.project ?? { ...createDemoProject(), name: path.basename(folder) };
  clearLinkedRobotProject();
  activateProjectTarget(opened.projectPath);
  currentProjectFolder = folder;
  await rememberFile(folder);
  dirty = false;
  return { project, location: projectLocation() };
}

handle("project:save", async (_event, project, rawSaveAs) => {
  const validation = validateProject(project);
  if (!validation.ok) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  const sourceGeneration = projectTargetGeneration;
  let target = rawSaveAs === true ? null : currentProjectPath;
  let createProject = false;
  if (!target) {
    const defaultName = projectFileName((project as BordeauxProject).name || "Project");
    if (smokeDirectory) target = path.join(smokeDirectory, "project.bordeaux");
    else if (currentProjectFolder && rawSaveAs !== true) {
      target = path.join(currentProjectFolder, defaultName);
      createProject = true;
      // A blank-folder Save must not silently replace a file created elsewhere.
      try { await fs.promises.lstat(target); throw new Error("A project with that name already exists. Use Save As to choose a different name."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    } else {
      const result = await dialog.showSaveDialog(mainWindow!, { title: "Save Bordeaux Project", defaultPath: currentProjectFolder ? path.join(currentProjectFolder, defaultName) : defaultName, filters: [{ name: "Bordeaux Project", extensions: ["bordeaux"] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath;
      if (!target.toLowerCase().endsWith(".bordeaux")) target += ".bordeaux";
    }
  }
  await autosaveProjectFolder(path.dirname(target), project, target, { allowRetarget: rawSaveAs === true, createProject });
  await rememberFile(target);
  if (sourceGeneration === projectTargetGeneration && currentProjectPath !== target) activateProjectTarget(target);
  return { saved: true, location: projectLocation() };
});

handle("project:autosave", async (_event, project) => {
  const folder = currentProjectFolder;
  if (!folder) return { saved: false, location: projectLocation() };
  const validation = validateProject(project);
  if (!validation.ok) return { saved: false, error: "Finish the invalid field before saving.", location: projectLocation() };
  try {
    await autosaveProjectFolder(folder, project, currentProjectPath);
    return { saved: true, location: projectLocation() };
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error), location: projectLocation() };
  }
});

handle("project:exportBdx", async (_event, rawProject, rawPathId) => {
  if (typeof rawPathId !== "string" || !rawPathId.trim()) throw new Error("Select a path before exporting BDX");
  const project = rawProject as BordeauxProject;
  const generation = robotConnectionGeneration, projectGeneration = projectTargetGeneration;
  const projectFile = linkedLabviewProjectFile, bookmark = linkedRobotProjectBookmarkId;
  if (projectFile && project.editor?.robotProjectBookmarkId !== bookmark) throw new Error("The linked LabVIEW project does not match this Bordeaux project");
  const assertCurrent = () => {
    if (generation !== robotConnectionGeneration || projectGeneration !== projectTargetGeneration || projectFile !== linkedLabviewProjectFile || bookmark !== linkedRobotProjectBookmarkId) throw new Error("The selected project changed during BDX export; export again");
  };
  const hasCommands = project.paths.find((candidate) => candidate.id === rawPathId)?.markers.some((marker) => marker.invocation);
  const bindingOptions = { projectFile: hasCommands ? projectFile : null, inspectionCacheDirectory: labviewDiscoveryCacheDirectory() };
  const bindings = await prepareBdxBindings(bindingOptions);
  const built = await buildBdxOffThread({ project, selection: { kind: "path", id: rawPathId }, bindings });
  assertCurrent();
  const result = smokeDirectory ? { canceled: false, filePath: path.join(smokeDirectory, "Smoke.bdx") } : await dialog.showSaveDialog(mainWindow!, {
    title: "Export selected path as BDX",
    defaultPath: built.fileName, filters: [{ name: "Bordeaux binary path", extensions: ["bdx"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const target = result.filePath.toLowerCase().endsWith(".bdx") ? result.filePath : result.filePath + ".bdx";
  const before = await robotExportTargetSnapshot(target);
  if (before !== "missing") {
    const review = await dialog.showMessageBox(mainWindow!, { type: "question", title: "Replace BDX file?", message: path.basename(target),
      detail: `${built.sampleCount} samples · ${built.eventCount} events · ${built.bytes.length} bytes\nThis writes a local path file. Robot code validates compatibility before execution.`,
      buttons: ["Cancel", "Replace"], defaultId: 0, cancelId: 0 });
    if (review.response !== 1) return { canceled: true };
  }
  const currentBindings = await prepareBdxBindings(bindingOptions);
  assertCurrent();
  if (currentBindings.definitionJson !== bindings.definitionJson) throw new Error("NI binding evidence changed during BDX export; review and export again");
  if (await robotExportTargetSnapshot(target) !== before) throw new Error("BDX destination changed during review; export again");
  await writeBufferAtomically(target, built.bytes);
  return { exported: true, relativePath: path.basename(target), sha256: built.sha256,
    pathCount: built.pathCount, eventCount: built.eventCount, sampleCount: built.sampleCount };
});

handle("diagnostics:preview", async (_event, rawProject) => {
  const catalog = diagnosticCatalog(linkedRobotCatalog);
  let fieldPin = diagnosticFieldPin(rawProject);
  let exportStatus: DiagnosticBundleInput["export"] = { state: "unavailable" };
  let routinePreflight: DiagnosticBundleInput["routinePreflight"] = { state: "unavailable", issueCount: 0 };
  const linkedProjectMatches = Boolean(linkedRobotProjectBookmarkId
    && rawProject && typeof rawProject === "object"
    && (rawProject as BordeauxProject).editor?.robotProjectBookmarkId === linkedRobotProjectBookmarkId);
  if (catalog && linkedRobotCatalog && linkedRobotIntegration?.installed
    && linkedRobotIntegration.supportVersion === linkedRobotCatalog.supportVersion && linkedProjectMatches) {
    try {
      const project = rawProject as BordeauxProject;
      const selected = project.paths.find((item) => item.id === project.editor?.activePathId) ?? project.paths[0];
      if (!selected) throw new Error("Select a path before preparing export diagnostics");
      const bindings = await prepareBdxBindings({ projectFile: selected.markers.some((marker) => marker.invocation) ? linkedLabviewProjectFile : null, inspectionCacheDirectory: labviewDiscoveryCacheDirectory() });
      const built = await buildBdxOffThread({ project, selection: { kind: "path", id: selected.id }, bindings });
      fieldPin = {
        id: built.document.field.id,
        revision: built.document.field.revision,
        coordinateSchemaId: built.document.field.coordinateSchemaId,
      };
      exportStatus = {
        state: "generated",
        sha256: `sha256:${built.sha256}`,
        pathCount: built.pathCount,
        eventCount: built.eventCount,
        sampleCount: built.sampleCount,
      };
      routinePreflight = { state: "unavailable", issueCount: 0 };
    } catch (error) {
      exportStatus = { state: "invalid" };
      routinePreflight = { state: "failed", issueCount: diagnosticIssueCount(error) };
    }
  }
  const contents = buildDiagnosticBundle({
    generatedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      build: app.isPackaged ? "packaged" : "development",
      channel: appUpdateChannel(app.getVersion()),
    },
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    fieldPin,
    catalog,
    export: exportStatus,
    routinePreflight,
    robotAcknowledgement: lastDiagnosticRobotAcknowledgement,
  });
  return diagnosticBundleCapability.preview(contents);
});

handle("diagnostics:save", async (_event, previewId) => {
  try {
    return await saveDiagnosticPreview(previewId, diagnosticBundleCapability, async (fileName) => {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: "Save Bordeaux beta diagnostic",
        defaultPath: fileName,
        filters: [{ name: "Bordeaux beta diagnostic", extensions: ["json"] }],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    }, writeBufferAtomically);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no longer current")) throw error;
    throw new Error("Bordeaux could not save the beta diagnostic bundle");
  }
});

handle("project:validate", (_event, project) => validateProject(project));
handle("robotProject:listRecent", () => summarizeRobotProjectBookmarks(robotProjectBookmarks));
handle("robotProject:link", async () => {
  let selectedPath: string | undefined;
  if (smokeDirectory) {
    selectedPath = path.join(smokeDirectory, "robot-project", "SmokeRobot.lvproj");
  } else {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Link LabVIEW robot project",
      buttonLabel: "Link Project",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "LabVIEW Project", extensions: ["lvproj"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    selectedPath = result.filePaths[0];
  }
  try {
    const runtime: RobotProjectRuntime = "labview";
    if ((await fs.promises.stat(selectedPath)).isDirectory()) {
      const projects = (await fs.promises.readdir(selectedPath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".lvproj"));
      if (projects.length > 1) {
        const project = await dialog.showOpenDialog(mainWindow!, {
          title: "Choose LabVIEW project",
          buttonLabel: "Link project",
          defaultPath: selectedPath,
          properties: ["openFile"],
          filters: [{ name: "LabVIEW project", extensions: ["lvproj"] }],
        });
        if (project.canceled || !project.filePaths[0]) return null;
        selectedPath = project.filePaths[0];
      }
    }
    return runtime ? await replaceRobotProject(selectedPath, runtime) : null;
  } catch (error) {
    throw readableRobotProjectError(error, "Selected robot project");
  }
});
handle("robotProject:openRecent", async (_event, rawId) => {
  if (typeof rawId !== "string" || rawId.length > 64) throw new Error("Recent robot project selection is invalid");
  const bookmark = robotProjectBookmarks.find((item) => item.id === rawId);
  if (!bookmark) throw new Error("Recent robot project is no longer available");
  try {
    return await replaceRobotProject(bookmark.projectPath, bookmark.runtime);
  } catch (error) {
    throw readableRobotProjectError(error, bookmark.projectName);
  }
});
handle("robotProject:refresh", async () => {
  if (!linkedRobotProjectPath) throw new Error("Link a robot project before refreshing commands");
  try {
    return await connectRobotProject(linkedLabviewProjectFile ?? linkedRobotProjectPath, "labview");
  } catch (error) {
    const bookmark = robotProjectBookmarks.find((item) => item.id === linkedRobotProjectBookmarkId);
    throw readableRobotProjectError(error, bookmark?.projectName);
  }
});
handle("robotProject:inspectLabview", async () => {
  const selection = linkedLabviewProjectFile;
  if (!selection || linkedRobotCatalog?.runtime !== "labview") throw new Error("Link a LabVIEW project before inspecting commands");
  if (labviewInspectionInProgress) throw new Error("LabVIEW command inspection is already in progress");
  const generation = robotConnectionGeneration;
  labviewInspectionInProgress = true;
  try {
    const inspected = await inspectLabviewCommands(selection, labviewDiscoveryCacheDirectory());
    if (generation !== robotConnectionGeneration || selection !== linkedLabviewProjectFile) throw new Error("The linked project changed during command inspection");
    return await connectRobotProject(selection, "labview", inspected);
  } finally {
    labviewInspectionInProgress = false;
  }
});
handle("robotProject:buildCatalog", async () => {
  if (!linkedRobotProjectPath) throw new Error("Link a LabVIEW project before building its command catalog");
  const root = linkedRobotProjectPath;
  const generation = robotConnectionGeneration;
  await buildLabviewCatalog(linkedLabviewProjectFile ?? root);
  if (generation !== robotConnectionGeneration || root !== linkedRobotProjectPath) throw new Error("The linked project changed during catalog build");
  return connectRobotProject(linkedLabviewProjectFile ?? root, "labview");
});

handle("robot:getPairing", () => robotPairings.current());
handle("robot:probe", async (_event, rawEndpoint) => {
  const endpoint = rawEndpoint as RobotEndpoint;
  return robotPairings.probe(() => robotTransport.probe(endpoint, { password: "" }));
});
handle("robot:confirmPairing", async (_event, rawFingerprint, rawRuntimeId) => {
  if (typeof rawFingerprint !== "string" || typeof rawRuntimeId !== "string") {
    throw new Error("Probe the robot before confirming its identity");
  }
  const pairing = await robotPairings.confirm(rawFingerprint, rawRuntimeId, (confirmed) => writeRobotPairing(robotPairingFile(), confirmed));
  return pairing;
});
handle("robot:inspect", async () => {
  const robotPairing = robotPairings.current();
  if (!robotPairing) throw new Error("Pair a robot before inspecting its Bordeaux runtime");
  return robotTransport.inspect(robotPairing, { password: "" });
});
const BDX_RECEIVER_UNAVAILABLE = "Robot delivery needs a LabVIEW BDX receiver with verified transfer and activation support. Export a BDX file locally for now.";
for (const channel of ["robot:inspectRetention", "robot:prepareRetention", "robot:inspectLibrary", "robot:preparePush", "robot:confirmPush", "robot:confirmRetention"]) {
  handle(channel, () => { throw new Error(BDX_RECEIVER_UNAVAILABLE); });
}
handle("robot:cancelPush", () => ({ canceled: false }));
handle("robot:cancelRetention", () => ({ canceled: false }));
handle("agent:getActiveProposal", () => agentSessions.getActiveProposal());
handle("agent:getMcpStatus", () => ({ enabled: agentBridge?.enabled === true }));
ipcMain.on("project:setDirty", (event, value) => { assertTrustedSender(event); dirty = value === true; });
ipcMain.on("agent:publishSession", (event, value) => {
  assertTrustedSender(event);
  if (!agentSessions.tryPublishSnapshot(value as AgentSessionSnapshot)) {
    console.warn("Ignored an invalid transient agent session snapshot");
  }
});
ipcMain.on("agent:proposalStatus", (event, rawId, rawStatus, rawRevision) => {
  assertTrustedSender(event);
  if (typeof rawId !== "string" || !["applied", "rejected", "stale"].includes(String(rawStatus))) return;
  agentSessions.updateProposalStatus(rawId, rawStatus as "applied" | "rejected" | "stale", typeof rawRevision === "number" ? rawRevision : undefined);
});
ipcMain.on("agent:proposalReceipt", (event, rawId, rawSessionId, rawRevision, rawActivePathId, rawAccepted) => {
  assertTrustedSender(event);
  if (typeof rawId !== "string" || typeof rawSessionId !== "string" || !Number.isSafeInteger(rawRevision) || rawRevision < 0 || typeof rawActivePathId !== "string") return;
  const receipt = proposalReceipts.get(rawId);
  if (!receipt) return;
  agentSessions.acknowledgeProposal(rawId, rawSessionId, rawRevision, rawActivePathId, rawAccepted !== false);
  proposalReceipts.delete(rawId);
  clearTimeout(receipt.timer);
  receipt.resolve();
});

if (!mcpStdioMode && ownsDesktopInstance) app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (ownsDesktopInstance) app.whenReady().then(async () => {
  if (mcpStdioMode) {
    app.dock?.hide();
    const server = serveBordeauxMcp(new AgentBridgeClient(app.getPath("userData")));
    quitAfterMcpInputEnds(process.stdin, () => server.close(), () => app.quit(), (error) => {
      console.warn("Could not close the Bordeaux MCP stdio server cleanly:", error);
    });
    return;
  }
  try {
    robotProjectBookmarks = await readRobotProjectBookmarks(robotProjectBookmarksFile());
  } catch (error) {
    robotProjectBookmarks = [];
    console.warn("Could not load Robot project bookmarks:", error);
  }
  try {
    recentFiles = await readRecentProjectFiles(recentProjectsFile());
  } catch (error) {
    recentFiles = [];
    console.warn("Could not load recent Bordeaux projects:", error);
  }
  try {
    robotPairings = new RobotPairingController(await readRobotPairing(robotPairingFile()));
  } catch (error) {
    robotPairings = new RobotPairingController();
    console.warn("Could not load the paired Bordeaux robot:", error);
  }
  agentBridge = new AgentBridgeServer(app.getPath("userData"), agentSessions);
  if (enableMcpAccessOnLaunch) await agentBridge.start();
  appUpdates = createAppUpdateController();
  appUpdates.start();
  buildMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => {
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  updateCheckTimer = null;
});
app.on("will-quit", (event) => {
  if (backgroundServicesReadyForExit) return;
  event.preventDefault();
  if (finalQuitInProgress) return;
  finalQuitInProgress = true;
  void stopBackgroundServices().catch((error) => {
    console.warn("Could not stop Bordeaux background services cleanly:", error);
  }).finally(() => {
    backgroundServicesReadyForExit = true;
    app.quit();
  });
});
app.on("web-contents-created", (_event, contents) => contents.on("will-attach-webview", (event) => event.preventDefault()));
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
