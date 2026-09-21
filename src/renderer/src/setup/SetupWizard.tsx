import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronLeft, Sparkles } from "lucide-react";

import type { ModelInfo, ProviderInput, ProviderType } from "@shared/wire";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { hermes } from "../lib/ipc";
import { reportError } from "../lib/log";
import { cn } from "../lib/utils";

interface TypeDefaults {
  name: string;
  baseUrl: string;
  /** Ollama is keyless; the cloud providers cannot run without credentials. */
  needsKey: boolean;
}

const TYPE_DEFAULTS: Record<ProviderType, TypeDefaults> = {
  ollama: { name: "Ollama", baseUrl: "http://localhost:11434", needsKey: false },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com", needsKey: true },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com", needsKey: true },
};

const TYPES: ProviderType[] = ["ollama", "openai", "anthropic"];

const STEPS = ["Provider", "Identity", "Security"] as const;
type StepIndex = 0 | 1 | 2;

const STEP_SUBTITLES = [
  "Pick a model provider to get started",
  "Choose the name your assistant answers to",
  "Optionally lock the app behind a PIN",
] as const;

type Busy = "discover" | "validate" | "provider" | "commit" | null;

/**
 * A main-process failure has nowhere else to reach the user in a packaged build,
 * so it is mirrored into hermes.log and returned as the text to show inline.
 */
function failureText(scope: string, error: { code: string; message: string }): string {
  reportError(scope, new Error(`${error.code}: ${error.message}`));
  return error.message;
}

/** null = the PIN section is fine; a blank PIN is the "no PIN" path, not a problem. */
function pinProblem(pin: string, confirmation: string): string | null {
  if (pin.length === 0) return null;
  if (pin.length < 4) return "The PIN must be at least 4 characters.";
  if (pin !== confirmation) return "The PINs do not match.";
  return null;
}

