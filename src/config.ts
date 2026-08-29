import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configPath } from "./paths.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const file = readConfigFile();
  return {
    model: process.env.OLLAMA_MODEL ?? file.model ?? "deepseek-v4-flash:0731-cloud",
    baseUrl: process.env.OLLAMA_BASE_URL ?? file.baseUrl ?? "http://localhost:11434",
    workspaceDir: process.env.AGENT_WORKSPACE ?? file.workspaceDir ?? path.join(projectRoot, "workspace"),
    memfs: argv.includes("--memfs") || file.memfs === true,
    yolo: argv.includes("--yolo") || file.yolo === true,
    think: !["0", "false"].includes((process.env.OLLAMA_THINK ?? "").toLowerCase()),
  };
}
