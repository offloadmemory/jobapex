import { useState } from "react";
import { Brain, History, MessageSquare, Settings, Sparkles } from "lucide-react";

import { ChatView } from "./chat/ChatView";
import { TooltipProvider } from "./components/ui/tooltip";
import { cn } from "./lib/utils";

const NAV: ReadonlyArray<{
  id: string;
  label: string;
  icon: typeof MessageSquare;
  disabled?: boolean;
}> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "threads", label: "Threads", icon: History, disabled: true },
  { id: "skills", label: "Skills", icon: Sparkles, disabled: true },
  { id: "memory", label: "Memory", icon: Brain, disabled: true },
  { id: "settings", label: "Settings", icon: Settings, disabled: true },
];

export function App() {
  const [active, setActive] = useState<string>("chat");
  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/40 px-3 py-4">
        <div className="flex items-center gap-2 px-2 pb-4 pt-1">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">
            ✻
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">hermes</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              local agent
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                disabled={item.disabled}
                title={item.disabled ? `Coming soon` : undefined}
                onClick={() => setActive(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
                  active === item.id
                    ? "bg-primary text-primary-foreground"
                    : item.disabled
                      ? "cursor-default text-muted-foreground/50"
                      : "text-foreground hover:bg-muted"
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.disabled && (
                  <span className="rounded-full border border-border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-muted-foreground/50">
          Runs locally · Ollama
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <TooltipProvider delayDuration={200}>{active === "chat" ? <ChatView /> : null}</TooltipProvider>
      </main>
    </div>
  );
}