import { useEffect, useState, useSyncExternalStore } from "react";
import { Plus } from "lucide-react";

import { ChatStore } from "../lib/chat-store";
import { hermes } from "../lib/ipc";
import { sendPrompt, ChatRuntimeProvider } from "./runtime";
import { TodoPanel } from "./TodoPanel";
import { ApprovalCard } from "./ApprovalCard";
import { Thread } from "../components/assistant-ui/thread";

interface AppInfoLite {
  model: string;
  baseUrl: string;
}

const EMPTY_SUGGESTIONS = [
  "Introduce yourself",
  "What tools do you have?",
  "Plan a task for me",
];

/**
 * Subscribe to the store's version-integer snapshot before reading field
 * values, so every store emit re-renders with fresh data (no memoized reads
 * over mutable fields).
 */
function useChatSnapshot(store: ChatStore) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    todos: store.todos,
    approval: store.approval,
  };
}

export function ChatView() {
  const [store] = useState(() => new ChatStore());
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [info, setInfo] = useState<AppInfoLite | null>(null);
  const { todos } = useChatSnapshot(store);

  useEffect(() => {
    void hermes.app.getInfo().then((r) => {
      if (r.ok) setInfo({ model: r.data.model, baseUrl: r.data.baseUrl });
      else console.warn("[chat] app.getInfo failed:", r.error.code, r.error.message);
    });
    return hermes.onEvent((ev) => store.consume(ev));
  }, [store]);

  return (
    <ChatRuntimeProvider store={store} threadId={threadId}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          {info ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium text-foreground">
                <span
                  className="size-1.5 rounded-full bg-emerald-500"
                  aria-label="connected"
                />
                {info.model}
              </span>
              <span className="text-muted-foreground/60">via {info.baseUrl}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/60">connecting…</span>
          )}
          <button
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              // Kill the orphan run BEFORE resetting: onEvent has a single
              // global channel and no thread identity, so a still-streaming
              // run would repopulate the fresh store. Then reset, then mint a
              // new threadId. The cancelled run's terminal done event is a
              // no-op on the idle store (see ChatStore.consume).
              void hermes.chat.cancel(threadId).then((r) => {
                if (!r.ok) console.warn("[chat] cancel failed:", r.error.code, r.error.message);
              });
              store.reset();
              setThreadId(crypto.randomUUID());
            }}
          >
            <Plus className="size-3.5" />
            New thread
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Thread
            footerExtra={<TodoPanel todos={todos} />}
            suggestions={EMPTY_SUGGESTIONS}
            onSuggestion={(text) => sendPrompt(store, threadId, text)}
          />
        </div>
        <ApprovalCard store={store} />
      </div>
    </ChatRuntimeProvider>
  );
}