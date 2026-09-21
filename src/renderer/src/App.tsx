import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Brain, FileText, History, Lock, MessageSquare, Settings, Sparkles } from "lucide-react";

import type { AppInfo, AppSettings } from "@shared/wire";
import { ChatView } from "./chat/ChatView";
import { COMMAND_HELP, parseSlashCommand } from "./chat/commands";
import { TooltipProvider } from "./components/ui/tooltip";
import { FilesView } from "./files/FilesView";
import { ChatStore } from "./lib/chat-store";
import { hermes } from "./lib/ipc";
import { reportError } from "./lib/log";
import type { NavId } from "./lib/nav";
import { cn } from "./lib/utils";
import { MemoryView } from "./memory/MemoryView";
import { SettingsView } from "./settings/SettingsView";
import { LockScreen } from "./setup/LockScreen";
import { SetupWizard } from "./setup/SetupWizard";
import { SkillsView } from "./skills/SkillsView";
import { applyTheme } from "./theme";
import { ThreadsView } from "./threads/ThreadsView";

const NAV: ReadonlyArray<{ id: NavId; label: string; icon: typeof MessageSquare }> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "threads", label: "Threads", icon: History },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "files", label: "Files", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

/** ⌘1…⌘6 pick a page in NAV order; ⌘N and ⌘, mirror the Session menu. */
const NAV_ACCELERATORS = ["1", "2", "3", "4", "5", "6"] as const;

/** What the shell shows before/around the nav: first-run, PIN gate, or the app. */
type Gate = "loading" | "setup" | "locked" | "ready";

const IDLE_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

function navForCommand(command: string): NavId | null {
  return NAV.some((item) => item.id === command) ? (command as NavId) : null;
}

/** The sidebar line is only allowed to claim "local" when it is actually local. */
function providerSubtitle(info: AppInfo | null): string {
  if (!info || !info.providerType) return "config defaults";
  return info.providerType === "ollama" ? "local models" : "cloud models";
}

function footerLabel(info: AppInfo | null): string {
  if (!info || !info.providerType) return "Local defaults";
  return info.providerType === "ollama" ? "Runs locally" : "Runs on a hosted model";
}

