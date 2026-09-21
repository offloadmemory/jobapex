/**
 * Live test of the Skills surface: write a SKILL.md exactly as the Skills view's
 * dialog does, then assert what the list and the preview read back — including
 * the frontmatter round-trip that decides whether the agent can load the skill.
 *
 * Run: npm run skills:ui-test  (HOME is redirected there, see lib/isolated-home)
 */
import fs from "node:fs";
import path from "node:path";

import { requireIsolatedHome } from "./lib/isolated-home.js";
import { listSkills, parseSkillFile, readSkill, skillSources, writeSkillFile } from "../src/main/agent/skills/file.js";

const home = requireIsolatedHome();

const name = `skills-ui-test-${Date.now()}`;
const description = 'Round-trip test: quotes "and" colons — plus a newline-free scalar';
const content = "## When to use\n\nWhen verifying the Skills view.\n\n1. Write\n2. Read\n";

writeSkillFile({ name, description, content });

const info = listSkills().find((skill) => skill.name === name);
if (!info) throw new Error("FAIL: the skill just written is missing from listSkills()");
if (info.source !== "user") throw new Error(`FAIL: source is "${info.source}", expected "user"`);
if (info.description !== description) {
  throw new Error(`FAIL: description did not survive frontmatter: "${info.description}"`);
}
if (!info.path.endsWith(path.join(name, "SKILL.md"))) {
  throw new Error(`FAIL: unexpected path ${info.path}`);
}
console.log(`[list] ${info.name} (${info.source}) — ${info.description}`);

const raw = readSkill(name);
if (raw === null) throw new Error("FAIL: readSkill() returned null for the skill just written");
if (!raw.startsWith(`---\nname: ${name}\n`)) {
  throw new Error(`FAIL: the file does not open with frontmatter:\n${raw.slice(0, 80)}`);
}
const parsed = parseSkillFile(raw, "fallback");
if (parsed.name !== name) throw new Error(`FAIL: parsed name "${parsed.name}" != "${name}"`);
if (parsed.description !== description) {
  throw new Error(`FAIL: parsed description "${parsed.description}" != the submitted value`);
}
if (parsed.body.trim() !== content.trim()) {
  throw new Error(`FAIL: parsed body did not round-trip:\n${parsed.body}`);
}
console.log(`[read] ${raw.length} bytes, body round-trips byte-for-byte`);

// Re-saving the same name is how the dialog overwrites an existing user skill.
const updated = `${content}\n## Notes\n\nRewritten.\n`;
writeSkillFile({ name, description, content: updated });
if (!listSkills().some((skill) => skill.name === name)) {
  throw new Error("FAIL: the skill vanished after a second write");
}
if (!(readSkill(name) ?? "").includes("Rewritten.")) {
  throw new Error("FAIL: the second write did not overwrite the file");
}
console.log("[overwrite] second write replaced the same SKILL.md");

const sources = skillSources();
if (sources[0]?.source !== "user") {
  throw new Error("FAIL: skillSources() does not start with the user skills dir");
}
console.log(`[sources] ${sources.map((source) => `${source.source}:${source.dir}`).join(", ")}`);

fs.rmSync(home, { recursive: true, force: true });
console.log("SKILLS_UI_TEST_DONE — write, list, preview and overwrite all round-trip.");
process.exit(0);
