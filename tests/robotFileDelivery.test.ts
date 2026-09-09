import { describe, expect, it, vi } from "vitest";
import { RobotFileDelivery, type PreparedRobotFile } from "../src/electron/robotFileDelivery";
import { DEFAULT_ROBOT_PATH_DIRECTORY, type RobotFileConnection } from "../src/shared/robotFileDelivery";
const connection: RobotFileConnection = { endpoint: { host: "roborio-2468-frc.local", port: 22, directory: DEFAULT_ROBOT_PATH_DIRECTORY }, hostKeyFingerprint: "SHA256:abcdefghijklmnopqrstuvxyz123456789" };
const file = (): PreparedRobotFile => ({ pathId: "path-1", name: "Opening", fileName: "Opening.bdx", contents: Buffer.from("BDX fixture") });
function setup(initial: RobotFileConnection | null = connection) {
  const persist = vi.fn(async () => undefined);
  const transport = { probe: vi.fn(async () => structuredClone(connection)), upload: vi.fn(async (_connection: RobotFileConnection, _files: Array<{ fileName: string; contents: Buffer }>, _signal?: AbortSignal) => undefined) };
  return { delivery: new RobotFileDelivery(initial, persist, transport), persist, transport };
}
describe("reviewed robot file delivery", () => {
  it("probes without writing and trusts only the observed SSH identity", async () => {
    const { delivery, transport, persist } = setup(null);
    await expect(delivery.trust(connection.hostKeyFingerprint)).rejects.toThrow(/Connect and review/);
    const observed = await delivery.probe(connection.endpoint);
    observed.endpoint.host = "changed.local";
    await expect(delivery.trust("SHA256:wrong")).rejects.toThrow(/review/);
    expect(await delivery.trust(connection.hostKeyFingerprint)).toEqual(connection);
    expect(persist).toHaveBeenCalledExactlyOnceWith(connection);
    expect(transport.upload).not.toHaveBeenCalled();
  });
  it("uploads immutable reviewed bytes and destination only once", async () => {
    const { delivery, transport } = setup();
    const original = file(), validate = vi.fn(async () => undefined);
    const preview = delivery.prepare([original], validate);
    original.contents.fill(0); preview.connection.endpoint.host = "changed.local"; preview.files[0].fileName = "wrong.bdx";
    const result = await delivery.confirm(preview.operationId);
    expect(transport.upload.mock.calls[0][0]).toEqual(connection);
    expect(transport.upload.mock.calls[0][1][0]).toMatchObject({ fileName: "Opening.bdx", contents: Buffer.from("BDX fixture") });
    expect(result).toMatchObject({ state: "transferred", directory: "/natinst/bin/Paths" });
    expect(validate).toHaveBeenCalledOnce();
    await expect(delivery.confirm(preview.operationId)).rejects.toThrow(/Review/);
  });
  it("cancels review without opening a connection and rejects stale context before upload", async () => {
    const { delivery, transport } = setup();
    const first = delivery.prepare([file()], async () => undefined);
    expect(delivery.cancel(first.operationId)).toEqual({ canceled: true });
    await expect(delivery.confirm(first.operationId)).rejects.toThrow(/Review/);
    const second = delivery.prepare([file()], async () => { throw new Error("Catalog changed"); });
    await expect(delivery.confirm(second.operationId)).rejects.toThrow("Catalog changed");
    expect(transport.upload).not.toHaveBeenCalled();
  });
  it("rejects colliding file names before any transfer", () => {
    const { delivery, transport } = setup();
    expect(() => delivery.prepare([file(), { ...file(), pathId: "path-2", fileName: "opening.bdx" }], async () => undefined)).toThrow(/matching BDX filenames/);
    expect(transport.upload).not.toHaveBeenCalled();
  });
  it("locks confirmation, allows upload cancellation, and waits for shutdown", async () => {
    let finish!: () => void;
    let signal!: AbortSignal;
    const transport = { probe: vi.fn(async () => connection), upload: vi.fn(async (_c: RobotFileConnection, _f: Array<{ fileName: string; contents: Buffer }>, s?: AbortSignal) => { signal = s!; await new Promise<void>(resolve => { finish = resolve; }); s!.throwIfAborted(); }) };
    const delivery = new RobotFileDelivery(connection, async () => undefined, transport);
    const preview = delivery.prepare([file()], async () => undefined);
    const confirmed = delivery.confirm(preview.operationId);
    const failure = expect(confirmed).rejects.toThrow();
    await vi.waitFor(() => expect(transport.upload).toHaveBeenCalledOnce());
    await expect(delivery.confirm(preview.operationId)).rejects.toThrow(/Review/);
    await expect(delivery.probe(connection.endpoint)).rejects.toThrow(/Finish/);
    const stopped = delivery.stop();
    expect(signal.aborted).toBe(true);
    finish(); await stopped; await failure;
  });
});
