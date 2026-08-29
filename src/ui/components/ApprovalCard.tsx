import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { Decision } from "langchain";
import type { ApprovalState } from "../store.js";

type Mode = "choose" | "reject" | "edit";

const DEFAULT_REJECT = "The user declined this command.";

/** Claude Code-style permission card: one actionRequest at a time.
 * `y` approves only the current action, `a` approves all remaining ones,
 * `n` opens the reject flow with an optional reason, `e` (execute only)
 * edits the command inline. When every actionRequest has a decision,
 * resolves the gate once. */
export function ApprovalCard({ approval }: { approval: ApprovalState | null }) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [mode, setMode] = useState<Mode>("choose");
  const [input, setInput] = useState("");

  // A new interrupt brings a fresh card.
  useEffect(() => {
    setIndex(0);
    setDecisions([]);
    setMode("choose");
    setInput("");
  }, [approval]);

  const actions = approval?.request.actionRequests ?? [];
  const action = actions[index];

  useInput((ch, key) => {
    if (!approval || !action) return;
    if (mode === "choose") {
      if (ch === "y" || (ch === "a" && actions.length - index > 1)) {
        const all = [
          ...decisions,
          ...(ch === "y"
            ? [{ type: "approve" } as Decision]
            : actions.slice(index).map(() => ({ type: "approve" }) as Decision)),
        ];
        if (all.length >= actions.length) {
          approval.resolve({ decisions: all });
        } else {
          setDecisions(all);
          setIndex(index + 1);
          setMode("choose");
          setInput("");
        }
      } else if (ch === "n") {
        setMode("reject");
        setInput("");
      } else if (ch === "e" && action.name === "execute") {
        setMode("edit");
        setInput(String(action.args.command ?? ""));
      }
      return;
    }
    if (key.return) {
      const decision: Decision =
        mode === "edit"
          ? { type: "edit", editedAction: { name: action.name, args: { ...action.args, command: input } } }
          : { type: "reject", message: input.trim() || DEFAULT_REJECT };
      const all = [...decisions, decision];
      if (all.length >= actions.length) {
        approval.resolve({ decisions: all });
      } else {
        setDecisions(all);
        setIndex(index + 1);
        setMode("choose");
        setInput("");
      }
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (!ch || key.ctrl || key.meta || key.escape) return;
    setInput((v) => v + ch);
  });

  if (!approval || !action) return null;
  // [e]dit rewrites args.command, so it only makes sense for execute.
  const canEdit = action.name === "execute";
  const detail =
    action.name === "execute" ? String(action.args.command ?? "") : JSON.stringify(action.args);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text bold color="yellow">
        ⚠ approval needed — agent wants to run:
      </Text>
      <Text>
        {"  "}● <Text bold>{action.name}</Text> <Text dimColor>{detail}</Text>
      </Text>
      {mode === "choose" ? (
        <Text dimColor>
          [y] allow · [n] reject{canEdit ? " · [e] edit command" : ""}
          {actions.length - index > 1
            ? ` · [a] allow all remaining (${actions.length - index} commands)`
            : ""}{" "}
          ({index + 1}/{actions.length})
        </Text>
      ) : (
        <Text dimColor>
          {mode === "edit" ? "new command ▸ " : "tell the agent why (optional) ▸ "}
          <Text>{input}</Text>
          <Text>▊</Text>
        </Text>
      )}
    </Box>
  );
}