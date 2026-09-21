import fs from "node:fs";
import path from "node:path";
import { Command } from "@langchain/langgraph";
import type { HITLRequest } from "langchain";
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { skillsDir } from "../src/main/agent/paths.js";
import { loadSkill, writeSkill } from "../src/main/agent/skills/tools.js";
import { parseSkillMetadata } from "deepagents";

import { requireIsolatedHome } from "./lib/isolated-home.js";

// Refuses to run without the temp HOME the npm script sets.
requireIsolatedHome();

// Seed a skill so list/load has something to find.
const seed = path.join(skillsDir(), "demo-skill");
fs.mkdirSync(seed, { recursive: true });
fs.writeFileSync(path.join(seed, "SKILL.md"), "---\nname: demo-skill\ndescription: A demo skill for testing.\n---\n# Demo\nSay 'demo skill loaded'.\n");

// 1. List + load: the agent should find and follow the seeded skill.
const agent = buildAgent(loadConfig(["--yolo"]));
const res = await agent.invoke(
  { messages: [{ role: "user", content: "List your available skills, then load and follow the demo-skill." }] },
  { configurable: { thread_id: "skills-test" }, recursionLimit: 100 }
);
const last = res.messages[res.messages.length - 1];
const text = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
console.log("list/load result:", text);
if (!text.includes("demo-skill")) throw new Error("FAIL: agent did not list demo-skill");

// 1b. load_skill: the tool must return the demo-skill body directly.
const body = await loadSkill.invoke({ name: "demo-skill" });
console.log("load_skill body:", body);
if (!/demo skill loaded/i.test(body)) throw new Error("FAIL: load_skill did not return the demo-skill body");

// 2. Gated write: write_skill must pause for approval before writing.
const gateAgent = buildAgent(loadConfig([])); // gate ON
const gateConfig = {
  configurable: { thread_id: "skills-gate-test" },
  streamMode: "updates" as const,
  subgraphs: true as const,
  recursionLimit: 100,
};
function extractInterrupt(chunk: unknown): HITLRequest | null {
  const [, update] = chunk as [string[], Record<string, unknown>];
  const interrupts = update?.["__interrupt__"] as Array<{ value?: HITLRequest }> | undefined;
  return interrupts?.[0]?.value ?? null;
}
const gateStream = await gateAgent.stream(
  { messages: [{ role: "user", content: "Use the write_skill tool to propose a skill named 'gate-test-skill' with description 'A gated test skill' and content 'Say gate test passed'." }] },
  gateConfig
);
let gatePending: HITLRequest | null = null;
for await (const chunk of gateStream) {
  const i = extractInterrupt(chunk);
  if (i) gatePending = i;
}
if (!gatePending) throw new Error("FAIL: expected write_skill to pause for approval");
const gateTool = gatePending.actionRequests[0]?.name;
console.log("gate fired for tool:", gateTool);
if (gateTool !== "write_skill") throw new Error(`FAIL: expected write_skill gate, got ${gateTool}`);

// Approve and verify the file is written.
const gateDone = await gateAgent.stream(
  new Command({ resume: { decisions: [{ type: "approve" }] } }),
  gateConfig
);
for await (const _ of gateDone) { /* drain */ }
const written = fs.existsSync(path.join(skillsDir(), "gate-test-skill", "SKILL.md"));
console.log("skill written after approve:", written);
if (!written) throw new Error("FAIL: write_skill did not write the file after approval");

// 3. Frontmatter quoting: a colon-containing description must round-trip through
// deepagents' own skill metadata parser (a naive unquoted value breaks YAML).
const colonDescription = 'sections: Features, Bug Fixes; note: "quoted"';
await writeSkill.invoke({ name: "colon-test-skill", description: colonDescription, content: "Say colon test passed" });
const colonSkillMd = path.join(skillsDir(), "colon-test-skill", "SKILL.md");
try {
  const parsed = parseSkillMetadata(colonSkillMd, "user");
  const roundTrip = parsed !== null && parsed.description === colonDescription;
  console.log("frontmatter round-trip:", roundTrip ? "PASS" : `FAIL (parsed=${JSON.stringify(parsed)})`);
  if (!roundTrip) throw new Error("FAIL: colon-containing description did not round-trip through parseSkillMetadata");
} finally {
  fs.rmSync(path.join(skillsDir(), "colon-test-skill"), { recursive: true, force: true });
}

console.log("SKILLS_TEST_DONE — list/load works, write_skill gate fires and writes on approve, frontmatter is YAML-safe.");
