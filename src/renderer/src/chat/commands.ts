import type { NavId } from "../lib/nav";

export interface SlashCommandSpec {
  name: string;
  description: string;
}

/**
 * The design's slash affordances, mapped onto the desktop shell's pages: the
 * Ink-era terminal printed these; the app navigates instead.
 */
export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  { name: "/todos", description: "show the todo list (Chat)" },
  { name: "/threads", description: "browse past threads" },
  { name: "/skills", description: "manage skills" },
  { name: "/memory", description: "inspect and prune memory notes" },
  { name: "/files", description: "browse and edit the agent's workspace" },
  { name: "/settings", description: "providers and security" },
  { name: "/reset", description: "start a new thread" },
  { name: "/help", description: "list the commands" },
];

export type SlashCommand =
  | { kind: "navigate"; nav: NavId }
  | { kind: "newThread" }
  | { kind: "help" }
  | { kind: "unknown"; name: string };

/** Todos are a panel inside the chat view rather than a page of their own. */
const NAV_BY_COMMAND: Readonly<Record<string, NavId>> = {
  "/todos": "chat",
  "/threads": "threads",
  "/skills": "skills",
  "/memory": "memory",
  "/files": "files",
  "/settings": "settings",
};

export const COMMAND_HELP = SLASH_COMMANDS.map((c) => `${c.name} — ${c.description}`).join(" · ");

/** Null when the draft is prose; the composer then sends it to the agent as-is. */
export function parseSlashCommand(draft: string): SlashCommand | null {
  const text = draft.trim();
  if (!text.startsWith("/")) return null;
  const [head] = text.split(/\s+/);
  const name = (head ?? "").toLowerCase();
  const nav = NAV_BY_COMMAND[name];
  if (nav) return { kind: "navigate", nav };
  if (name === "/reset") return { kind: "newThread" };
  if (name === "/help") return { kind: "help" };
  return { kind: "unknown", name };
}
