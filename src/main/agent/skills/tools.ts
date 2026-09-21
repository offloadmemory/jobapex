import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import * as z from "zod";
import { skillsDir } from "../paths.js";
import { renderSkillFile } from "./file.js";

/**
 * Propose a new reusable skill. Gated by interruptOn: the HITL gate pauses
 * for approve/edit/reject BEFORE this function runs, so a skill only becomes
 * loadable after the user consents.
 */
export const writeSkill = tool(
  async ({ name, description, content }: { name: string; description: string; content: string }) => {
    const dir = path.join(skillsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkillFile({ name, description, content }));
    return `Skill "${name}" written to ${dir}. It is now available to load in future sessions.`;
  },
  {
    name: "write_skill",
    description:
      "Propose a new reusable skill (a SKILL.md file) capturing a repeatable workflow. " +
      "Use when you have performed a non-obvious procedure more than once. The user must approve before it is saved.",
    schema: z.object({
      name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("kebab-case skill name (lowercase, hyphens)"),
      description: z.string().describe("what the skill does and when to use it"),
      content: z.string().describe("the SKILL.md body: step-by-step instructions"),
    }),
  }
);

/**
 * Read the full instructions (SKILL.md) for a skill by name. Mirrors writeSkill:
 * reads via node:fs directly, because the agent's filesystem tools are jailed to
 * the workspace and cannot reach the skills directory at its OS-absolute path.
 */
export const loadSkill = tool(
  async ({ name }: { name: string }) => {
    const projectSkill = path.join(process.cwd(), ".deepagents", "skills", name, "SKILL.md");
    const userSkill = path.join(skillsDir(), name, "SKILL.md");
    for (const p of [projectSkill, userSkill]) {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    }
    return `No skill named "${name}" found. Available skills are listed in your system prompt; they live in ${skillsDir()} and the project .deepagents/skills dir.`;
  },
  {
    name: "load_skill",
    description:
      "Read the full instructions (SKILL.md) for a skill by name. Use when a skill's name/description in your system prompt matches the user's task, to load its step-by-step workflow.",
    schema: z.object({
      name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("kebab-case skill name to load"),
    }),
  }
);
