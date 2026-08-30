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
