import { createSkillsMiddleware, FilesystemBackend } from "deepagents";
import { skillSources } from "./file.js";

/**
 * Skills middleware: loads SKILL.md files from the user skills dir (and the
 * project .deepagents/skills dir when present) and injects name+description
 * into the system prompt (progressive disclosure). The agent reads full
 * SKILL.md content via read_file when it needs to follow a skill.
 */
export function createSkillsRegistry() {
  return createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: "/" }),
    sources: skillSources().map((source) => source.dir),
  });
}
