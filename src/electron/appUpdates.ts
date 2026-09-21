import { CancellationToken } from "builder-util-runtime";
import type { AppUpdateChannel, AppUpdateProgress, AppUpdateState } from "../shared/appUpdates";
export type { AppUpdateChannel } from "../shared/appUpdates";

export interface UpdateVersionInfo {
  version: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }>;
}
export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  on(event: "update-available" | "update-not-available" | "update-downloaded", listener: (info: UpdateVersionInfo) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "download-progress", listener: (progress: AppUpdateProgress) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(token?: CancellationToken): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}
export interface UpdateRuntime {
  packaged: boolean;
  supported: boolean;
  currentVersion: string;
  isProjectDirty(): boolean;
  warn(message: string, error?: unknown): void;
  describeError?(error: unknown): string;
}

export function updateReleaseNotes(info: UpdateVersionInfo): string {
  const notes = Array.isArray(info.releaseNotes) ? info.releaseNotes.map((entry) => entry.note || "").filter(Boolean).join("\n\n") : info.releaseNotes || "Release notes were not provided for this version.";
  return notes.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").slice(0, 16000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function supportsAppUpdates(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32" || platform === "linux";
}

export function usesGitHubAppUpdates(
  platform: NodeJS.Platform,
  windowsStore: boolean,
  windowsPortable = false,
  linuxAppImage = true,
): boolean {
  if (!supportsAppUpdates(platform)) return false;
  if (platform === "win32") return !windowsStore && !windowsPortable;
  if (platform === "linux") return linuxAppImage;
  return true;
}

export function appUpdateChannel(version: string): AppUpdateChannel {
  return /^\d+\.\d+\.\d+$/.test(version) ? "latest" : "beta";
}

export class AppUpdateController {
  private started = false;
  private checkPromise: Promise<void> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private downloadToken: CancellationToken | null = null;
  private downloaded = false;
  private installing = false;
  private offeredVersions = new Set<string>();
  private state: AppUpdateState;

  constructor(
    private readonly updater: AppUpdaterLike | null,
    private readonly runtime: UpdateRuntime,
    private readonly onState: (state: AppUpdateState) => void = () => undefined,
  ) {
    this.state = {
      phase: this.available ? "idle" : "unsupported", currentVersion: runtime.currentVersion,
      version: null, releaseNotes: "", progress: null, error: null, errorDetails: null,
      errorStage: null, projectDirty: runtime.isProjectDirty(), channel: this.channel, visible: false,
    };
  }

  get available(): boolean { return this.runtime.packaged && this.runtime.supported && this.updater !== null; }
  get channel(): AppUpdateChannel { return appUpdateChannel(this.runtime.currentVersion); }
  snapshot(): AppUpdateState {
    return { ...this.state, projectDirty: this.runtime.isProjectDirty(), progress: this.state.progress ? { ...this.state.progress } : null };
  }
  private publish(patch: Partial<AppUpdateState> = {}): void {
    this.state = { ...this.state, ...patch, projectDirty: this.runtime.isProjectDirty() };
    this.onState(this.snapshot());
  }
  setVisible(visible: boolean): void {
    if (!visible && this.installing) return;
    this.publish({ visible });
  }
  refreshDirty(): void { this.publish(); }
  refresh(): void { this.refreshDirty(); }
  private clearError(): Pick<AppUpdateState, "error" | "errorDetails" | "errorStage"> {
    return { error: null, errorDetails: null, errorStage: null };
  }
  private fail(error: unknown, stage: NonNullable<AppUpdateState["errorStage"]>): void {
    // electron-updater emits an error and rejects the same operation's promise.
    if (this.state.phase === "error" && this.state.errorStage === stage) return;
    this.runtime.warn("Bordeaux update failed", error);
    this.publish({ phase: "error", errorStage: stage,
      error: this.runtime.describeError?.(error) || "The update could not be completed. Try again or download the installer from Releases.",
      errorDetails: errorMessage(error), progress: null });
  }

