import { describe, expect, it, vi } from "vitest";
import { requestProjectReload } from "../src/electron/projectReload";

describe("development project reload guard", () => {
  it.each(["cancel", "save", "discard"] as const)("handles %s without bypassing dirty drafts", async (choice) => {
    const actions = { isDirty: () => true, ask: vi.fn(async () => choice), save: vi.fn(), reload: vi.fn() };
    await requestProjectReload(actions);
    expect(actions.ask).toHaveBeenCalledOnce();
    expect(actions.save).toHaveBeenCalledTimes(choice === "save" ? 1 : 0);
    expect(actions.reload).toHaveBeenCalledTimes(choice === "discard" ? 1 : 0);
  });
  it("reloads clean projects without prompting", async () => {
    const actions = { isDirty: () => false, ask: vi.fn(async () => "cancel" as const), save: vi.fn(), reload: vi.fn() };
    await requestProjectReload(actions);
    expect(actions.ask).not.toHaveBeenCalled();
    expect(actions.reload).toHaveBeenCalledOnce();
  });
});
