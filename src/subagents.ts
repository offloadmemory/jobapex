import type { SubAgent } from "deepagents";
import { webSearch } from "./tools/search.js";
import { ollamaToolContentShim } from "./ollamaShim.js";

// Custom subagents don't inherit the main agent's middleware, so each needs
// the Ollama tool-content shim attached explicitly.
const shim = [ollamaToolContentShim];

/**
 * Specialized subagents the main agent can delegate to via the built-in
 * `task` tool. Each runs in its own isolated context and returns a
 * compressed result to the parent.
 *
 * Subagents without an explicit `tools` array inherit the main agent's
 * tools; all of them share the same filesystem backend, so files written
 * by one are visible to the others.
 */
export const subagents: SubAgent[] = [
  {
    name: "researcher",
    description:
      "Delegate web research here: gathering facts, comparing options, reading up on libraries or APIs. " +
      "Give it a focused question; it returns a concise, source-linked summary.",
    systemPrompt:
      "You are a meticulous research assistant. Use web_search to gather information, " +
      "cross-check at least two sources when claims matter, and keep notes in files if the " +
      "research is large. Always finish with a concise summary that cites source URLs. " +
      "Never fabricate sources.",
    tools: [webSearch],
    middleware: shim,
  },
  {
    name: "coder",
    description:
      "Delegate implementation work here: writing or editing files, scaffolding projects, running " +
      "shell commands, executing tests. Give it a well-scoped task with acceptance criteria.",
    systemPrompt:
      "You are a pragmatic software engineer working inside a sandboxed workspace. " +
      "Write clean, minimal code with the filesystem tools, and use execute to run commands " +
      "(installs, builds, tests). Verify your work actually runs before reporting back. " +
      "Report what you created/changed and the verification result.",
    middleware: shim,
  },
  {
    name: "critic",
    description:
      "Delegate reviews here: checking produced files or code against requirements. " +
      "It only reports issues; it does not fix them.",
    systemPrompt:
      "You are a critical reviewer. Read the relevant files and assess them against the stated " +
      "requirements. Report concrete problems (with file paths and line references) and a " +
      "pass/fail verdict. You must not modify any files — never use write_file, edit_file " +
      "or mutating shell commands; you are a reviewer, not a fixer.",
    middleware: shim,
  },
  {
    name: "librarian",
    description:
      "Delegate knowledge maintenance here after tasks that produced durable learnings: " +
      "decisions made, gotchas discovered, how things in the workspace work, user preferences. " +
      "It records them in the OpenWiki knowledge base so future sessions start informed.",
    systemPrompt:
      "You are the librarian: you maintain the agent's long-term knowledge base at /openwiki. " +
      "Rules:\n" +
      "- Agent-authored knowledge lives in /openwiki/notes/ as Markdown files following the " +
      "Open Knowledge Format: YAML front matter with a `type` field (use type: \"Note\"), a " +
      "title, then concise content. One topic per file, kebab-case filenames.\n" +
      "- Before writing, read /openwiki/notes/ (ls + read relevant files). Update an existing " +
      "note if the topic exists — do not create near-duplicates. Delete notes proven wrong.\n" +
      "- Keep /openwiki/notes/index.md current: one line per note linking to it.\n" +
      "- NEVER edit generated OpenWiki pages (anything outside /openwiki/notes/ except reading).\n" +
      "- Record facts worth re-reading in a month: decisions + why, verified commands, " +
      "pitfalls + fixes, user preferences. Skip session trivia.\n" +
      "Finish by reporting which notes you created/updated.",
    middleware: shim,
  },
];
