import { Box, Text, useInput } from "ink";
import { useState } from "react";

const CURSOR = "▊";

interface InputBoxProps {
  /** Inactive while a task streams or the approval card is open. */
  disabled: boolean;
  /** Past prompts, most recent last; up-arrow recalls them. */
  history: string[];
  onSubmit(prompt: string): void;
}

/** The prompt line — bordered, with history navigation (up = older,
 * down = newer, leaving the end restores the in-progress draft). */
export function InputBox({ disabled, history, onSubmit }: InputBoxProps) {
  const [draft, setDraft] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const value = historyIndex === null ? draft : history[historyIndex] ?? "";

  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      setDraft("");
      setHistoryIndex(null);
      return;
    }
    if (key.upArrow) {
      if (history.length === 0) return;
      setHistoryIndex((idx) => (idx === null ? history.length - 1 : Math.max(0, idx - 1)));
      return;
    }
    if (key.downArrow) {
      setHistoryIndex((idx) => (idx === null ? null : idx + 1 >= history.length ? null : idx + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (historyIndex !== null) {
        // Editing a recalled entry: materialize it as the draft first.
        const recalled = history[historyIndex] ?? "";
        setHistoryIndex(null);
        setDraft(recalled.slice(0, -1));
      } else {
        setDraft((d) => d.slice(0, -1));
      }
      return;
    }
    if (!input || key.ctrl || key.meta || key.escape) return;
    if (historyIndex !== null) {
      const recalled = history[historyIndex] ?? "";
      setHistoryIndex(null);
      setDraft(recalled + input);
    } else {
      setDraft((d) => d + input);
    }
  });

  return (
    <Box borderStyle="round" borderColor={disabled ? "gray" : "green"} paddingX={1}>
      <Text bold color={disabled ? "gray" : "green"}>
        ❯{" "}
      </Text>
      <Text dimColor={!value && !disabled}>
        {value || (disabled ? "" : "ask hermes anything — /help for commands")}
      </Text>
      <Text dimColor>{disabled ? "" : CURSOR}</Text>
    </Box>
  );
}