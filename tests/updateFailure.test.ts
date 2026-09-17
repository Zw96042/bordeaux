import { describe, expect, it, vi } from "vitest";
import { OFFICIAL_RELEASES_URL, presentUpdateFailure } from "../src/electron/updateFailure";

describe("update failure recovery", () => {
  it("explains signature verification failure and opens only the official releases page", async () => {
    const show = vi.fn(async (_options: { detail?: string }) => ({ response: 1 })), open = vi.fn(async () => undefined), copy = vi.fn();
    await presentUpdateFailure("Code signature failed https://untrusted.example/installer", { show, open, copy });
    expect(show.mock.calls[0][0].detail).toContain("could not be verified");
    expect(show.mock.calls[0][0].detail).toContain("replace the installed app manually");
    expect(open).toHaveBeenCalledExactlyOnceWith(OFFICIAL_RELEASES_URL);
    expect(copy).not.toHaveBeenCalled();
  });
  it("offers network recovery and copies full diagnostics while retaining other actions", async () => {
    const message = "ECONNRESET: " + "details ".repeat(300);
    const show = vi.fn().mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 0 });
    const open = vi.fn(async () => undefined), copy = vi.fn();
    await presentUpdateFailure(message, { show, open, copy });
    expect(show.mock.calls[0][0].detail).toContain("Check your internet connection");
    expect(show.mock.calls[0][0].detail).not.toContain(message);
    expect(copy).toHaveBeenCalledExactlyOnceWith(message);
    expect(show).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });
  it("summarizes a denied GitHub feed request without displaying its HTML response", async () => {
    const message = '403 method: GET url: https://github.com/Zw96042/bordeaux/releases.atom\n'
      + '<!DOCTYPE html><html><style>body { background: url(data:image/png;base64,'
      + 'a'.repeat(5000) + '); }</style><body>Forbidden</body></html>';
    const show = vi.fn().mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 });
    const open = vi.fn(async () => undefined), copy = vi.fn();
    await presentUpdateFailure(message, { show, open, copy });
    const detail = show.mock.calls[0][0].detail;
    expect(detail).toContain("HTTP 403");
    expect(detail).toContain("another network");
    expect(detail).not.toMatch(/<html|<style|base64|releases\.atom/);
    expect(detail.length).toBeLessThan(400);
    expect(copy).toHaveBeenCalledExactlyOnceWith(message);
    expect(open).toHaveBeenCalledExactlyOnceWith(OFFICIAL_RELEASES_URL);
    expect(show.mock.calls[1][0].detail).toBe(detail);
  });

  it("keeps unknown response bodies out of the dialog and out of classification", async () => {
    const message = 'Unexpected response\n<html><body>signature network 403 '
      + 'data:image/png;base64,abc</body></html>';
    const show = vi.fn().mockResolvedValue({ response: 0 });
    await presentUpdateFailure(message, { show, open: vi.fn(), copy: vi.fn() });
    expect(show.mock.calls[0][0].detail).not.toMatch(/verified|HTTP 403|<html|base64/);
    expect(show.mock.calls[0][0].detail).toContain("Copy details");
  });

});
