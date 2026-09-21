import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_NAME = "hermes";

/** ~/.deepagents/hermes — created on first use. */
export function agentHomeDir(): string {
  const dir = path.join(os.homedir(), ".deepagents", AGENT_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function skillsDir(): string {
  const dir = path.join(agentHomeDir(), "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function memoryDir(): string {
  const dir = path.join(agentHomeDir(), "memory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function checkpointsPath(): string {
  return path.join(agentHomeDir(), "checkpoints.sqlite");
}

export function configPath(): string {
  return path.join(agentHomeDir(), "config.json");
}

/** Rotating file log for main-process failures (see `src/main/app/logger.ts`). */
export function logsDir(): string {
  const dir = path.join(agentHomeDir(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** App-owned structured state: threads index, providers, settings, PIN hash. */
export function appDbPath(): string {
  return path.join(agentHomeDir(), "app.sqlite");
}

/** API keys encrypted with Electron safeStorage (never plaintext). */
export function secretsPath(): string {
  return path.join(agentHomeDir(), "secrets.bin");
}

/** User identity file loaded into every session (setup wizard writes it). */
export function agentMdPath(): string {
  return path.join(agentHomeDir(), "agent.md");
}
