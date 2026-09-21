import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { logError, logInfo } from "./logger.js";

/**
 * The logger resolves ~/.deepagents/hermes through os.homedir(), which follows
 * HOME on POSIX, so each test runs against a throwaway home and never touches
 * the developer's real log file.
 */
const originalHome = process.env.HOME;

let home = "";

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-log-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

function logFile(): string {
  return path.join(home, ".deepagents", "hermes", "logs", "hermes.log");
}

function lines(): Array<Record<string, unknown>> {
  return fs
    .readFileSync(logFile(), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("logger", () => {
  it("appends one JSON line per entry under the agent home", () => {
    logInfo("main", "hermes ready", { version: "1.0.0" });
    logError("agent.run", new Error("fetch failed"));

    const entries = lines();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: "info",
      scope: "main",
      message: "hermes ready",
      detail: { version: "1.0.0" },
    });
    expect(entries[1]).toMatchObject({ level: "error", scope: "agent.run", message: "fetch failed" });
    expect(entries[1].ts).toEqual(expect.any(String));
    expect((entries[1].detail as { name?: string }).name).toBe("Error");
  });

  it("keeps a stringified message for error-like objects with no prototype", () => {
    logError("agent.run", { name: "ProviderError", message: "model not found" });

    const [entry] = lines();
    expect(entry.message).toBe("model not found");
    expect(entry.detail).toEqual({ name: "ProviderError", message: "model not found" });
  });

  it("rotates at the size cap and keeps at most three older files", () => {
    const filler = "x".repeat(900);
    for (let i = 0; i < 700; i++) logInfo("test", "filler", filler);
    expect(fs.existsSync(`${logFile()}.1`)).toBe(true);
    expect(fs.statSync(logFile()).size).toBeLessThan(512 * 1024);

    for (let i = 0; i < 3000; i++) logInfo("test", "filler", filler);
    expect(fs.existsSync(`${logFile()}.2`)).toBe(true);
    expect(fs.existsSync(`${logFile()}.3`)).toBe(true);
    expect(fs.existsSync(`${logFile()}.4`)).toBe(false);
  });
});
