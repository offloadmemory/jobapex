import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import type { HITLDecisionWire } from "@shared/wire";
import type { ChatStore } from "../lib/chat-store";
import { hermes } from "../lib/ipc";

type Mode = "choose" | "reject" | "edit";
const DEFAULT_REJECT = "The user declined this command.";

export function ApprovalCard({ store }: { store: ChatStore }) {
  const approval = store.approval;
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<HITLDecisionWire[]>([]);
  const [mode, setMode] = useState<Mode>("choose");
  const [input, setInput] = useState("");

  useEffect(() => {
    setIndex(0);
    setDecisions([]);
    setMode("choose");
    setInput("");
  }, [approval]);

  const actions = approval?.request.actionRequests ?? [];
  const action = actions[index];

  const resolve = (all: HITLDecisionWire[]) => {
    if (!approval) return;
    void hermes.chat.resolveApproval(approval.runId, { decisions: all });
    store.clearApproval();
    store.setStatus("streaming");
  };

  const approve = () => {
    const all = [...decisions, { type: "approve" } as HITLDecisionWire];
    if (all.length >= actions.length) resolve(all);
    else {
      setDecisions(all);
      setIndex(index + 1);
      setMode("choose");
      setInput("");
    }
  };

  const approveAll = () => {
    const all = [...decisions, ...actions.slice(index).map(() => ({ type: "approve" } as HITLDecisionWire))];
    resolve(all);
  };

  const submitRejectOrEdit = () => {
    // In edit mode an empty submit falls back to the original command rather
    // than sending an empty `command: ""` to the shell. (Reject mode's own
    // empty-string case is already handled: it falls back to DEFAULT_REJECT.)
    const editedCommand =
      mode === "edit" && input.trim() === "" ? String(action.args.command ?? "") : input;
    const decision: HITLDecisionWire =
      mode === "edit"
        ? { type: "edit", editedAction: { name: action.name, args: { ...action.args, command: editedCommand } } }
        : { type: "reject", message: input.trim() || DEFAULT_REJECT };
    const all = [...decisions, decision];
    if (all.length >= actions.length) resolve(all);
    else {
      setDecisions(all);
      setIndex(index + 1);
      setMode("choose");
      setInput("");
    }
  };

  if (!approval || !action) return null;
  const canEdit = action.name === "execute";
  const detail =
    action.name === "execute" ? String(action.args.command ?? "") : JSON.stringify(action.args);

  return (
    // Non-modal: while status is "approval" isRunning is false, so the Stop
    // button is dead and this dialog is the only thing on screen. Keeping it
    // non-modal leaves the header's "New thread" (cancel + reset) clickable so
    // a hung gate can always be escaped.
    <Dialog open modal={false} onOpenChange={() => {}}>
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>⚠ approval needed — agent wants to run</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{action.name}</span>{" "}
            <span className="font-mono text-xs">{detail}</span>
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" ? (
          <DialogFooter className="gap-2">
            {actions.length - index > 1 && (
              <Button variant="outline" onClick={approveAll}>
                Allow all remaining ({actions.length - index})
              </Button>
            )}
            <Button variant="outline" onClick={() => { setMode("reject"); setInput(""); }}>
              Reject
            </Button>
            {canEdit && (
              <Button variant="outline" onClick={() => { setMode("edit"); setInput(String(action.args.command ?? "")); }}>
                Edit command
              </Button>
            )}
            <Button onClick={approve}>Approve</Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="flex-col items-stretch gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "edit" ? "new command" : "tell the agent why (optional)"}
              onKeyDown={(e) => e.key === "Enter" && submitRejectOrEdit()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setMode("choose"); setInput(""); }}>
                Back
              </Button>
              <Button onClick={submitRejectOrEdit}>{mode === "edit" ? "Run edited" : "Reject"}</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}