import fs from "node:fs";
import type * as NodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ hideAgentsTemplate: false }));

/**
 * ensureWorkspaceSeed is best effort about a missing template, and the shipped
 * template is always present in this checkout, so hide it on demand by wrapping
 * node:fs. Everything else in config.ts (and the test) keeps the real fs.
 */
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof NodeFs>("node:fs");
  const existsSync: typeof actual.existsSync = (target) =>
    flags.hideAgentsTemplate && String(target).endsWith("AGENTS.md") ? false : actual.existsSync(target);
  return { ...actual, default: { ...actual, existsSync } };
});

import { configureWorkspaceRoot, ensureWorkspaceSeed, loadConfig, workspaceDirPath } from "./config.js";

/** The checkout's own workspace/ directory — the lowest-precedence fallback. */
const repoWorkspace = path.resolve(fileURLToPath(new URL("../../../workspace", import.meta.url)));

const originalHome = process.env.HOME;
const originalWorkspace = process.env.AGENT_WORKSPACE;

let home = "";
let scratch = "";
let configFile = "";

function writeUserConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config), "utf8");
}

/** A directory the precedence chain can point at. */
function dir(name: string): string {
  const abs = path.join(scratch, name);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-config-home-"));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-config-scratch-"));
  configFile = path.join(home, ".deepagents", "hermes", "config.json");
  process.env.HOME = home;
  delete process.env.AGENT_WORKSPACE;
  configureWorkspaceRoot(null);
  flags.hideAgentsTemplate = false;
});

afterEach(() => {
  configureWorkspaceRoot(null);
  flags.hideAgentsTemplate = false;
  process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.AGENT_WORKSPACE;
  else process.env.AGENT_WORKSPACE = originalWorkspace;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("workspaceDirPath precedence", () => {
  it("lets AGENT_WORKSPACE win over the user config and the configured root", () => {
    const env = dir("from-env");
    configureWorkspaceRoot(dir("from-main"));
    writeUserConfig({ workspaceDir: dir("from-file") });
    process.env.AGENT_WORKSPACE = env;

    expect(workspaceDirPath()).toBe(path.resolve(env));
  });

  it("prefers the config.json workspaceDir over the configured root", () => {
    const fromFile = dir("from-file");
    configureWorkspaceRoot(dir("from-main"));
    writeUserConfig({ workspaceDir: fromFile });

    expect(workspaceDirPath()).toBe(path.resolve(fromFile));
  });

  it("ignores a blank or unparsable config.json and keeps the configured root", () => {
    const fromMain = dir("from-main");
    configureWorkspaceRoot(fromMain);
    writeUserConfig({ workspaceDir: "   " });

    expect(workspaceDirPath()).toBe(path.resolve(fromMain));

    fs.writeFileSync(configFile, "{ not json", "utf8");
    expect(workspaceDirPath()).toBe(path.resolve(fromMain));
  });

  it("prefers the configured root over the checkout's workspace/", () => {
    const fromMain = dir("from-main");
    configureWorkspaceRoot(fromMain);

    expect(workspaceDirPath()).toBe(path.resolve(fromMain));
  });

  it("falls back to the checkout's workspace/ when nothing is set", () => {
    expect(workspaceDirPath()).toBe(repoWorkspace);
    // The fallback has to be a usable workspace, not just a path string.
    expect(fs.existsSync(path.join(workspaceDirPath(), "AGENTS.md"))).toBe(true);
  });

  it("agrees with loadConfig().workspaceDir", () => {
    process.env.AGENT_WORKSPACE = dir("from-env");
    expect(loadConfig([]).workspaceDir).toBe(workspaceDirPath());

    delete process.env.AGENT_WORKSPACE;
    expect(loadConfig([]).workspaceDir).toBe(workspaceDirPath());
  });
});

describe("ensureWorkspaceSeed", () => {
  it("copies the shipped AGENTS.md into an empty workspace", () => {
    const target = path.join(scratch, "fresh-workspace");

    ensureWorkspaceSeed(target);

    const shipped = fs.readFileSync(path.join(repoWorkspace, "AGENTS.md"), "utf8");
    expect(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8")).toBe(shipped);
  });

  it("creates the workspace directory when it does not exist yet", () => {
    const target = path.join(scratch, "nested", "fresh-workspace");

    ensureWorkspaceSeed(target);

    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("never overwrites an existing AGENTS.md", () => {
    const target = dir("existing-workspace");
    fs.writeFileSync(path.join(target, "AGENTS.md"), "hand-written instructions", "utf8");

    ensureWorkspaceSeed(target);

    expect(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8")).toBe("hand-written instructions");
  });

  it("does not throw and writes nothing when no template is shipped", () => {
    const target = dir("template-less-workspace");
    flags.hideAgentsTemplate = true;

    expect(() => ensureWorkspaceSeed(target)).not.toThrow();
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it("does not throw when the target cannot be created", () => {
    const blocker = path.join(scratch, "not-a-directory");
    fs.writeFileSync(blocker, "blocker", "utf8");

    expect(() => ensureWorkspaceSeed(path.join(blocker, "workspace"))).not.toThrow();
  });
});
