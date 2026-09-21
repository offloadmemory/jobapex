import { useSyncExternalStore } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import { ChatStore, type TranscriptEntry } from "../lib/chat-store";
import { toThreadMessage } from "../lib/to-thread-message";
import { hermes } from "../lib/ipc";
import { reportError } from "../lib/log";

/**
 * Bridges the imperative ChatStore into an assistant-ui external-store
 * runtime, and drives runs through the typed IPC bridge.
 */

function textOf(message: ThreadMessageLike): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

/**
 * Shared run invocation for the composer and the empty-state suggestion chips.
 * A rejected envelope (BUSY, BAD_REQUEST, …) means the main process never
 * started a run, so no terminal done event will arrive — unwind here or the
 * transcript strands at "streaming".
 *
 * `echo` defaults to true; Retry passes false because the prompt it re-sends is
 * already in the transcript and a second user turn would be a duplicate.
 */
export function sendPrompt(
  store: ChatStore,
  threadId: string,
  text: string,
  opts?: { echo?: boolean }
): void {
  const prompt = text.trim();
  if (!prompt) return;
  if (opts?.echo !== false) store.addEntry("user", prompt);
  store.setStatus("streaming");
  void hermes.chat.run({ prompt, threadId }).then((r) => {
    if (!r.ok) {
      reportError("chat.run", `${r.error.code}: ${r.error.message}`);
      store.setStatus("idle");
      store.addEntry("error", r.error.message);
    }
  });
}

/**
 * Subscribe to the store's version-integer snapshot before reading its fields,
 * so every emitted change re-renders with fresh field values.
 */
function useChatState(store: ChatStore) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const live = store.live;
  const liveEntry: TranscriptEntry | null = live
    ? {
        id: -1,
        kind: "assistant",
        text: live.text,
        depth: live.depth,
        ...(live.thinking.trim() ? { thinking: live.thinking.trim() } : {}),
      }
    : null;
  return {
    messages: liveEntry ? [...store.entries, liveEntry] : store.entries,
    status: store.status,
  };
}

export function ChatRuntimeProvider({
  store,
  threadId,
  onCommand,
  stagedPaths,
  onStagedConsumed,
  children,
}: {
  store: ChatStore;
  threadId: string;
  /** True when the draft was a slash command, i.e. handled and not to be sent. */
  onCommand: (draft: string) => boolean;
  /** Workspace-relative paths of files staged for the next prompt. */
  stagedPaths: string[];
  /** Clears the staging tray once the paths have been folded into a prompt. */
  onStagedConsumed: () => void;
  children: ReactNode;
}) {
  const { messages, status } = useChatState(store);

  const runtime = useExternalStoreRuntime({
    messages,
    // The approval gate is a live run too: the Stop affordance must stay
    // available while the agent waits for the user to answer, not only while
    // tokens are streaming.
    isRunning: status !== "idle",
    onNew: async (message) => {
      const text = textOf(message);
      // Slash commands act on the shell (navigation, thread lifecycle) and must
      // never reach the agent.
      if (onCommand(text)) return;
      // Staged attachments ride inside the prompt: agent tools take paths, and a
      // plain-text channel keeps the wire contract unchanged.
      const attachments = stagedPaths.map((path) => `Attached file: ${path}`);
      if (attachments.length > 0) onStagedConsumed();
      sendPrompt(store, threadId, [text, ...attachments].join("\n\n"));
    },
    onCancel: async () => {
      void hermes.chat.cancel(threadId).then((r) => {
        if (!r.ok) reportError("chat.cancel", `${r.error.code}: ${r.error.message}`);
      });
    },
    convertMessage: toThreadMessage,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}