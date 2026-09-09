import { createHash } from "node:crypto";
import path from "node:path";
import { Client, type Callback, type SFTPWrapper, type Stats } from "ssh2";
import {
  ROBOT_DEPLOYMENT_NAMESPACE,
  RobotTransportError,
  type RobotConnectRequest,
  type RobotRemoteFile,
  type RobotSftpSession,
} from "./robotSftpTransport";

const UNAVAILABLE_MESSAGE = "SFTP to the robot is unavailable. Port 22 is not available on the FMS field network; Bordeaux did not detect which network is connected.";

function fingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

export function validateRobotFileDirectory(directory: unknown): string {
  if (typeof directory === "string") directory = directory.replace(/\/+$/, "");
  if (typeof directory !== "string" || directory.length > 512
    || !/^\/(?:home\/lvuser|natinst\/bin\/Paths)(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/.test(directory)
    || directory.split("/").some((part) => part === "." || part === "..")) {
    throw new RobotTransportError("invalid_request", "Robot directory must be inside /natinst/bin/Paths or /home/lvuser without traversal or symbolic links");
  }
  return directory;
}

export function validateRobotFileName(fileName: unknown): string {
  if (typeof fileName !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}\.bdx$/.test(fileName)) {
    throw new RobotTransportError("invalid_request", "Robot path filename must be a safe .bdx basename");
  }
  return fileName;
}

function remotePath(file: RobotRemoteFile): string {
  const nonce = "nonce" in file ? file.nonce : undefined;
  if (nonce !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(nonce)) {
    throw new RobotTransportError("invalid_request", "Remote Bordeaux file token is invalid");
  }
  switch (file.kind) {
    case "pathFile":
    case "pathTemporary": {
      const directory = validateRobotFileDirectory(file.directory);
      const name = validateRobotFileName(file.fileName);
      if (file.kind === "pathFile") return `${directory}/${name}`;
      if (!/^[a-f0-9]{32}$/.test(file.token)) throw new RobotTransportError("invalid_request", "Remote path temporary token is invalid");
      return `${directory}/.bordeaux-${name}-${file.token}.tmp`;
    }
    case "status":
      return path.posix.join(ROBOT_DEPLOYMENT_NAMESPACE, "status.json");
    case "incomingTemporary":
      if (!/^[a-f0-9]{8,64}$/.test(file.token)) throw new RobotTransportError("invalid_request", "Remote Bordeaux temporary token is invalid");
      return path.posix.join(ROBOT_DEPLOYMENT_NAMESPACE, "inbox", `.bordeaux-${file.nonce}-${file.token}.tmp`);
    case "incomingRevision":
      return path.posix.join(ROBOT_DEPLOYMENT_NAMESPACE, "inbox", `${file.nonce}.bordeaux-revision.json`);
    case "incomingRetentionTemporary":
      if (!/^[a-f0-9]{8,64}$/.test(file.token)) throw new RobotTransportError("invalid_request", "Remote Bordeaux temporary token is invalid");
      return path.posix.join(ROBOT_DEPLOYMENT_NAMESPACE, "inbox", `.bordeaux-${file.nonce}-${file.token}.retention.tmp`);
    case "incomingRetention":
      return path.posix.join(ROBOT_DEPLOYMENT_NAMESPACE, "inbox", `${file.nonce}.bordeaux-retention.json`);
    case "acknowledgement":
      return path.posix.join(ROBOT_DEPLOYMENT_NAMESPACE, "acks", `${file.nonce}.json`);
  }
}

function operationError(signal: AbortSignal, timedOut: () => boolean, cause?: unknown): RobotTransportError {
  if (cause && typeof cause === "object" && "code" in cause && (cause.code === 3 || cause.code === "EACCES")) {
    return new RobotTransportError("transfer_failed", "SFTP permission denied. The robot's lvuser account needs access to the selected destination directory", { cause });
  }
  if (timedOut()) return new RobotTransportError("timed_out", "SFTP to the robot timed out", { cause });
  if (signal.aborted) return new RobotTransportError("cancelled", "SFTP to the robot was cancelled", { cause });
  return new RobotTransportError("unavailable", UNAVAILABLE_MESSAGE, { cause });
}

