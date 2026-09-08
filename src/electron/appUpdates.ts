export interface UpdateVersionInfo {
  version: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }>;
}

export type AppUpdateChannel = "beta" | "latest";

export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  on(event: "update-available" | "update-not-available" | "update-downloaded", listener: (info: UpdateVersionInfo) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdatePresenter {
  available(version: string, releaseNotes: string): "later" | "download" | Promise<"later" | "download">;
  unavailable(currentVersion: string): void | Promise<void>;
  downloading(version: string): void | Promise<void>;
  upToDate(currentVersion: string): void | Promise<void>;
  failed(message: string): void | Promise<void>;
  ready(version: string, projectDirty: boolean): "later" | "restart" | Promise<"later" | "restart">;
}

export interface UpdateRuntime {
  packaged: boolean;
  supported: boolean;
  currentVersion: string;
  isProjectDirty(): boolean;
  prepareToInstall(): void | Promise<void>;
  warn(message: string, error?: unknown): void;
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
  private interactiveCheck = false;
  private installing = false;
  private downloading = false;
  private downloadedVersion: string | null = null;
  private readonly offeredVersions = new Set<string>();
  private checkPromise: Promise<void> | null = null;
  private readonly promptedVersions = new Set<string>();

  constructor(
    private readonly updater: AppUpdaterLike | null,
    private readonly presenter: UpdatePresenter,
    private readonly runtime: UpdateRuntime,
  ) {}

  get available(): boolean {
    return this.runtime.packaged && this.runtime.supported && this.updater !== null;
  }

  get channel(): AppUpdateChannel {
    return appUpdateChannel(this.runtime.currentVersion);
  }

  start(): void {
    if (this.started || !this.available) return;
    const updater = this.updater;
    if (!updater) return;
    this.started = true;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = this.channel === "beta";
    updater.channel = this.channel;
    updater.allowDowngrade = false;

    updater.on("update-available", (info) => {
      const interactive = this.interactiveCheck;
      this.interactiveCheck = false;
      if (this.downloading || (!interactive && this.offeredVersions.has(info.version))) return;
      this.offeredVersions.add(info.version);
      void this.offerDownload(info);
    });
    updater.on("update-not-available", () => {
      if (!this.interactiveCheck) return;
      this.interactiveCheck = false;
      void this.presenter.upToDate(this.runtime.currentVersion);
    });
    updater.on("error", (error) => {
      this.runtime.warn("Bordeaux updater failed", error);
      if (this.interactiveCheck) {
        this.interactiveCheck = false;
        void this.presenter.failed(errorMessage(error));
      } else if (this.downloading || this.installing) {
        this.downloading = false;
        this.installing = false;
        void this.presenter.failed(errorMessage(error));
      }
    });
    updater.on("update-downloaded", (info) => {
      this.downloading = false;
      this.downloadedVersion = info.version;
      if (this.promptedVersions.has(info.version)) return;
      this.promptedVersions.add(info.version);
      this.interactiveCheck = false;
      void this.offerRestart(info.version).finally(() => this.promptedVersions.delete(info.version));
    });
  }

  async check(interactive = false): Promise<void> {
    if (!this.available) {
      if (interactive) await this.presenter.unavailable(this.runtime.currentVersion);
      return;
    }
    this.start();
    if (interactive && this.downloadedVersion) {
      await this.offerRestart(this.downloadedVersion);
      return;
    }
    const updater = this.updater;
    if (!updater) return;
    this.interactiveCheck ||= interactive;
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = (async () => {
      try {
        const result = await updater.checkForUpdates();
        if (result === null && this.interactiveCheck) {
          this.interactiveCheck = false;
          await this.presenter.unavailable(this.runtime.currentVersion);
        }
      } catch (error) {
        this.runtime.warn("Bordeaux update check failed", error);
        if (this.interactiveCheck) {
          this.interactiveCheck = false;
          await this.presenter.failed(errorMessage(error));
        }
      } finally {
        this.checkPromise = null;
      }
    })();
    return this.checkPromise;
  }

  private async offerDownload(info: UpdateVersionInfo): Promise<void> {
    try {
      if (await this.presenter.available(info.version, updateReleaseNotes(info)) !== "download") return;
      this.downloading = true;
      await this.updater?.downloadUpdate();
    } catch (error) {
      this.downloading = false;
      this.runtime.warn("Bordeaux download failed", error);
      await this.presenter.failed(errorMessage(error));
    }
  }

  private async offerRestart(version: string): Promise<void> {
    const projectDirty = this.runtime.isProjectDirty();
    const choice = await this.presenter.ready(version, projectDirty);
    if (choice !== "restart" || this.runtime.isProjectDirty()) return;
    try {
      await this.runtime.prepareToInstall();
    } catch (error) {
      this.runtime.warn("Bordeaux could not prepare to install the update", error);
      await this.presenter.failed(errorMessage(error));
      return;
    }
    if (this.runtime.isProjectDirty()) return;
    this.installing = true;
    try {
      this.updater?.quitAndInstall(false, true);
    } catch (error) {
      this.installing = false;
      this.runtime.warn("Bordeaux could not start the update installer", error);
      await this.presenter.failed(errorMessage(error));
    }
  }
}
