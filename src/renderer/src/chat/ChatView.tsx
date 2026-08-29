import { useEffect, useState, useSyncExternalStore } from "react";
import { ChatStore } from "../lib/chat-store";
import { hermes } from "../lib/ipc";
import { ChatRuntimeProvider } from "./runtime";
import { TodoPanel } from "./TodoPanel";
import { ApprovalCard } from "./ApprovalCard";
import { Thread } from "../components/assistant-ui/thread";

interface AppInfoLite {
  model: string;
  baseUrl: string;
}

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
        <header className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
          <span>{info ? `${info.model} (via ${info.baseUrl})` : "loading…"}</span>
          <button
            className="rounded-md px-2 py-1 hover:bg-muted"
            onClick={() => {
              setThreadId(crypto.randomUUID());
              store.reset();
            }}
          >
            New thread
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Thread />
        </div>
        <div className="border-t p-3">
          <TodoPanel todos={todos} />
        </div>
        <ApprovalCard store={store} />
      </div>
    </ChatRuntimeProvider>
  );
}