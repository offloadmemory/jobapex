import { Box, Static, Text, useInput } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { UIStore } from "./store.js";
import { ApprovalCard } from "./components/ApprovalCard.js";
import { Header, type HeaderProps } from "./components/Header.js";
import { InputBox } from "./components/InputBox.js";
import { LiveStream } from "./components/LiveStream.js";
import { TodoPanel } from "./components/TodoPanel.js";
import { TranscriptEntryView } from "./components/TranscriptEntryView.js";

export interface AppProps extends HeaderProps {
  store: UIStore;
  /** Every submitted line — the entry file splits slash commands from tasks. */
  onSubmit(prompt: string): void;
  /** Ctrl+C/Esc while a task is running. */
  onCancel(): void;
  /** /exit or idle Ctrl+C. */
  onExit(): void;
  history: string[];
}

export function App({ store, onSubmit, onCancel, onExit, history, ...header }: AppProps) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Double-Ctrl+C to exit (Claude Code-style): the first press only arms a
  // short window with an inline hint — a stray Ctrl+C must not kill the REPL.
  // The armed flag is a ref so any keypress can disarm without re-render churn.
  const [exitHint, setExitHint] = useState(false);
  const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = (): void => {
    armed.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setExitHint(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  useInput((input, key) => {
    // While a task runs (streaming or waiting on approval), Ctrl+C and Esc
    // cancel it; only from idle does Ctrl+C quit the app.
    if (store.status !== "idle") {
      if (armed.current) disarm(); // don't leave a stale exit hint mid-stream
      if ((key.ctrl && input === "c") || key.escape) onCancel();
      return;
    }
    if (key.ctrl && input === "c") {
      if (armed.current) {
        disarm();
        onExit();
        return;
      }
      armed.current = true;
      setExitHint(true);
      timer.current = setTimeout(disarm, 2000);
      return;
    }
    if (armed.current) disarm();
  });

  return (
    <Box flexDirection="column">
      <Static items={store.entries}>
        {(entry) => <TranscriptEntryView key={entry.id} entry={entry} />}
      </Static>
      <Header {...header} />
      <TodoPanel todos={store.todos} />
      <LiveStream live={store.live} streaming={store.status === "streaming"} />
      <ApprovalCard approval={store.approval} />
      <InputBox disabled={store.status !== "idle"} history={history} onSubmit={onSubmit} />
      {exitHint ? <Text dimColor>press ctrl+c again to exit</Text> : null}
    </Box>
  );
}

