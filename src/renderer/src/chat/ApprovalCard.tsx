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
import { reportError } from "../lib/log";

type Mode = "choose" | "reject" | "edit";
const DEFAULT_REJECT = "The user declined this command.";

export function ApprovalCard({ store, threadId }: { store: ChatStore; threadId: string }) {
  const approval = store.approval;
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<HITLDecisionWire[]>([]);
  const [mode, setMode] = useState<Mode>("choose");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIndex(0);
    setDecisions([]);
    setMode("choose");
    setInput("");
    setError(null);
  }, [approval]);

  const actions = approval?.request.actionRequests ?? [];
  const action = actions[index];

  const resolve = (all: HITLDecisionWire[]) => {
    if (!approval) return;
    setError(null);
    void hermes.chat.resolveApproval(approval.runId, { decisions: all }).then(
      (result) => {
        if (result.ok) {
          store.clearApproval();
          store.setStatus("streaming");
          return;
        }
        if (result.error.code === "NOT_FOUND") {
          // The run ended (cancel, model error, …) between the gate firing and
          // this answer, so nothing is waiting for the decision. Retire the
          // card with a note instead of letting a dead gate vanish silently.
          store.clearApproval();
          store.setStatus("idle");
          store.addEntry("system", "That approval is no longer active — the run already ended.");
          return;
        }
        // Transient failures (BUSY, BAD_REQUEST, …) must keep the card up:
        // silently dropping the decisions gathered so far would strand the run.
        setError(result.error.message);
        reportError("approval.resolve", result.error.message);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        reportError("approval.resolve", err);
      }
    );
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

  const stopRun = () => {
    // Stop is the escape hatch for a gate that should never have fired (or a
    // hung run): main rejects the pending actions itself and aborts, so the
    // card is torn down by the run's terminal "done" event, not here.
    void hermes.chat.cancel(threadId).then(
      (result) => {
        if (!result.ok) reportError("approval.cancel", result.error.message);
      },
      (err: unknown) => reportError("approval.cancel", err)
    );
  };

  // Esc = reject-all: one key must get the user out of a gate without
  // approving anything, exactly like pressing Reject on every remaining
  // action, so the run unwinds through the normal reject path.
  useEffect(() => {
    if (!approval) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      resolve([
        ...decisions,
        ...approval.request.actionRequests
          .slice(index)
          .map(() => ({ type: "reject", message: DEFAULT_REJECT }) as HITLDecisionWire),
      ]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Re-subscribes as decisions accumulate so Esc rejects exactly the actions
    // still unanswered.
  }, [approval, decisions, index]);

  if (!approval || !action) return null;
  // The gate's own list is authoritative: a non-execute tool (or a config that
  // forbids edits) must not be offered an edit affordance.
  const canEdit = action.allowedDecisions.includes("edit");
  const detail =
    action.name === "execute" ? String(action.args.command ?? "") : JSON.stringify(action.args);

  return (
    // Non-modal: while status is "approval" isRunning is false, so this dialog
    // is the only thing on screen. Keeping it non-modal leaves the header's
    // "New thread" (cancel + reset) clickable so a hung gate can always be
    // escaped.
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

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-[11px] text-muted-foreground/70">
            Esc rejects the remaining actions
          </span>
          <Button variant="outline" size="sm" onClick={stopRun}>
            Stop run
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
