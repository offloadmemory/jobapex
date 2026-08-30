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
 */
export function sendPrompt(store: ChatStore, threadId: string, text: string): void {
  const prompt = text.trim();
  if (!prompt) return;
  store.addEntry("user", prompt);
  store.setStatus("streaming");
  void hermes.chat.run({ prompt, threadId }).then((r) => {
    if (!r.ok) {
      console.warn("[chat] run failed:", r.error.code, r.error.message);
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
  children,
}: {
  store: ChatStore;
  threadId: string;
  children: ReactNode;
}) {
  const { messages, status } = useChatState(store);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: status === "streaming",
    onNew: async (message) => {
      sendPrompt(store, threadId, textOf(message));
    },
    onCancel: async () => {
      void hermes.chat.cancel(threadId).then((r) => {
        if (!r.ok) console.warn("[chat] cancel failed:", r.error.code, r.error.message);
      });
    },
    convertMessage: toThreadMessage,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}