export function App() {
  const [store] = useState(() => new ChatStore());
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [active, setActive] = useState<NavId>("chat");
  const [gate, setGate] = useState<Gate>("loading");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  // One global event channel: keeping the subscription here means a run keeps
  // streaming into the transcript while another view is on screen.
  useEffect(() => hermes.onEvent((ev) => store.consume(ev)), [store]);

  const startNewThread = useCallback(() => {
    // Kill the orphan run BEFORE resetting: onEvent has a single global channel
    // and no thread identity, so a still-streaming run would repopulate the
    // fresh store. The cancelled run's terminal done event is a no-op on the
    // idle store (see ChatStore.consume).
    void hermes.chat.cancel(threadId).then((r) => {
      if (!r.ok) reportError("app.cancel", r.error.message);
    });
    store.reset();
    setThreadId(crypto.randomUUID());
  }, [store, threadId]);

  // The application menu ("Lock Now", ⌘L, navigation items) acts in the main
  // process; mirror it here or the window would keep rendering an unlocked UI
  // behind the lock.
  useEffect(
    () =>
      hermes.onAppEvent((ev) => {
        if (ev.type === "locked") {
          setGate("locked");
          return;
        }
        if (ev.command === "new-thread") {
          startNewThread();
          setActive("chat");
          return;
        }
        const nav = navForCommand(ev.command);
        if (nav) setActive(nav);
      }),
    [startNewThread]
  );

  // Shell-level accelerators. The menu already carries these, but the menu
  // binding only fires while no menu-less window owns focus (Windows/Linux
  // hidden menu), so the renderer keeps the same map.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.shiftKey) return;
      const index = NAV_ACCELERATORS.indexOf(event.key as (typeof NAV_ACCELERATORS)[number]);
      if (index >= 0) {
        event.preventDefault();
        const item = NAV[index];
        if (item) setActive(item.id);
        return;
      }
      if (event.key === "n") {
        event.preventDefault();
        startNewThread();
        setActive("chat");
      } else if (event.key === ",") {
        event.preventDefault();
        setActive("settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startNewThread]);

  const refreshSettings = useCallback(async () => {
    const result = await hermes.app.getSettings();
    if (result.ok) setSettings(result.data);
    else reportError("app.getSettings", result.error.message);
    return result;
  }, []);

  const refreshInfo = useCallback(async () => {
    const result = await hermes.app.getInfo();
    if (result.ok) setInfo(result.data);
    else reportError("app.getInfo", result.error.message);
    return result;
  }, []);

  useEffect(() => {
    void (async () => {
      const [locked, loaded] = await Promise.all([hermes.app.isLocked(), hermes.app.getSettings()]);
      if (loaded.ok) setSettings(loaded.data);
      else reportError("app.getSettings", loaded.error.message);
      if (locked.ok && locked.data) {
        setGate("locked");
        return;
      }
      // A failed settings read must not trap the user in the wizard; Settings
      // is where the failure becomes visible and fixable.
      setGate(loaded.ok && !loaded.data.setupComplete ? "setup" : "ready");
      void refreshInfo();
    })();
  }, [refreshInfo]);

  useEffect(() => {
    if (settings) applyTheme(settings.theme, settings.accent);
  }, [settings]);

  useEffect(() => {
    if (settings) document.title = `${settings.assistantName} — desktop`;
  }, [settings]);

  const idleMinutes = settings?.idleLockMinutes ?? 0;

  /** Idle lock: the renderer asks main to lock, and main keeps the authoritative state. */
  useEffect(() => {
    if (gate !== "ready" || idleMinutes <= 0) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void hermes.app.lock().then((r) => {
          if (!r.ok) reportError("app.lock", r.error.message);
          setGate("locked");
        });
      }, idleMinutes * 60_000);
    };
    for (const event of IDLE_EVENTS) window.addEventListener(event, arm);
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const event of IDLE_EVENTS) window.removeEventListener(event, arm);
    };
  }, [gate, idleMinutes]);

  /**
   * Composer slash commands are shell actions, never prompts: navigation and
   * the new-thread reset happen here, and the draft is swallowed so the agent
   * never sees it. Answering ones (help/unknown) report back as transcript
   * system rows instead of opening a run.
   */
  const runCommand = useCallback(
    (draft: string): boolean => {
      const command = parseSlashCommand(draft);
      if (!command) return false;
      switch (command.kind) {
        case "navigate":
          setActive(command.nav);
          break;
        case "newThread":
          startNewThread();
          break;
        case "help":
          store.addEntry("system", `Commands: ${COMMAND_HELP}`);
          break;
        case "unknown":
          store.addEntry("system", `Unknown command ${command.name}. Commands: ${COMMAND_HELP}`);
          break;
      }
      return true;
    },
    [store, startNewThread]
  );

  const openThread = useCallback(
    async (id: string) => {
      void hermes.chat.cancel(threadId).then((r) => {
        if (!r.ok) reportError("app.cancel", r.error.message);
      });
      const result = await hermes.threads.history(id);
      setThreadId(id);
      setActive("chat");
      if (result.ok) {
        store.loadHistory(result.data);
        return;
      }
      // Surface the failure in the transcript rather than a dead click.
      store.reset();
      store.addEntry("error", `Couldn't load that thread: ${result.error.message}`);
    },
    [store, threadId]
  );

  if (gate === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Starting hermes…
      </div>
    );
  }

  if (gate === "locked") {
    return (
      <LockScreen
        assistantName={settings?.assistantName ?? "hermes"}
        onUnlocked={() => setGate("ready")}
      />
    );
  }

  if (gate === "setup") {
    return (
      <SetupWizard
        onDone={() => {
          void refreshSettings();
          void refreshInfo();
          setGate("ready");
        }}
      />
    );
  }

  const views: Record<NavId, ReactNode> = {
    chat: (
      <ChatView
        store={store}
        threadId={threadId}
        onNewThread={startNewThread}
        onOpenSettings={() => setActive("settings")}
        onCommand={runCommand}
      />
    ),
    threads: (
      <ThreadsView
        activeThreadId={threadId}
        onOpenThread={(id) => void openThread(id)}
        onThreadRemoved={(id) => {
          if (id === threadId) startNewThread();
        }}
      />
    ),
    skills: <SkillsView />,
    memory: <MemoryView />,
    files: <FilesView />,
    settings: (
      <SettingsView
        onChanged={() => {
          void refreshSettings();
          void refreshInfo();
        }}
        onSetupRequested={() => setGate("setup")}
      />
    ),
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/40 px-3 py-4">
        <div className="flex items-center gap-2 px-2 pb-4 pt-1">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">
            ✻
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              {settings?.assistantName ?? "hermes"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              {providerSubtitle(info)}
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                title={`${item.label} (⌘${NAV_ACCELERATORS[index]})`}
                onClick={() => setActive(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
                  active === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="flex-1">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-2 text-[11px] text-muted-foreground/50">
          <span title={info ? `${info.model} @ ${info.baseUrl}` : undefined}>
            {footerLabel(info)}
          </span>
          {settings?.pinConfigured && (
            <button
              type="button"
              title="Lock now"
              aria-label="Lock now"
              onClick={() => {
                void hermes.app.lock().then((r) => {
                  if (!r.ok) reportError("app.lock", r.error.message);
                  setGate("locked");
                });
              }}
              className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Lock className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <TooltipProvider delayDuration={200}>{views[active]}</TooltipProvider>
      </main>
    </div>
  );
}