  start(): void {
    if (this.started || !this.available || !this.updater) return;
    this.started = true;
    const updater = this.updater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = this.channel === "beta";
    updater.channel = this.channel;
    updater.allowDowngrade = false;
    updater.on("update-available", (info) => {
      if (this.downloadPromise || this.downloaded || this.installing) return;
      const firstOffer = !this.offeredVersions.has(info.version);
      this.offeredVersions.add(info.version);
      this.publish({ ...this.clearError(), phase: "available", version: info.version,
        releaseNotes: updateReleaseNotes(info), progress: null, visible: this.state.visible || firstOffer });
    });
    updater.on("update-not-available", (info) => {
      if (this.state.phase === "checking") this.publish({
        phase: "upToDate", ...this.clearError(), version: null,
        releaseNotes: info.version === this.runtime.currentVersion ? updateReleaseNotes(info) : "",
      });
    });
    updater.on("download-progress", (progress) => {
      if (this.state.phase !== "downloading" || !this.downloadToken || this.downloadToken.cancelled) return;
      const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
      this.publish({ progress: { percent: Math.min(100, finite(progress.percent)), transferred: finite(progress.transferred), total: finite(progress.total), bytesPerSecond: finite(progress.bytesPerSecond) } });
    });
    updater.on("update-downloaded", (info) => {
      if (!this.downloadToken || this.downloadToken.cancelled || this.state.phase !== "downloading" || info.version !== this.state.version) return;
      this.downloaded = true;
      this.publish({ phase: "downloaded", progress: null, ...this.clearError() });
    });
    updater.on("error", (error) => {
      if (this.downloadToken?.cancelled) return;
      if (this.installing) { this.installing = false; this.fail(error, "install"); }
      else if (this.downloadToken) this.fail(error, "download");
      else if (this.checkPromise || this.state.phase === "checking") this.fail(error, "check");
    });
  }

  async check(interactive = false): Promise<void> {
    if (interactive) this.setVisible(true);
    if (!this.available) { this.publish({ phase: "unsupported" }); return; }
    this.start();
    if (this.downloadPromise || this.installing) return;
    if (this.downloaded) { this.publish({ phase: "downloaded", ...this.clearError() }); return; }
    if (this.checkPromise) return this.checkPromise;
    this.publish({ phase: "checking", version: null, releaseNotes: "", progress: null, ...this.clearError() });
    // Defer invoking the updater until the ownership promise has been recorded.
    this.checkPromise = Promise.resolve().then(async () => {
      try {
        const result = await this.updater!.checkForUpdates();
        if (result === null && this.state.phase === "checking") this.publish({ phase: "unsupported" });
      } catch (error) { this.fail(error, "check"); }
      finally { this.checkPromise = null; }
    });
    return this.checkPromise;
  }

  async download(): Promise<void> {
    if (!this.available || !this.state.version || this.downloaded || this.installing || this.checkPromise) return;
    if (this.downloadPromise) return this.downloadPromise;
    if (this.state.phase !== "available" && !(this.state.phase === "error" && this.state.errorStage === "download")) return;
    const token = new CancellationToken();
    this.downloadToken = token;
    this.publish({ phase: "downloading", progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, ...this.clearError() });
    this.downloadPromise = Promise.resolve().then(async () => {
      try { await this.updater!.downloadUpdate(token); }
      catch (error) { if (!token.cancelled) this.fail(error, "download"); }
      finally {
        this.downloadPromise = null;
        this.downloadToken = null;
        if (token.cancelled) this.publish({ phase: "available", progress: null, ...this.clearError() });
      }
    });
    return this.downloadPromise;
  }

  async cancelDownload(): Promise<void> {
    if (!this.downloadToken || this.downloaded) return;
    this.downloadToken.cancel();
    // Keep ownership until the canceled transfer settles: late events must not
    // turn it into a ready update or attach themselves to a retry.
    await this.downloadPromise;
  }

  async install(): Promise<void> {
    if (!this.downloaded || this.installing || !this.updater) return;
    this.installing = true;
    this.publish({ phase: "installing", visible: true, ...this.clearError() });
    try {
      this.updater.quitAndInstall(false, true);
    } catch (error) { this.installing = false; this.fail(error, "install"); }
  }
}
