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
      const result: any = await window.webContents.executeJavaScript(`(async () => {
        for (let attempt = 0; attempt < 50 && document.documentElement.dataset.chapLoader === 'loading'; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const chapLoader = document.documentElement.dataset.chapLoader;
        const unnamedOnPage = () => {
          const controls = [...document.querySelectorAll('button,input,select,textarea,[role="button"]')];
          const name = (el) => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.labels?.[0]?.textContent || (el.matches('button,[role="button"]') ? el.textContent : '');
          return controls.filter((el) => !String(name(el) || '').trim()).map((el) => el.className);
        };
        const unnamed = [...unnamedOnPage()];
        for (const page of ['Auto', 'Robot']) {
          [...document.querySelectorAll('.pageswitch button')].find((button) => button.textContent.trim() === page)?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          unnamed.push(...unnamedOnPage());
        }
        const project = { schemaVersion: '1.0', name: 'Smoke edited', robot: { drive: 'swerve', w: .8, l: .8, maxSpeed: 4 }, paths: [{ id: 'path_smoke', name: 'Smoke', waypoints: [{ x: 1, y: 1, theta: 0, thetaOn: true, linked: true, stop: false, prevC: { x: .8, y: 1 }, nextC: { x: 1.2, y: 1 } }, { x: 2, y: 1, theta: 0, thetaOn: true, linked: true, stop: false, prevC: { x: 1.8, y: 1 }, nextC: { x: 2.2, y: 1 } }], targets: [], markers: [{ id: 'event_smoke', f: .5, name: 'Smoke event', invocation: { commandId: 'frc.robot.SmokeCommand', arguments: { count: 2, sequence: '9007199254740993', tags: ['auto'] }, cancelOnPathEnd: true } }], ranges: [], constraints: { maxVel: 2, maxAccel: 2, maxDecel: 2, maxAngVel: 180, maxAngAccel: 360 }, startVel: 0, goalVel: 0 }], routine: { name: 'Smoke routine', nodes: [{ id: 'routine_smoke', type: 'path', ref: 'path_smoke' }] } };
        const validation = await window.bordeauxAPI.validateProject(project);
        const javaConnection = await window.bordeauxAPI.linkJavaProject();
        const installedJavaConnection = await window.bordeauxAPI.installJavaSupport();
        const builtJavaConnection = await window.bordeauxAPI.buildJavaCatalog();
        const recentJavaProjects = await window.bordeauxAPI.listRecentJavaProjects();
        const reopenedJavaConnection = await window.bordeauxAPI.openRecentJavaProject(recentJavaProjects[0].id);
        [...document.querySelectorAll('.pageswitch button')].find((button) => button.textContent.trim() === 'Plan')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        document.querySelector('button[aria-label="Add event marker"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const linkButton = document.querySelector('button[aria-label="Choose Java project"]')
          || [...document.querySelectorAll('.cmd-primary-action')].find((button) => button.textContent.trim() === 'Choose Java project');
        linkButton?.click();
        for (let attempt = 0; attempt < 50 && document.getElementById('event-marker-command')?.disabled; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const commandPicker = document.getElementById('event-marker-command');
        const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        commandPicker?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const commandOptions = [...document.querySelectorAll('#event-marker-command-listbox [role="option"]')];
        const commandSearch = document.getElementById('event-marker-command-search');
        const smokeCommandOption = commandOptions.find((option) => option.getAttribute('data-value') === 'frc.robot.SmokeCommand');
        if (smokeCommandOption) {
          smokeCommandOption.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const jsonParameter = document.getElementById('event-command-param-tags');
        const exactIntegerParameter = document.getElementById('event-command-param-sequence');
        const smokeParametersPresent = Boolean(document.getElementById('event-command-param-count') && jsonParameter && exactIntegerParameter);
        const setTextAreaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        if (jsonParameter) {
          setTextAreaValue.call(jsonParameter, '{}');
          jsonParameter.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          jsonParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const jsonShapeRejected = jsonParameter?.getAttribute('aria-invalid') === 'true';
        if (jsonParameter) {
          setTextAreaValue.call(jsonParameter, '["auto"]');
          jsonParameter.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          jsonParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (exactIntegerParameter) {
          setInputValue.call(exactIntegerParameter, '9223372036854775808');
          exactIntegerParameter.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          exactIntegerParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const longRangeRejected = exactIntegerParameter?.getAttribute('aria-invalid') === 'true';
        if (exactIntegerParameter) {
          setInputValue.call(exactIntegerParameter, '9007199254740993');
          exactIntegerParameter.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          exactIntegerParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        document.getElementById('event-marker-command')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const largeEnumCommandOption = [...document.querySelectorAll('#event-marker-command-listbox [role="option"]')]
          .find((option) => option.getAttribute('data-value') === 'frc.robot.LargeEnumCommand');
        largeEnumCommandOption?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const largeEnumPicker = document.getElementById('event-command-param-mode');
        largeEnumPicker?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const largeEnumOptions = [...document.querySelectorAll('#event-command-param-mode-listbox [role="option"]')];
        const largeEnumOverflowNotice = document.querySelector('#event-command-param-mode-listbox .cmd-picker-more')?.textContent || '';
        const largeEnumSearch = document.getElementById('event-command-param-mode-search');
        if (largeEnumSearch) {
          setInputValue.call(largeEnumSearch, 'MODE_150');
          largeEnumSearch.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const largeEnumChoice = [...document.querySelectorAll('#event-command-param-mode-listbox [role="option"]')]
          .find((option) => option.getAttribute('data-value') === 'MODE_150');
        largeEnumChoice?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const javaUi = {
          markerInspector: Boolean(document.querySelector('.cmd-project')),
          linkAction: Boolean(linkButton),
          commandEnabled: Boolean(commandPicker && !commandPicker.disabled),
          commandOptions: commandOptions.length,
          searchHiddenForSmallCatalog: !commandSearch,
          recentHiddenForSingleProject: !document.getElementById('event-marker-java-project'),
          cancelSwitch: Boolean(document.getElementById('event-command-cancel') && document.querySelector('.cmd-toggle-track')),
          parameter: smokeParametersPresent,
          jsonShapeRejected,
          jsonShapeAccepted: jsonParameter?.getAttribute('aria-invalid') === 'false',
          longRangeRejected,
          exactInteger: exactIntegerParameter?.value === '9007199254740993' && exactIntegerParameter?.type === 'text',
          largeEnumPicker: largeEnumOptions.length === 80
            && largeEnumOverflowNotice.includes('80 of 160 shown')
            && Boolean(largeEnumSearch)
            && document.getElementById('event-command-param-mode-value')?.textContent === 'MODE_150',
          accessible: unnamedOnPage().length === 0,
        };
        await window.bordeauxAPI.newProject();
        const javaExported = await window.bordeauxAPI.exportJava(project, 'linked');
        const saved = await window.bordeauxAPI.saveProject(project, true);
        await window.bordeauxAPI.newProject();
        const opened = await window.bordeauxAPI.openProject();
        const exported = await window.bordeauxAPI.exportBdx(opened.project);
        window.bordeauxAPI.setDirty(true);
        const probe = document.createElement('script'); probe.textContent = 'window.__bordeauxInlineScriptRan = true'; document.head.appendChild(probe);
        return { title: document.title, api: typeof window.bordeauxAPI?.saveProject === "function", root: Boolean(document.getElementById("root")?.children.length), unnamed, main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, chapLoader, validation: validation.ok, javaDiscovery: javaConnection.catalog.projectName === 'SmokeRobot' && javaConnection.catalog.commands.some((command) => command.id === 'frc.robot.SmokeCommand'), javaInstalled: installedJavaConnection.integration.installed, javaBuilt: builtJavaConnection.catalog.authoritative === true && builtJavaConnection.catalog.catalogHash === reopenedJavaConnection.catalog.catalogHash, javaRecent: recentJavaProjects.length === 1 && reopenedJavaConnection.catalog.projectName === 'SmokeRobot', javaUi, javaExported: javaExported.exported && javaExported.eventCount === 1, roundTrip: saved.saved && opened.project.name === project.name && opened.project.routine.nodes[0].ref === 'path_smoke', exported: exported.exported, nodeGlobalsBlocked: typeof require === 'undefined', popupBlocked: window.open('https://example.com') === null, inlineScriptBlocked: !window.__bordeauxInlineScriptRan };
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      window.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const filesWritten = smokeDirectory ? fs.existsSync(path.join(smokeDirectory, "project.bordeaux.json")) && fs.existsSync(path.join(smokeDirectory, "export.bdx")) && fs.existsSync(path.join(smokeDirectory, "java-project", "src", "main", "deploy", "bordeaux", "Smoke-edited.bordeaux.json")) : false;
      result.filesWritten = filesWritten;
      result.closeGuard = smokeCloseGuardTriggered && !window.isDestroyed();
      console.log(`BORDEAUX_SMOKE_OK ${JSON.stringify(result)}`);
      const passed = result.api && result.root && result.unnamed.length === 0 && result.main > 0 && result.nav > 0 && result.chapLoader === "rigged" && result.validation && result.javaDiscovery && result.javaInstalled && result.javaBuilt && result.javaRecent && result.javaUi.markerInspector && result.javaUi.linkAction && result.javaUi.commandEnabled && result.javaUi.commandOptions === 4 && result.javaUi.searchHiddenForSmallCatalog && result.javaUi.recentHiddenForSingleProject && result.javaUi.cancelSwitch && result.javaUi.parameter && result.javaUi.jsonShapeRejected && result.javaUi.jsonShapeAccepted && result.javaUi.longRangeRejected && result.javaUi.exactInteger && result.javaUi.largeEnumPicker && result.javaUi.accessible && result.javaExported && result.roundTrip && result.exported && result.nodeGlobalsBlocked && result.popupBlocked && result.inlineScriptBlocked && result.filesWritten && result.closeGuard;
      allowClose = true;
      app.exit(passed ? 0 : 1);
    });
  }
}

function sendCommand(command: string, payload?: unknown) {
  mainWindow?.webContents.send("menu-command", { command, payload });
}

function sendMcpStatus(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("agent:mcpStatus", { enabled: agentBridge?.enabled === true });
}

function buildMenu() {
  const recentSubmenu = recentFiles.length > 0
    ? recentFiles.map((filePath, index) => ({ label: path.basename(filePath), sublabel: filePath, click: () => sendCommand("open-recent", index) }))
    : [{ label: "No Recent Projects", enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] } as Electron.MenuItemConstructorOptions] : []),
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
        { label: "Export Java Trajectory…", accelerator: "CmdOrCtrl+Shift+E", click: () => sendCommand("export-java") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Java",
      submenu: [
        { label: "Link Robot Project…", click: () => sendCommand("java-link") },
        { label: "Install or Update Support…", click: () => sendCommand("java-install") },
        { label: "Build Command Catalog…", click: () => sendCommand("java-build") },
        { label: "Cancel Catalog Build", click: () => sendCommand("java-cancel-build") },
        { type: "separator" },
        { label: "Export to Robot Project…", click: () => sendCommand("export-java") },
        { label: "Save Java JSON As…", click: () => sendCommand("export-java-save-as") },
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
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openProjectFile(filePath: string) {
  const decoded = await readProject(filePath);
  const { project } = decoded;
  rememberFile(filePath, saveTargetForOpenedProject(filePath, decoded));
  dirty = false;
  return { project };
}

handle("project:open", async () => {
  if (smokeDirectory) return openProjectFile(path.join(smokeDirectory, "project.bordeaux.json"));
  const result = await dialog.showOpenDialog(mainWindow!, { title: "Open Bordeaux Project or Path", properties: ["openFile"], filters: [{ name: "Bordeaux Project or LabVIEW Path", extensions: ["json", "path", "bdx"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return openProjectFile(result.filePaths[0]);
});

handle("project:openRecent", async (_event, rawIndex) => {
  if (!Number.isInteger(rawIndex) || typeof rawIndex !== "number" || rawIndex < 0 || rawIndex >= recentFiles.length) throw new Error("Recent project is no longer available");
  return openProjectFile(recentFiles[rawIndex]);
});

handle("project:new", () => {
  currentProjectPath = null;
  dirty = false;
});

handle("project:save", async (_event, project, rawSaveAs) => {
  const validation = validateProject(project);
  if (!validation.ok) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  let target = rawSaveAs === true ? null : currentProjectPath;
  if (!target) {
    if (smokeDirectory) target = path.join(smokeDirectory, "project.bordeaux.json");
    else {
    const projectName = project && typeof project === "object" && "name" in project && typeof project.name === "string" ? project.name : "project";
    const result = await dialog.showSaveDialog(mainWindow!, { title: "Save Bordeaux Project", defaultPath: `${projectName || "project"}.bordeaux.json`, filters: [{ name: "Bordeaux Project", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
    }
  }
  await writeProject(target, project);
  rememberFile(target);
  dirty = false;
  return { saved: true };
});

handle("project:exportBdx", async (_event, project, rawPathId) => {
  const exportData = buildLabviewBdx(project as BordeauxProject, typeof rawPathId === "string" ? rawPathId : undefined);
  if (smokeDirectory) {
    const target = path.join(smokeDirectory, "export.bdx");
    await writeBufferAtomically(target, exportData.buffer);
    return { exported: true };
  }
  const result = await dialog.showSaveDialog(mainWindow!, { title: "Export Bordeaux Path", defaultPath: `${exportData.pathName || "trajectory"}.bdx`, filters: [{ name: "Bordeaux Trajectory Export", extensions: ["bdx"] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeBufferAtomically(result.filePath, exportData.buffer);
  return { exported: true };
});

handle("project:exportJava", async (_event, rawProject, rawDestination) => {
  if (!linkedJavaProjectPath || !linkedJavaCatalog || !linkedJavaIntegration) throw new Error("Link a Java robot project before exporting robot JSON");
  if (!linkedJavaIntegration.installed) throw new Error("Install Bordeaux Java support in the linked robot project before exporting");
  if (linkedJavaIntegration.supportVersion !== linkedJavaCatalog.supportVersion) throw new Error("Installed Java support and the generated catalog do not match; reinstall support and rebuild the catalog");
  const destination = rawDestination === "saveAs" ? "saveAs" : "linked";
  const built = buildJavaTrajectory(rawProject as BordeauxProject, linkedJavaCatalog);
  let target: string;
  let relativePath: string;
  if (destination === "saveAs") {
    if (smokeDirectory) {
      target = path.join(smokeDirectory, "java-export.bordeaux.json");
    } else {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: "Save Bordeaux Java Trajectory",
        defaultPath: javaTrajectoryFileName((rawProject as BordeauxProject).name),
        filters: [{ name: "Bordeaux Java Trajectory", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath;
    }
    relativePath = path.basename(target);
  } else {
    target = await assertSafeJavaExportTarget(linkedJavaProjectPath, javaTrajectoryFileName((rawProject as BordeauxProject).name));
    relativePath = path.relative(linkedJavaProjectPath, target);
    const targetSnapshot = await javaExportTargetSnapshot(target);
    if (!smokeDirectory) {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "question",
        title: "Export Java trajectory",
        message: `Export ${built.pathCount} path${built.pathCount === 1 ? "" : "s"} and ${built.eventCount} event${built.eventCount === 1 ? "" : "s"}?`,
        detail: `${relativePath}\n${Buffer.byteLength(built.contents, "utf8").toLocaleString()} bytes · SHA-256 ${built.sha256.slice(0, 12)}…\n\nGradleRIO deploys files under src/main/deploy with robot code. Bordeaux will not deploy the robot.`,
        buttons: ["Cancel", "Export"],
        defaultId: 1,
        cancelId: 0,
      });
      if (result.response !== 1) return { canceled: true };
      target = await assertSafeJavaExportTarget(linkedJavaProjectPath, path.basename(target));
      if (await javaExportTargetSnapshot(target) !== targetSnapshot) throw new Error("Java export target changed while the preview was open; review and export again");
    }
  }
  await writeBufferAtomically(target, Buffer.from(built.contents, "utf8"));
  return { exported: true, relativePath, pathCount: built.pathCount, eventCount: built.eventCount, sha256: built.sha256 };
});

handle("project:validate", (_event, project) => validateProject(project));
handle("javaProject:listRecent", () => summarizeJavaProjectBookmarks(javaProjectBookmarks));
handle("javaProject:link", async () => {
  let selectedPath: string | undefined;
  if (smokeDirectory) {
    selectedPath = path.join(smokeDirectory, "java-project");
  } else {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Link Java Robot Project",
      buttonLabel: "Link Project",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    selectedPath = result.filePaths[0];
  }
  try {
    return await connectJavaProject(selectedPath);
  } catch (error) {
    throw readableJavaProjectError(error, "Selected Java project");
  }
});
handle("javaProject:openRecent", async (_event, rawId) => {
  if (typeof rawId !== "string" || rawId.length > 64) throw new Error("Recent Java project selection is invalid");
  const bookmark = javaProjectBookmarks.find((item) => item.id === rawId);
  if (!bookmark) throw new Error("Recent Java project is no longer available");
  try {
    return await connectJavaProject(bookmark.projectPath);
  } catch (error) {
    throw readableJavaProjectError(error, bookmark.projectName);
  }
});
handle("javaProject:refresh", async () => {
  if (!linkedJavaProjectPath) throw new Error("Link a Java robot project before refreshing commands");
  try {
    return await connectJavaProject(linkedJavaProjectPath);
  } catch (error) {
    const bookmark = javaProjectBookmarks.find((item) => item.id === linkedJavaProjectBookmarkId);
    throw readableJavaProjectError(error, bookmark?.projectName);
  }
});
handle("javaProject:installSupport", async () => {
  if (!linkedJavaProjectPath) throw new Error("Link a Java robot project before installing Java support");
  try {
    const preview = await prepareJavaSupportInstall(linkedJavaProjectPath, javaSupportArtifactsDirectory());
    const summary = installPreviewSummary(preview);
    if (!smokeDirectory) {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "warning",
        title: summary.replacing ? "Update Bordeaux Java support" : "Install Bordeaux Java support",
        message: summary.replacing ? "Replace the managed Bordeaux support files?" : "Add Bordeaux support to this GradleRIO project?",
        detail: `Bordeaux will ${summary.replacing ? "replace its managed block in" : "add one managed block to"} ${summary.buildFile}, preserve a one-time backup, and write:\n\n${summary.files.join("\n")}\n\nIt will not modify RobotContainer or deploy robot code.`,
        buttons: ["Cancel", summary.replacing ? "Update Support" : "Install Support"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return null;
    }
    await applyJavaSupportInstall(preview);
    return connectJavaProject(linkedJavaProjectPath);
  } catch (error) {
    throw readableJavaProjectError(error, "Linked Java project");
  }
});
handle("javaProject:buildCatalog", async () => {
  if (!linkedJavaProjectPath) throw new Error("Link a Java robot project before building its command catalog");
  if (!linkedJavaIntegration?.installed) throw new Error("Install Bordeaux Java support before building the command catalog");
  if (!smokeDirectory) {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      title: "Trust and build Java catalog",
      message: "Run the linked project’s Gradle wrapper?",
      detail: "This executes the fixed bordeauxCatalog task. Gradle build scripts are code and may access your computer or network. Only continue if you trust this robot project.",
      buttons: ["Cancel", "Run Build"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return null;
  }
  try {
    await runJavaCatalogBuild(linkedJavaProjectPath);
    return connectJavaProject(linkedJavaProjectPath);
  } catch (error) {
    console.error("Java catalog build failed");
    throw readableJavaProjectError(error, "Linked Java project");
  }
});
handle("javaProject:cancelBuild", () => ({ canceled: cancelJavaCatalogBuild() }));
handle("agent:getActiveProposal", () => agentSessions.getActiveProposal());
handle("agent:getMcpStatus", () => ({ enabled: agentBridge?.enabled === true }));
ipcMain.on("project:setDirty", (event, value) => { assertTrustedSender(event); dirty = value === true; });
ipcMain.on("agent:publishSession", (event, value) => {
  assertTrustedSender(event);
  agentSessions.publishSnapshot(value as AgentSessionSnapshot);
});
ipcMain.on("agent:proposalStatus", (event, rawId, rawStatus, rawRevision) => {
  assertTrustedSender(event);
  if (typeof rawId !== "string" || !["applied", "rejected", "stale"].includes(String(rawStatus))) return;
  agentSessions.updateProposalStatus(rawId, rawStatus as "applied" | "rejected" | "stale", typeof rawRevision === "number" ? rawRevision : undefined);
});
ipcMain.on("agent:proposalReceipt", (event, rawId) => {
  assertTrustedSender(event);
  if (typeof rawId !== "string") return;
  const receipt = proposalReceipts.get(rawId);
  if (!receipt) return;
  proposalReceipts.delete(rawId);
  clearTimeout(receipt.timer);
  receipt.resolve();
});

app.whenReady().then(async () => {
  if (mcpStdioMode) {
    app.dock?.hide();
    serveBordeauxMcp(new AgentBridgeClient(app.getPath("userData")));
    return;
  }
  try {
    javaProjectBookmarks = await readJavaProjectBookmarks(javaProjectBookmarksFile());
  } catch (error) {
    javaProjectBookmarks = [];
    console.warn("Could not load Java project bookmarks:", error);
  }
  agentBridge = new AgentBridgeServer(app.getPath("userData"), agentSessions);
  if (enableMcpAccessOnLaunch) await agentBridge.start();
  buildMenu();
  createWindow();
