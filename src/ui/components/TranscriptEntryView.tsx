import { Text } from "ink";
import { truncate } from "../../stream-events.js";
import type { TranscriptEntry } from "../store.js";

/** One completed transcript line, styled by kind — mirrors render.ts. */
export function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  const indent = "  ".repeat(Math.min(entry.depth, 2));
  switch (entry.kind) {
    case "user":
      return (
        <Text bold color="green">
          ❯ {entry.text}
        </Text>
      );
    case "assistant":
      return <Text>{indent}{entry.text}</Text>;
    case "thinking":
      return <Text dimColor>{indent}🧠 {entry.text}</Text>;
    case "tool": {
      const split = entry.text.indexOf(" ");
      const name = split === -1 ? entry.text : entry.text.slice(0, split);
      const args = split === -1 ? "" : entry.text.slice(split + 1);
      return (
        <Text>
          {indent}
          <Text color="cyan">🔧 {name}</Text>
          <Text dimColor> {truncate(args, 160)}</Text>
        </Text>
      );
    }
    case "toolResult":
      return (
        <Text dimColor={!entry.isError} color={entry.isError ? "red" : undefined}>
          {indent}
          {entry.isError ? "✗ " : "↳ "}
          {truncate(entry.text, 240)}
        </Text>
      );
    case "delegate":
      return (
        <Text bold color="magenta">
          {indent}🤖 {truncate(entry.text, 160)}
        </Text>
      );
    case "system":
      return <Text dimColor>{entry.text}</Text>;
    case "error":
      return (
        <Text color="red">
          ✗ {entry.text}
        </Text>
      );
  }
}