import { beforeEach, describe, expect, it, vi } from "vitest";

const { log } = vi.hoisted(() => ({ log: vi.fn(async () => ({ ok: true as const, data: null })) }));

/**
 * `window.hermes` is injected by preload, which does not exist under vitest, so
 * the bridge is replaced wholesale. The real bridge's rejections (a packaged
 * build with no handler, an IPC failure) are part of what these tests cover.
 */
vi.mock("./ipc", () => ({ hermes: { app: { log } } }));

import { reportError, reportInfo, reportWarn } from "./log";

beforeEach(() => {
  log.mockClear();
});

describe("renderer reports", () => {
  it("reports an Error at error level with scope and message", () => {
    reportError("chat.run", new Error("fetch failed"));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "chat.run: fetch failed");
  });

  it("stringifies a thrown value that is not an Error", () => {
    reportError("settings.save", "plain failure");

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "settings.save: plain failure");
  });

  it("stringifies a non-Error object and an undefined throw", () => {
    reportError("chat.run", { code: 500 });
    reportError("chat.run", undefined);

    expect(log).toHaveBeenNthCalledWith(1, "error", "chat.run: [object Object]");
    expect(log).toHaveBeenNthCalledWith(2, "error", "chat.run: undefined");
  });

  it("reports a warning at warn level", () => {
    reportWarn("settings.save", "disk almost full");

    expect(log).toHaveBeenCalledExactlyOnceWith("warn", "settings.save: disk almost full");
  });

  it("reports info at info level", () => {
    reportInfo("app", "renderer ready");

    expect(log).toHaveBeenCalledExactlyOnceWith("info", "app: renderer ready");
  });

  it("never throws when the bridge rejects", () => {
    log.mockRejectedValueOnce(new Error("no handler registered for app:log"));

    expect(() => reportWarn("settings.save", "unreachable bridge")).not.toThrow();
    // The .catch in log.ts has to swallow the rejection: an unhandled one would
    // fail the test run itself.
    expect(log).toHaveBeenCalledExactlyOnceWith("warn", "settings.save: unreachable bridge");
  });

  it("never throws for any input shape, including a rejecting bridge", () => {
    log.mockRejectedValue(new Error("bridge down"));

    expect(() => reportError("chat.run", new Error("boom"))).not.toThrow();
    expect(() => reportError("chat.run", null)).not.toThrow();
    expect(() => reportError("chat.run", Symbol("boom"))).not.toThrow();
    expect(() => reportWarn("chat.run", "")).not.toThrow();
    expect(() => reportInfo("chat.run", "")).not.toThrow();

    expect(log).toHaveBeenCalledTimes(5);
  });
});