function guarded<T>(
  signal: AbortSignal,
  timedOut: () => boolean,
  start: (resolve: (value: T) => void, reject: (reason: unknown) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(operationError(signal, timedOut));
      return;
    }
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(operationError(signal, timedOut)));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      start(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function callbackOperation(
  signal: AbortSignal,
  timedOut: () => boolean,
  start: (callback: Callback) => void,
): Promise<void> {
  return guarded(signal, timedOut, (resolve, reject) => {
    start((error) => error ? reject(operationError(signal, timedOut, error)) : resolve());
  });
}

class Ssh2RobotSession implements RobotSftpSession {
  constructor(
    private readonly client: Client,
    private readonly sftp: SFTPWrapper,
    readonly hostKeyFingerprint: string,
    private readonly sessionSignal: AbortSignal,
    private readonly timedOut: () => boolean,
    private readonly cleanup: () => void,
  ) {}

  async ensureDirectory(directory: string, create: boolean, signal: AbortSignal): Promise<void> {
    validateRobotFileDirectory(directory);
    const parts = directory.split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      const target = `/${parts.slice(0, index).join("/")}`;
      const combined = AbortSignal.any([signal, this.sessionSignal]);
      const stat = await guarded<Stats | null>(combined, this.timedOut, (resolve, reject) => {
        this.sftp.lstat(target, (error, value) => {
          if (!error) resolve(value);
          else if ((error as Error & { code?: number }).code === 2) resolve(null);
          else reject(operationError(combined, this.timedOut, error));
        });
      });
      if (!stat) {
        // Probe tolerates an absent destination, but never creates anything.
        if (!create) return;
        if (index <= 2) throw new RobotTransportError("transfer_failed", "Robot destination parent directory is unavailable");
        await callbackOperation(combined, this.timedOut, (callback) => this.sftp.mkdir(target, { mode: 0o755 }, callback));
      } else if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new RobotTransportError("transfer_failed", "Robot destination contains a non-directory or symbolic link");
      }
    }
  }

  async read(file: RobotRemoteFile, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 24 * 1024 * 1024) {
      throw new RobotTransportError("invalid_request", "Remote Bordeaux read limit is invalid");
    }
    const target = remotePath(file);
    const stat = await guarded<Stats>(AbortSignal.any([signal, this.sessionSignal]), this.timedOut, (resolve, reject) => {
      this.sftp.lstat(target, (error, value) => error ? reject(operationError(this.sessionSignal, this.timedOut, error)) : resolve(value));
    });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 0 || stat.size > maxBytes) {
      throw new RobotTransportError("transfer_failed", "Remote Bordeaux file is not a bounded regular file");
    }
    return guarded<Buffer>(AbortSignal.any([signal, this.sessionSignal]), this.timedOut, (resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const stream = this.sftp.createReadStream(target);
      const abort = () => stream.destroy(operationError(signal, this.timedOut));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) stream.destroy(new RobotTransportError("transfer_failed", "Remote Bordeaux file exceeded its read limit"));
        else chunks.push(Buffer.from(chunk));
      });
      stream.once("error", (error: Error) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof RobotTransportError ? error : operationError(this.sessionSignal, this.timedOut, error));
      });
      stream.once("end", () => {
        signal.removeEventListener("abort", abort);
        resolve(Buffer.concat(chunks, total));
      });
    });
  }

  write(file: RobotRemoteFile, contents: Buffer, signal: AbortSignal): Promise<void> {
    if (file.kind !== "incomingTemporary" && file.kind !== "incomingRetentionTemporary" && file.kind !== "pathTemporary") {
      throw new RobotTransportError("invalid_request", "Bordeaux can write only a temporary inbox file");
    }
    if (signal.aborted && !this.sessionSignal.aborted) throw new RobotTransportError("cancelled", "SFTP to the robot was cancelled");
    return callbackOperation(AbortSignal.any([signal, this.sessionSignal]), this.timedOut, (callback) => {
      this.sftp.writeFile(remotePath(file), contents, { flag: "wx", mode: 0o600 }, callback);
    });
  }

  async exists(file: RobotRemoteFile, signal: AbortSignal): Promise<boolean> {
    const target = remotePath(file);
    if (signal.aborted && !this.sessionSignal.aborted) throw new RobotTransportError("cancelled", "SFTP to the robot was cancelled");
    return guarded<boolean>(AbortSignal.any([signal, this.sessionSignal]), this.timedOut, (resolve, reject) => {
      this.sftp.lstat(target, (error, stat) => {
        if (!error) {
          if (stat.isSymbolicLink() || !stat.isFile()) reject(new RobotTransportError("transfer_failed", "Remote Bordeaux path is not a regular file"));
          else resolve(true);
          return;
        }
        const code = (error as Error & { code?: number | string }).code;
        if (code === 2 || code === "ENOENT" || code === "NO_SUCH_FILE") resolve(false);
        else reject(operationError(this.sessionSignal, this.timedOut, error));
      });
    });
  }

  renameSameDirectory(from: RobotRemoteFile, to: RobotRemoteFile, signal: AbortSignal): Promise<void> {
    const validRevisionRename = from.kind === "incomingTemporary" && to.kind === "incomingRevision";
    const validRetentionRename = from.kind === "incomingRetentionTemporary" && to.kind === "incomingRetention";
    const validPathRename = from.kind === "pathTemporary" && to.kind === "pathFile"
      && from.directory === to.directory && from.fileName === to.fileName;
    if (!validPathRename && ((!validRevisionRename && !validRetentionRename)
      || !("nonce" in from) || !("nonce" in to) || from.nonce !== to.nonce)) {
      throw new RobotTransportError("invalid_request", "Bordeaux atomic rename must keep one fixed control file inside its inbox directory");
    }
    const source = remotePath(from);
    const destination = remotePath(to);
    if (path.posix.dirname(source) !== path.posix.dirname(destination)) {
      throw new RobotTransportError("invalid_request", "Bordeaux atomic rename must remain in one remote directory");
    }
    if (signal.aborted && !this.sessionSignal.aborted) throw new RobotTransportError("cancelled", "SFTP to the robot was cancelled");
    return callbackOperation(AbortSignal.any([signal, this.sessionSignal]), this.timedOut, (callback) => {
      this.sftp.ext_openssh_rename(source, destination, callback);
    });
  }

  remove(file: RobotRemoteFile, signal: AbortSignal): Promise<void> {
    if (file.kind !== "incomingTemporary" && file.kind !== "incomingRetentionTemporary" && file.kind !== "pathTemporary") {
      throw new RobotTransportError("invalid_request", "Bordeaux cleanup can remove only a temporary inbox file");
    }
    if (signal.aborted && !this.sessionSignal.aborted) throw new RobotTransportError("cancelled", "SFTP to the robot was cancelled");
    return callbackOperation(AbortSignal.any([signal, this.sessionSignal]), this.timedOut, (callback) => this.sftp.unlink(remotePath(file), callback));
  }

  async close(): Promise<void> {
    this.cleanup();
    this.sftp.end();
    this.client.end();
  }
}

