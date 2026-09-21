import fs from "node:fs";
import path from "node:path";
import type { SkillInfo, SkillInput } from "../../../shared/wire.js";
import { skillsDir } from "../paths.js";

/** JSON.stringify emits a valid YAML double-quoted scalar (colons/quotes/newlines safe). */
export function renderFrontmatter(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n`;
}

/** SKILL.md = frontmatter + body, shared by the writer tool and the Skills view. */
export function renderSkillFile(input: SkillInput): string {
  return `${renderFrontmatter(input.name, input.description)}${input.content}\n`;
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

export function parseSkillFile(raw: string, fallbackName: string): ParsedSkill {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) return { name: fallbackName, description: "", body: raw };
  const front = match[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? fallbackName;
  const rawDescription = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
  let description = rawDescription;
  if (rawDescription.startsWith('"')) {
    try {
      description = JSON.parse(rawDescription) as string;
    } catch {
      // Not valid JSON — keep the literal scalar rather than lose the text.
    }
  }
  return { name, description, body: raw.slice(match[0].length) };
}

export interface SkillSource {
  dir: string;
  source: "user" | "project";
}

/** Same sources, in the same order, as the skills middleware injects. */
export function skillSources(): SkillSource[] {
  const sources: SkillSource[] = [{ dir: skillsDir(), source: "user" }];
  const project = path.join(process.cwd(), ".deepagents", "skills");
  if (fs.existsSync(project)) sources.push({ dir: project, source: "project" });
  return sources;
}

export function listSkills(): SkillInfo[] {
  const out: SkillInfo[] = [];
  for (const { dir, source } of skillSources()) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      const parsed = parseSkillFile(fs.readFileSync(file, "utf8"), entry.name);
      out.push({ name: parsed.name, description: parsed.description, source, path: file });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Full SKILL.md text. Project skills shadow user skills of the same name (as load_skill does). */
export function readSkill(name: string): string | null {
  for (const { dir } of skillSources().reverse()) {
    const file = path.join(dir, name, "SKILL.md");
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return null;
}

export function writeSkillFile(input: SkillInput): void {
  const dir = path.join(skillsDir(), input.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkillFile(input));

  // Renaming writes the new slug then drops the old directory: leaving both
  // behind would list the skill twice and keep serving the stale copy.
  const previous = input.previousName;
  if (previous !== undefined && previous !== input.name) {
    const oldDir = path.join(skillsDir(), previous);
    if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true });
  }
}

/** Removes a skill directory from the user or project source. Throws when it is absent. */
export function deleteSkillFile(name: string, source: "user" | "project"): void {
  const match = skillSources().find((s) => s.source === source);
  if (match === undefined) {
    throw new Error(`No ${source} skills directory is configured.`);
  }
  const dir = path.join(match.dir, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`No ${source} skill named "${name}" exists.`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
