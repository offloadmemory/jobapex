import { useState } from "react";
import { ChatView } from "./chat/ChatView";
import { TooltipProvider } from "./components/ui/tooltip";

const NAV: ReadonlyArray<{ id: string; label: string; disabled?: boolean }> = [
  { id: "chat", label: "Chat" },
  { id: "threads", label: "Threads", disabled: true },
  { id: "skills", label: "Skills", disabled: true },
  { id: "memory", label: "Memory", disabled: true },
  { id: "settings", label: "Settings", disabled: true },
];

export function App() {
  const [active, setActive] = useState<string>("chat");
  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r bg-muted/30 p-3 flex flex-col gap-1">
        <div className="px-2 py-3 text-sm font-semibold">✻ hermes</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => setActive(item.id)}
            className={`rounded-md px-3 py-2 text-left text-sm ${
              active === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            } ${item.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {item.label}
          </button>
        ))}
      </aside>
      <main className="flex-1 min-w-0">
        <TooltipProvider delayDuration={200}>{active === "chat" ? <ChatView /> : null}</TooltipProvider>
      </main>
    </div>
  );
}