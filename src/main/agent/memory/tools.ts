import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import * as z from "zod";
import { memoryDir } from "../paths.js";
import { listNotes, readNote, slugify, writeNote } from "./store.js";

/**
 * Read your personal memory. Mirrors loadSkill: reads via node:fs directly,
 * because the agent's filesystem tools are jailed to the workspace and cannot
 * reach the memory directory at its OS-absolute path.
 */
export const readMemory = tool(
  async ({ name }: { name?: string }) => {
    if (name) {
      const note = readNote(name);
      return (
        note ??
        `No memory note named "${name}". Call read_memory with no arguments to see the index of available notes.`
      );
    }
    // No name: return the index plus note titles.
    const notes = listNotes();
    if (!notes.length) return "Your memory is empty — no notes have been recorded yet.";
    let index = "";
    try {
      index = fs.readFileSync(path.join(memoryDir(), "index.md"), "utf8");
    } catch {
      /* no index yet */
    }
    return [index, "---", ...notes.map((n) => `[${n.slug}] ${n.title}`)].filter(Boolean).join("\n");
  },
  {
    name: "read_memory",
    description:
      "Read your personal memory (~/.deepagents/hermes/memory/): durable learnings recorded from past sessions. " +
      "Call with no arguments for the index of notes, or with a note name to read one note. " +
      "Call this before starting substantial work.",
    schema: z.object({
      name: z
        .string()
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        .optional()
        .describe("optional kebab-case note name; omit to get the index"),
    }),
  }
);

/**
 * Record a durable learning into your personal memory. Mirrors readMemory:
 * writes via node:fs directly, because the agent's filesystem tools are jailed
 * to the workspace and an OS-absolute memory path would be silently redirected
 * to a wrong virtual path that never reaches the real store.
 */
export const writeMemory = tool(
  async ({ title, content }: { title: string; content: string }) => {
    const slug = slugify(title);
    if (!slug) return "Could not derive a note name from that title (need letters/numbers). Try a more descriptive title.";
    writeNote({ slug, title, content });
    return `Remembered: "${title}" (note: ${slug}). It will be available via read_memory in future sessions.`;
  },
  {
    name: "write_memory",
    description:
      "Record a durable learning for future sessions (a note in your personal memory). Use for user facts, preferences, and hard-won gotchas that should outlive this conversation. NOT for trivial or session-specific details.",
    schema: z.object({
      title: z.string().describe("short note title; becomes the kebab-case note name"),
      content: z.string().describe("the note body (what to remember and why it matters)"),
    }),
  }
);
