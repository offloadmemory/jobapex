import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMemoryMiddleware, FilesystemBackend } from "deepagents";
import { AGENT_NAME } from "./paths.js";

const DEFAULT_AGENT_MD = `# ${AGENT_NAME} — identity

You are ${AGENT_NAME}, a personal assistant. Add your standing preferences,
identity, and instructions here. This file is loaded into every session.
`;

/** Absolute path to the user-level identity file, created with a default if missing. */
function userAgentMdPath(): string {
  const p = path.join(os.homedir(), ".deepagents", AGENT_NAME, "agent.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, DEFAULT_AGENT_MD);
  return p;
}

/**
 * Memory middleware loading user identity + project instructions into the
 * system prompt. Uses a FilesystemBackend rooted at "/" (virtualMode false)
 * so absolute paths resolve as-is, independent of the workspace sandbox.
 *
 * Sources (in order): user agent.md, workspace AGENTS.md (carries the OpenWiki
 * pointer block — must be preserved), then project .deepagents/agent.md.
 */
export function createIdentityMiddleware(workspaceDir: string) {
  const sources = [userAgentMdPath()];
  const workspaceAgentMd = path.join(workspaceDir, "AGENTS.md");
  if (fs.existsSync(workspaceAgentMd)) sources.push(workspaceAgentMd);
  const projectAgentMd = path.join(process.cwd(), ".deepagents", "agent.md");
  if (fs.existsSync(projectAgentMd)) sources.push(projectAgentMd);
  return createMemoryMiddleware({
    backend: new FilesystemBackend({ rootDir: "/" }),
    sources,
  });
}
