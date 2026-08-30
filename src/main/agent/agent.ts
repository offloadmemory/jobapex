import fs from "node:fs";
import { todoListMiddleware } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, LocalShellBackend } from "deepagents";
import type { AppConfig } from "./config.js";
import { webSearch } from "./tools/search.js";
import { subagents } from "./subagents.js";
import { ollamaToolContentShim } from "./ollamaShim.js";
import { createIdentityMiddleware } from "./identity.js";
import { createSkillsRegistry } from "./skills/registry.js";
import { writeSkill, loadSkill } from "./skills/tools.js";
import { readMemory, writeMemory } from "./memory/tools.js";
import { createCheckpointer } from "./persistence.js";

const SYSTEM_PROMPT = `You are a capable autonomous engineering agent.

Your capabilities — be honest with yourself and the user about these:
- Your filesystem tools (read_file, write_file, edit_file, ls, glob, grep) are scoped to a workspace directory on the user's real machine.
- Your execute tool runs REAL shell commands on the user's machine, unsandboxed, with the user's OS permissions. It is NOT isolated: it can install software, touch files outside the workspace, and affect the user's system. Never claim you are sandboxed or cannot reach the user's machine — you can.
- Because of that power, risky commands (installs, deletions outside the workspace, piping remote scripts to a shell) require the user's explicit approval — an approval gate will pause execution and ask them. Prefer proposing such commands and letting the gate do its job over refusing outright; refuse only what is clearly harmful even with consent (e.g. running unverifiable remote code with broad access).

Your knowledge base (OpenWiki) — maintain it:
- /openwiki holds your durable knowledge: generated wiki pages about the workspace plus your own notes in /openwiki/notes/.
- READ FIRST: before exploring or researching, check /openwiki/index.md and /openwiki/notes/index.md for what you already know. Trust but verify against source files when it matters.
- WRITE BACK: after completing a task that produced durable knowledge (decisions, gotchas, how something works, user preferences), delegate to the "librarian" subagent to record it. Skip this for trivial tasks.
- Your personal memory (~/.deepagents/hermes/memory/) holds durable learnings from past sessions. READ FIRST: call the read_memory tool (no arguments for the index, or a note name) before starting substantial work so past learnings inform this session. Do NOT use read_file on a memory path — your filesystem tools are jailed to the workspace and cannot reach the memory directory. To explicitly record something durable, use the write_memory tool — never write_file with an OS-absolute memory path (your jailed filesystem will silently create a wrong virtual path instead).

How to work:
- For any multi-step task, first plan with write_todos and keep it updated as you progress.
- Delegate aggressively via the task tool: web research to "researcher", implementation to "coder", reviews to "critic". Use "general-purpose" for anything else that benefits from an isolated context.
- Use the filesystem tools to persist intermediate results instead of keeping everything in conversation.
- Paths: filesystem tools use virtual paths rooted at the workspace (e.g. /notes.md). Shell commands via execute run with the workspace as their working directory, so the same file is ./notes.md there. Never use OS-absolute paths.
- Verify results (run code, re-read files) before declaring a task done.
- Finish with a clear summary of what was produced and where it lives.
- Skills: when you have done a non-obvious procedure more than once, propose it as a reusable skill via the write_skill tool. The user will approve it before it is saved.
- Skills: to follow a skill, call the load_skill tool with the skill's name. Do NOT use read_file on a skill path — your filesystem tools are jailed to the workspace and cannot reach the skills directory.`;

/**
 * Approval gate for shell commands (Claude Code-style permission prompt).
 * File tools stay ungated: they are jailed to the workspace by virtualMode,
 * while execute is not — so execute is where consent matters.
 */
const interruptOnShell = {
  execute: {
    allowedDecisions: ["approve", "edit", "reject"] as ("approve" | "edit" | "reject")[],
  },
  write_skill: {
    // no edit: the edit path in reviewActions is execute-specific
    allowedDecisions: ["approve", "reject"] as ("approve" | "edit" | "reject")[],
  },
};

export function buildAgent(cfg: AppConfig) {
  if (!cfg.memfs) {
    fs.mkdirSync(cfg.workspaceDir, { recursive: true });
  }

  const model = new ChatOllama({
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    // Surfaces the model's reasoning as separate thinking tokens
    // (additional_kwargs.reasoning_content on streamed chunks).
    think: cfg.think,
  });

  const backend = cfg.memfs
    ? undefined // deepagents defaults to StateBackend (in-memory virtual FS)
    : new LocalShellBackend({
        rootDir: cfg.workspaceDir,
        virtualMode: true,
        inheritEnv: true,
      });

  // Subagents don't inherit interruptOn from the parent — inject the same
  // gate into each so delegated shell commands also pause for approval.
  const gate = cfg.yolo || cfg.memfs ? undefined : interruptOnShell;
  const gatedSubagents = gate
    ? subagents.map((s) => ({ ...s, interruptOn: gate }))
    : subagents;

  return createDeepAgent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    tools: [webSearch, writeSkill, loadSkill, readMemory, writeMemory],
    subagents: gatedSubagents,
    ...(backend ? { backend } : {}),
    middleware: [todoListMiddleware(), createIdentityMiddleware(cfg.workspaceDir), createSkillsRegistry(), ollamaToolContentShim],
    checkpointer: createCheckpointer(),
    ...(gate ? { interruptOn: gate } : {}),
  });
}

export type DeepAgentInstance = ReturnType<typeof buildAgent>;
