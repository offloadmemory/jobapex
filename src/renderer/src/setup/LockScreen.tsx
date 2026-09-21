import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { hermes } from "../lib/ipc";

/**
 * Full-screen PIN gate. The main process owns the lock state; this screen only
 * collects the PIN and reports whatever `app:unlock` decides (including the
 * retry delay that follows repeated failures).
 */
export function LockScreen({
  assistantName,
  onUnlocked,
}: {
  assistantName: string;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    const result = await hermes.app.unlock(pin);
    setBusy(false);
    setPin("");
    if (result.ok) {
      setError(null);
      onUnlocked();
      return;
    }
    setError(result.error.message);
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Lock className="size-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">{assistantName} is locked</div>
            <div className="text-[11px] text-muted-foreground">Enter your PIN to continue</div>
          </div>
        </div>
        <Input
          autoFocus
          type="password"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(null);
          }}
          placeholder="PIN"
          aria-label="PIN"
          className="mt-5"
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <Button type="submit" className="mt-4 w-full" disabled={!pin || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
