import fs from "node:fs";
import path from "node:path";
import { createSkillsMiddleware, FilesystemBackend } from "deepagents";
import { skillsDir } from "../paths.js";

/**
 * Skills middleware: loads SKILL.md files from the user skills dir (and the
 * project .deepagents/skills dir when present) and injects name+description
 * into the system prompt (progressive disclosure). The agent reads full
 * SKILL.md content via read_file when it needs to follow a skill.
 */
export function createSkillsRegistry() {
  const sources = [skillsDir()];
  const projectSkills = path.join(process.cwd(), ".deepagents", "skills");
  if (fs.existsSync(projectSkills)) sources.push(projectSkills);
  return createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: "/" }),
    sources,
  });
}