/**
 * First-run wizard: provider, assistant name and an optional PIN. The provider
 * is committed as soon as it saves (which is what unlocks the identity step);
 * the remaining fields are written by a single `app:setup` call on Finish, which
 * re-uses the saved provider id so the wizard never leaves a duplicate row
 * behind. "Run setup again" lands here with a provider and a name already saved,
 * so both are seeded from the running config instead of being reset to the
 * built-in defaults (which would add a second provider row and clobber the
 * assistant name). The app is unusable until a provider exists, so this stands
 * in for the app shell rather than being reachable from the nav.
 */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<StepIndex>(0);

  const [type, setType] = useState<ProviderType>("ollama");
  const [name, setName] = useState(TYPE_DEFAULTS.ollama.name);
  const [baseUrl, setBaseUrl] = useState(TYPE_DEFAULTS.ollama.baseUrl);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  /** Row saved by step 1; the final commit updates it instead of adding another. */
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providerNote, setProviderNote] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * The seeded provider's type. A stored key only satisfies the current type:
   * switching type means the user must supply that provider's key.
   */
  const [keyedType, setKeyedType] = useState<ProviderType | null>(null);
  const [keyStored, setKeyStored] = useState(false);

  const [assistantName, setAssistantName] = useState("hermes");
  // Seeding must never overwrite typing that beat the two IPC round-trips.
  const pristine = useRef(true);

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // Finish must hand off exactly once, even if the button is hit twice before
  // React re-renders the disabled state.
  const committed = useRef(false);

  const needsKey = TYPE_DEFAULTS[type].needsKey;
  /**
   * "Run setup again" reaches this wizard with a provider and a name already
   * saved. Seeding them keeps the wizard from adding a second provider row or
   * resetting the assistant name; a stored key (which never crosses the bridge)
   * also satisfies the key requirement.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [settings, providers] = await Promise.all([
        hermes.app.getSettings(),
        hermes.providers.list(),
      ]);
      if (cancelled || !pristine.current) return;
      if (settings.ok && settings.data.assistantName.trim().length > 0) {
        setAssistantName(settings.data.assistantName);
      }
      if (!providers.ok) return;
      const current = providers.data.find((p) => p.isDefault) ?? providers.data[0];
      if (!current) return;
      setProviderId(current.id);
      setType(current.type);
      setKeyedType(current.type);
      setKeyStored(current.credentialsConfigured);
      setName(current.name);
      setBaseUrl(current.baseUrl ?? TYPE_DEFAULTS[current.type].baseUrl);
      setModel(current.model);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasKey = apiKey.trim().length > 0 || (keyStored && keyedType === type);

  const providerReady = name.trim().length > 0 && model.trim().length > 0 && (!needsKey || hasKey);
  const identityReady = assistantName.trim().length > 0;
  const pinError = pinProblem(pin, confirmPin);

  const stepReady =
    step === 0 ? providerReady : step === 1 ? identityReady : pinError === null;

  function primaryLabel(): string {
    if (busy === "provider") return "Saving…";
    if (busy === "commit") return "Setting up…";
    if (step !== 2) return "Next";
    return pin ? "Finish setup" : "Finish without a PIN";
  }

  function pickType(next: ProviderType) {
    setType(next);
    setName(TYPE_DEFAULTS[next].name);
    setBaseUrl(TYPE_DEFAULTS[next].baseUrl);
    setModel("");
    setApiKey(""); // a key typed for the previous provider type is meaningless here
    setModels(null);
    setProviderNote(null);
    // providerId is kept: re-saving overwrites the same row with the new type.
    // hasKey follows the type, so a key stored for the seeded type stops
    // satisfying the step once another type is picked.
    setError(null);
  }

  function providerInput(): ProviderInput {
    return {
      id: providerId ?? undefined,
      name,
      type,
      baseUrl,
      model,
      apiKey: apiKey || undefined,
    };
  }

  async function discover() {
    setBusy("discover");
    setError(null);
    setProviderNote(null);
    const result = await hermes.providers.discover(providerInput());
    setBusy(null);
    if (!result.ok) {
      setModels(null); // a stale list from an earlier run must not outlive the failure
      setError(failureText("setup/discover", result.error));
      return;
    }
    setModels(result.data);
    setProviderNote(
      result.data.length === 0
        ? { ok: false, text: "No models answered — type the model name instead." }
        : {
            ok: true,
            text: `Found ${result.data.length} model${result.data.length === 1 ? "" : "s"}.`,
          }
    );
    if (!model && result.data[0]) setModel(result.data[0].id);
  }

  async function testConnection() {
    setBusy("validate");
    setError(null);
    setProviderNote(null);
    const result = await hermes.providers.validate(providerInput());
    setBusy(null);
    if (!result.ok) {
      setError(failureText("setup/validate", result.error));
      return;
    }
    setProviderNote({ ok: true, text: `"${model}" answered.` });
  }

  /** Provider → identity. The step only advances on a provider the main process accepted. */
  async function saveProviderStep() {
    setBusy("provider");
    setError(null);
    const result = await hermes.providers.save(providerInput());
    setBusy(null);
    if (!result.ok) {
      setError(failureText("setup/provider", result.error));
      return;
    }
    setProviderId(result.data.id);
    goTo(1);
  }

  async function finish() {
    if (committed.current) return;
    committed.current = true;
    setBusy("commit");
    setError(null);
    const result = await hermes.app.setup({
      assistantName: assistantName.trim(),
      provider: providerInput(),
      ...(pin ? { pin } : {}),
    });
    setBusy(null);
    if (!result.ok) {
      committed.current = false; // let the user correct and retry
      setError(failureText("setup/commit", result.error));
      return;
    }
    onDone();
  }

  function goTo(next: StepIndex) {
    setStep(next);
    setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy !== null || !stepReady) return;
    if (step === 0) {
      void saveProviderStep();
      return;
    }
    if (step === 1) {
      goTo(2);
      return;
    }
    void finish();
  }

  return (
    <div className="flex h-screen items-center justify-center overflow-y-auto bg-background px-6 py-10">
      <form
        onSubmit={submit}
        onChange={() => {
          pristine.current = false;
        }}
        className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Welcome to hermes</div>
            <div className="text-[11px] text-muted-foreground">{STEP_SUBTITLES[step]}</div>
          </div>
        </div>

        <ol className="mt-6 flex items-center gap-3">
          {STEPS.map((label, index) => {
            const done = index < step;
            const current = index === step;
            return (
              <li key={label} className="flex flex-1 items-center gap-3 last:flex-none">
                <button
                  type="button"
                  onClick={() => goTo(index as StepIndex)}
                  disabled={!done}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md text-xs transition-colors",
                    done && "text-foreground hover:text-primary",
                    current && "font-medium text-foreground",
                    !done && !current && "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border text-[11px]",
                      current && "border-primary bg-primary text-primary-foreground",
                      done && "border-primary text-primary",
                      !done && !current && "border-border"
                    )}
                  >
                    {done ? <Check className="size-3" aria-hidden /> : index + 1}
                  </span>
                  {label}
                </button>
                {index < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
              </li>
            );
          })}
        </ol>

        <div className="mt-6 grid gap-4">
          {step === 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">Provider</span>
                  <select
                    value={type}
                    onChange={(e) => pickType(e.target.value as ProviderType)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">Label</span>
                  <Input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError(null);
                    }}
                  />
                </label>
              </div>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">Base URL</span>
                <Input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder={TYPE_DEFAULTS[type].baseUrl}
                  className="font-mono text-xs"
                />
              </label>

              <div className="grid gap-1.5">
                <span className="text-xs font-medium">Model</span>
                <div className="flex gap-2">
                  {models && models.length > 0 ? (
                    <select
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setError(null);
                      }}
                      className="h-10 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setError(null);
                      }}
                      placeholder="llama3.1:8b"
                      className="flex-1 font-mono text-xs"
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void discover()}
                    disabled={busy !== null}
                  >
                    {busy === "discover" ? "Checking…" : "Discover"}
                  </Button>
                </div>
              </div>

              {needsKey && (
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">API key</span>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setError(null);
                    }}
                    placeholder="sk-…"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Encrypted on disk and never sent back to the window. With a PIN set it is
                    unlocked by that PIN; without one, by the OS keyring.
                  </span>
                </label>
              )}

              {providerNote && (
                <p
                  className={cn(
                    "text-xs",
                    providerNote.ok ? "text-muted-foreground" : "text-destructive"
                  )}
                >
                  {providerNote.text}
                </p>
              )}
            </>
          )}

          {step === 1 && (
            <label className="grid gap-1.5">
              <span className="text-xs font-medium">Assistant name</span>
              <Input
                autoFocus
                value={assistantName}
                onChange={(e) => {
                  setAssistantName(e.target.value);
                  setError(null);
                }}
                placeholder="hermes"
                aria-label="Assistant name"
              />
              <span className="text-[11px] text-muted-foreground">
                Shown in the title bar and on the lock screen. It cannot be blank.
              </span>
            </label>
          )}

          {step === 2 && (
            <>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">PIN (optional)</span>
                <Input
                  type="password"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setError(null);
                  }}
                  placeholder="4+ characters"
                  autoComplete="new-password"
                  aria-label="PIN"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium">Confirm PIN</span>
                <Input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value);
                    setError(null);
                  }}
                  placeholder="Type the PIN again"
                  autoComplete="new-password"
                  aria-label="Confirm PIN"
                />
              </label>

              <span
                className={cn("text-[11px]", pinError ? "text-destructive" : "text-muted-foreground")}
              >
                {pinError ??
                  "With a PIN, hermes locks on launch and after idle, and the stored API key is encrypted under a key derived from it. Leave both fields blank to skip — hermes then starts unlocked."}
              </span>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => goTo((step - 1) as StepIndex)}
            disabled={step === 0 || busy !== null}
          >
            <ChevronLeft aria-hidden />
            Back
          </Button>
          <div className="flex items-center gap-3">
            {step === 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void testConnection()}
                disabled={busy !== null || !model.trim()}
              >
                {busy === "validate" ? "Testing…" : "Test connection"}
              </Button>
            )}
            <Button type="submit" disabled={busy !== null || !stepReady}>
              {primaryLabel()}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
