import { Box, Text } from "ink";
import type { Todo } from "../../stream-events.js";

const ICON: Record<Todo["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

/** The agent's current todo list (plan); hidden when empty. */
export function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>📋 plan</Text>
      {todos.map((t, i) => (
        <Text
          key={i}
          dimColor={t.status === "pending"}
          color={t.status === "completed" ? "green" : t.status === "in_progress" ? "yellow" : undefined}
        >
          {"  "}
          {ICON[t.status]} {t.content}
        </Text>
      ))}
    </Box>
  );
}