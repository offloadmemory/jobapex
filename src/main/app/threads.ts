import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createCheckpointer } from "../agent/persistence.js";
import { contentToString } from "../agent/stream-events.js";
import type { ThreadHistoryMessage, ThreadSummary } from "../../shared/wire.js";
import { getDb } from "./db.js";

const TITLE_MAX = 60;

/** First line of the prompt, shortened for the thread list. */
export function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "Untitled thread";
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
}

/**
 * Record a run against its thread. The title comes from the first prompt and is
 * never overwritten (a resumed thread keeps its original name); updatedAt moves
 * on every run so the list stays ordered by recency.
 */
export function noteThreadRun(threadId: string, prompt: string): void {
  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO threads (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(threadId, titleFromPrompt(prompt), now, now);
  db.prepare(`UPDATE threads SET updatedAt = ? WHERE id = ?`).run(now, threadId);
}

/** Renames a thread in the index; the row moves to the top of the recency list. */
export function renameThread(threadId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("A thread title cannot be blank.");
  const written = getDb()
    .prepare(`UPDATE threads SET title = ?, updatedAt = ? WHERE id = ?`)
    .run(trimmed, Date.now(), threadId);
  if (written.changes === 0) throw new Error(`No thread with id ${threadId}.`);
}

/**
 * Removes a thread outright: the index row here, the LangGraph checkpoints that
 * hold its transcript over there. The checkpoint tables only exist after the
 * saver's setup runs, so a delete that arrives first (a stale index row, a
 * freshly created checkpoints file) must not fail on a missing table.
 */
export async function deleteThread(threadId: string): Promise<void> {
  const saver = getCheckpointer();
  const hasCheckpoints = saver.db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'`)
    .get();
  if (hasCheckpoints) await saver.deleteThread(threadId);
  getDb().prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
}

let checkpointer: SqliteSaver | null = null;

/**
 * One saver per process: it caches prepared statements and the checkpoints file
 * handle, so opening a second one here would duplicate both.
 */
function getCheckpointer(): SqliteSaver {
  if (!checkpointer) checkpointer = createCheckpointer();
  return checkpointer;
}

function toHistory(messages: Array<Record<string, any>>): ThreadHistoryMessage[] {
  const out: ThreadHistoryMessage[] = [];
  for (const msg of messages) {
    const content = contentToString(msg.content);
    if (!content) continue; // tool-call-only AI turns carry no transcript text
    const type = msg.getType?.() ?? msg.type;
    if (type === "human" || type === "user") out.push({ role: "user", content });
    else if (type === "ai") out.push({ role: "assistant", content });
    else if (type === "tool") out.push({ role: "tool", content });
    else if (type === "system") out.push({ role: "system", content });
  }
  return out;
}

async function messagesFor(threadId: string): Promise<ThreadHistoryMessage[]> {
  const tuple = await getCheckpointer().getTuple({ configurable: { thread_id: threadId } });
  const values = tuple?.checkpoint?.channel_values as Record<string, unknown> | undefined;
  return toHistory((values?.messages ?? []) as Array<Record<string, any>>);
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const rows = getDb()
    .prepare(`SELECT id, title, updatedAt FROM threads ORDER BY updatedAt DESC`)
    .all() as Array<{ id: string; title: string; updatedAt: number }>;
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      messageCount: (await messagesFor(row.id)).length,
    }))
  );
}

export async function threadHistory(threadId: string): Promise<ThreadHistoryMessage[]> {
  return messagesFor(threadId);
}