export async function connectRobotSftp(request: RobotConnectRequest): Promise<RobotSftpSession> {
  if (request.signal.aborted) throw new RobotTransportError("cancelled", "SFTP to the robot was cancelled");
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 120_000) {
    throw new RobotTransportError("invalid_request", "Robot SFTP timeout must be between 1 and 120000 milliseconds");
  }
  const client = new Client();
  const controller = new AbortController();
  let expired = false;
  let rejectedHostKey = false;
  let observedFingerprint = "";
  const timeout = setTimeout(() => {
    expired = true;
    controller.abort();
    client.destroy();
  }, request.timeoutMs);
  timeout.unref();
  const cancel = () => {
    controller.abort();
    client.destroy();
  };
  request.signal.addEventListener("abort", cancel, { once: true });
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
  };

  try {
    const sftp = await guarded<SFTPWrapper>(controller.signal, () => expired, (resolve, reject) => {
      client.once("ready", () => {
        client.sftp((error, channel) => error ? reject(error) : resolve(channel));
      });
      client.on("error", reject);
      client.once("close", () => reject(operationError(controller.signal, () => expired)));
      client.connect({
        host: request.endpoint.host,
        port: request.endpoint.port,
        username: "lvuser",
        readyTimeout: request.timeoutMs,
        keepaliveInterval: Math.min(2_000, Math.max(250, Math.floor(request.timeoutMs / 3))),
        keepaliveCountMax: 2,
        ...(request.credentials.password !== undefined ? { password: request.credentials.password } : {}),
        ...(request.credentials.privateKey !== undefined ? { privateKey: request.credentials.privateKey } : {}),
        ...(request.credentials.passphrase !== undefined ? { passphrase: request.credentials.passphrase } : {}),
        hostVerifier: (key: Buffer) => {
          observedFingerprint = fingerprint(key);
          if (request.expectedHostKeyFingerprint && observedFingerprint !== request.expectedHostKeyFingerprint) {
            rejectedHostKey = true;
            return false;
          }
          return true;
        },
      });
    });
    if (!observedFingerprint) throw new RobotTransportError("unavailable", UNAVAILABLE_MESSAGE);
    return new Ssh2RobotSession(client, sftp, observedFingerprint, controller.signal, () => expired, cleanup);
  } catch (error) {
    cleanup();
    client.destroy();
    if (rejectedHostKey) {
      throw new RobotTransportError("re_pair_required", "The robot SSH host key changed; explicitly re-pair this robot before transferring data");
    }
    if (error instanceof RobotTransportError) throw error;
    throw operationError(controller.signal, () => expired, error);
  }
}
