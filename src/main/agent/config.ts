import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configPath } from "./paths.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Workspace root handed down by the Electron main process. Packaged builds set
 * it to <userData>/workspace: the app bundle is read-only there, and Electron
 * code cannot be imported here (headless scripts under scripts/ load this
 * module through plain Node, where `require("electron")` is a path string).
 */
let configuredRoot: string | null = null;

/** Explicit override; `null` clears it and falls back to the lower precedences. */
export function configureWorkspaceRoot(dir: string | null): void {
  configuredRoot = dir && dir.trim() ? path.resolve(dir) : null;
}

export interface AppConfig {
  /** Ollama model name, e.g. "glm-5.2:cloud" */
  model: string;
  /** Ollama daemon base URL */
  baseUrl: string;
  /** Directory the agent treats as its sandbox (real-FS mode) */
  workspaceDir: string;
  /** When true, use an in-memory virtual filesystem instead of the real one */
  memfs: boolean;
  /** When true, skip human approval for shell commands (--yolo) */
  yolo: boolean;
  /** Ask the model for visible reasoning (Ollama think mode). OLLAMA_THINK=0 to disable. */
  think: boolean;
}

/** Optional user config at ~/.deepagents/hermes/config.json; {} when absent/invalid. */
function readConfigFile(): Partial<AppConfig> {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<AppConfig>;
  } catch {
    return {};
  }
}

/**
 * The workspace the agent and the Files page operate on. Precedence:
 * AGENT_WORKSPACE env (scripts/tests override everything) -> config.json
 * workspaceDir (the user's own choice) -> the main-process root (packaged app)
 * -> the checkout's workspace/ (dev and headless runs).
 *
 * Read live rather than cached: the main process configures its root early in
 * startup, but the Files page must follow whatever is current.
 */
export function workspaceDirPath(): string {
  const override = process.env.AGENT_WORKSPACE?.trim();
  if (override) return path.resolve(override);
  const fromFile = readConfigFile().workspaceDir?.trim();
  if (fromFile) return path.resolve(fromFile);
  return configuredRoot ?? path.join(projectRoot, "workspace");
}

/**
 * Candidate locations of the shipped AGENTS.md template. The bundled output and
 * the TypeScript sources sit at different depths, and a packaged app keeps its
 * files inside app.asar, so every layout is tried.
 */
function seedTemplatePaths(): string[] {
  const candidates: string[] = [];
  try {
    candidates.push(fileURLToPath(new URL("../../workspace/AGENTS.md", import.meta.url)));
    candidates.push(fileURLToPath(new URL("../../../workspace/AGENTS.md", import.meta.url)));
  } catch {
    // import.meta.url is a file URL under both Electron and Node; stay defensive.
  }
  // `resourcesPath` is Electron-only and absent from @types/node, so it is read
  // structurally instead of importing electron.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, "app.asar", "workspace", "AGENTS.md"));
  }
  return candidates;
}

/**
 * Seed a freshly-created workspace with the shipped AGENTS.md so the agent has
 * its standing instructions on first run. Best effort by design: a missing
 * template (unusual packaging layout, trimmed install) or an unwritable
 * directory must not stop the app from starting.
 */
export function ensureWorkspaceSeed(dir: string): void {
  try {
    const target = path.join(dir, "AGENTS.md");
    if (fs.existsSync(target)) return;
    const source = seedTemplatePaths().find((candidate) => fs.existsSync(candidate));
    if (!source) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(source, target);
  } catch {
    // ignore — see above
  }
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const file = readConfigFile();
  return {
    model: process.env.OLLAMA_MODEL ?? file.model ?? "deepseek-v4-flash:0731-cloud",
    baseUrl: process.env.OLLAMA_BASE_URL ?? file.baseUrl ?? "http://localhost:11434",
    workspaceDir: workspaceDirPath(),
    memfs: argv.includes("--memfs") || file.memfs === true,
    yolo: argv.includes("--yolo") || file.yolo === true,
    think: !["0", "false"].includes((process.env.OLLAMA_THINK ?? "").toLowerCase()),
  };
}
