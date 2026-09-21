import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FolderOpen, Key, KeyRound, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";

import { ACCENT_COLORS } from "@shared/wire";
import type {
  AccentColor,
  AppInfo,
  AppSettings,
  ModelInfo,
  ProviderInfo,
  ProviderInput,
  ProviderType,
  SettingsInput,
  ThemeMode,
} from "@shared/wire";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { hermes } from "../lib/ipc";
import { reportError } from "../lib/log";
import { cn } from "../lib/utils";
import { applyTheme } from "../theme";

const PROVIDER_TYPES: ProviderType[] = ["ollama", "openai", "anthropic"];

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

/** Sentinel option that swaps the discovered-model select for a free-text field. */
const CUSTOM_MODEL = "__custom__";

const SELECT_CLASS =
  "h-9 rounded-md border bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const MAX_IDLE_MINUTES = 1440;

const FLASH_MS = 2500;

const THEME_MODES: Array<{ id: ThemeMode; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/**
 * Swatch + label per accent. The swatch is the accent's own mid-tone rather than
 * the mode-specific `--primary` token, so the picker reads the same in both modes;
 * `ACCENT_COLORS` fixes the display order and the record completeness forces a
 * swatch for every accent the contract knows about.
 */
const ACCENTS: Record<AccentColor, { label: string; swatch: string }> = {
  neutral: { label: "Neutral", swatch: "hsl(240 5.9% 10%)" },
  blue: { label: "Blue", swatch: "hsl(221 83% 53%)" },
  violet: { label: "Violet", swatch: "hsl(262 83% 58%)" },
  emerald: { label: "Emerald", swatch: "hsl(160 84% 39%)" },
  amber: { label: "Amber", swatch: "hsl(32 95% 44%)" },
  rose: { label: "Rose", swatch: "hsl(347 77% 50%)" },
};

/**
 * A main-process failure has nowhere to reach the user in a packaged build, so
 * it is mirrored into hermes.log and returned as the text to show inline.
 */
function failureText(scope: string, error: { code: string; message: string }): string {
  reportError(scope, new Error(`${error.code}: ${error.message}`));
  return error.message;
}

/** Delete copy has to say who inherits the default, and that nobody does at zero rows. */
function deleteExplanation(target: ProviderInfo, successor: ProviderInfo | null): string {
  if (!target.isDefault) {
    return `${target.name} and its stored API key are removed. This cannot be undone.`;
  }
  if (!successor) {
    return `${target.name} is the only provider: deleting it leaves nothing to answer new threads. Its stored API key goes too.`;
  }
  return `${target.name} is the default provider, so ${successor.name} takes over as the default. Its stored API key goes too.`;
}

function formatRelative(ts: number): string {
  const elapsed = Date.now() - ts;
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Transient confirmation text that clears itself after a moment. */
function useFlash(): [string | null, (text: string) => void, () => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const flash = useCallback((next: string) => {
    setText(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), FLASH_MS);
  }, []);

  // An error supersedes a pending confirmation in the same footer slot.
  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setText(null);
  }, []);

  return [text, flash, clear];
}

export function SettingsView({
  onChanged,
  onSetupRequested,
}: {
  onChanged: () => void;
  onSetupRequested: () => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsResult, providersResult, infoResult] = await Promise.all([
      hermes.app.getSettings(),
      hermes.providers.list(),
      hermes.app.getInfo(),
    ]);
    const problems: string[] = [];
    if (settingsResult.ok) {
      setSettings(settingsResult.data);
    } else {
      setSettings(null);
      problems.push(`settings: ${settingsResult.error.message}`);
    }
    if (providersResult.ok) {
      setProviders(providersResult.data);
    } else {
      setProviders(null);
      problems.push(`providers: ${providersResult.error.message}`);
    }
    if (infoResult.ok) {
      setInfo(infoResult.data);
    } else {
      setInfo(null);
      problems.push(`app info: ${infoResult.error.message}`);
    }
    if (problems.length > 0) reportError("settings.load", new Error(problems.join("; ")));
    setError(problems.length > 0 ? `Could not load ${problems.join("; ")}` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The list is the source of truth for the default flag: setDefault touches the
  // providers table without rewriting the stored defaultProviderId setting, so
  // echoing the loaded setting back would silently revert a newer default.
  const defaultProviderId =
    providers?.find((p) => p.isDefault)?.id ?? settings?.defaultProviderId ?? null;

  // ---- Assistant ----------------------------------------------------------

  const [assistantName, setAssistantName] = useState("");
  const [idleMinutes, setIdleMinutes] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantSaved, flashAssistantSaved, clearAssistantSaved] = useFlash();

  useEffect(() => {
    if (!settings) return;
    setAssistantName(settings.assistantName);
    setIdleMinutes(String(settings.idleLockMinutes));
  }, [settings]);

  async function saveAssistant(event: FormEvent) {
    event.preventDefault();
    if (assistantBusy || !settings) return;

    const name = assistantName.trim();
    if (!name) {
      clearAssistantSaved();
      setAssistantError("Give the assistant a name.");
      return;
    }
    if (!/^\d+$/.test(idleMinutes.trim())) {
      clearAssistantSaved();
      setAssistantError("Idle lock must be a whole number of minutes.");
      return;
    }
    const minutes = Number(idleMinutes.trim());
    if (minutes > MAX_IDLE_MINUTES) {
      clearAssistantSaved();
      setAssistantError(`Idle lock must be ${MAX_IDLE_MINUTES} minutes (24 hours) or less.`);
      return;
    }

    setAssistantBusy(true);
    setAssistantError(null);
    const input: SettingsInput = {
      assistantName: name,
      idleLockMinutes: minutes,
      defaultProviderId,
      theme: settings.theme,
      accent: settings.accent,
      pin: undefined,
    };
    const result = await hermes.app.saveSettings(input);
    setAssistantBusy(false);
    if (!result.ok) {
      setAssistantError(failureText("settings.saveAssistant", result.error));
      return;
    }
    flashAssistantSaved("Saved");
    onChanged();
    await load();
  }

  // ---- Appearance ---------------------------------------------------------

  const [theme, setTheme] = useState<ThemeMode>("system");
  const [accent, setAccent] = useState<AccentColor>("neutral");
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSaved, flashThemeSaved, clearThemeSaved] = useFlash();

  useEffect(() => {
    if (!settings) return;
    setTheme(settings.theme);
    setAccent(settings.accent);
  }, [settings]);

  /**
   * Mode and accent are one stored row and one control group: paint whichever
   * axis changed, then persist both. Painting first keeps the palette from
   * lagging the control by a round-trip.
   */
  async function saveAppearance(next: { theme?: ThemeMode; accent?: AccentColor }) {
    if (themeBusy || !settings) return;
    const nextTheme = next.theme ?? theme;
    const nextAccent = next.accent ?? accent;
    if (nextTheme === theme && nextAccent === accent) return;
    setTheme(nextTheme);
    setAccent(nextAccent);
    applyTheme(nextTheme, nextAccent);
    setThemeBusy(true);
    setThemeError(null);
    clearThemeSaved();
    const input: SettingsInput = {
      assistantName: settings.assistantName,
      idleLockMinutes: settings.idleLockMinutes,
      defaultProviderId,
      theme: nextTheme,
      accent: nextAccent,
      pin: undefined,
    };
    const result = await hermes.app.saveSettings(input);
    setThemeBusy(false);
    if (!result.ok) {
      // A failed save must not leave the window wearing a theme nothing stored.
      setTheme(settings.theme);
      setAccent(settings.accent);
      applyTheme(settings.theme, settings.accent);
      setThemeError(failureText("settings.saveTheme", result.error));
      return;
    }
    flashThemeSaved("Appearance saved.");
    onChanged();
    await load();
  }

  // ---- Providers ----------------------------------------------------------

  const [providersError, setProvidersError] = useState<string | null>(null);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ProviderInfo | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * What the main process promotes in its place: listProviders orders the default
   * first and the rest oldest-first, so the first other row is the successor.
   */
  const deleteSuccessor = pendingDelete?.isDefault
    ? ((providers ?? []).find((p) => p.id !== pendingDelete.id) ?? null)
    : null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pName, setPName] = useState("");
  const [pType, setPType] = useState<ProviderType>("ollama");
  const [pBaseUrl, setPBaseUrl] = useState("");
  const [pModel, setPModel] = useState("");
  const [pApiKey, setPApiKey] = useState("");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const [dialogBusy, setDialogBusy] = useState<"discover" | "test" | "save" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogNote, setDialogNote] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  const needsKey = TYPE_DEFAULTS[pType].needsKey;
  const keyAlreadyStored =
    (editingId ? providers?.find((p) => p.id === editingId)?.credentialsConfigured : false) ??
    false;

  const discovered = models ?? [];
  const modelSelectVisible =
    discovered.length > 0 &&
    !customModel &&
    (pModel.trim() === "" || discovered.some((m) => m.id === pModel));

  function openNewProvider() {
    setEditingId(null);
    setPName(TYPE_DEFAULTS.ollama.name);
    setPType("ollama");
    setPBaseUrl(TYPE_DEFAULTS.ollama.baseUrl);
    setPModel("");
    setPApiKey("");
    setModels(null);
    setCustomModel(false);
    setDialogBusy(null);
    setDialogError(null);
    setDialogNote(null);
    setTestNote(null);
    setDialogOpen(true);
  }

  function openEditProvider(provider: ProviderInfo) {
    setEditingId(provider.id);
    setPName(provider.name);
    setPType(provider.type);
    setPBaseUrl(provider.baseUrl ?? TYPE_DEFAULTS[provider.type].baseUrl);
    setPModel(provider.model);
    setPApiKey("");
    setModels(null);
    setCustomModel(false);
    setDialogBusy(null);
    setDialogError(null);
    setDialogNote(null);
    setTestNote(null);
    setDialogOpen(true);
  }

  function pickType(next: ProviderType) {
    const previous = TYPE_DEFAULTS[pType];
    setPType(next);
    // Only replace a base URL that was just the previous type's default.
    if (!pBaseUrl.trim() || pBaseUrl.trim() === previous.baseUrl) {
      setPBaseUrl(TYPE_DEFAULTS[next].baseUrl);
    }
    if (!TYPE_DEFAULTS[next].needsKey) setPApiKey("");
    setModels(null);
    setCustomModel(false);
    setDialogNote(null);
    setTestNote(null);
  }

  function providerPayload(): ProviderInput {
    return {
      id: editingId ?? undefined,
      name: pName.trim(),
      type: pType,
      baseUrl: pBaseUrl.trim() || undefined,
      model: pModel.trim() || undefined,
      apiKey: pApiKey.trim() || undefined,
    };
  }

  async function discoverModels() {
    setDialogBusy("discover");
    setDialogError(null);
    setDialogNote(null);
    setTestNote(null);
    const result = await hermes.providers.discover({ ...providerPayload(), model: undefined });
    setDialogBusy(null);
    if (!result.ok) {
      setModels(null);
      setDialogError(failureText("settings.discoverModels", result.error));
      return;
    }
    setModels(result.data);
    if (result.data.length === 0) {
      setDialogNote("No models answered — type the model name by hand.");
      return;
    }
    setCustomModel(false);
    setDialogNote(
      `Found ${result.data.length} model${result.data.length === 1 ? "" : "s"}.`
    );
    if (!pModel.trim() && result.data[0]) setPModel(result.data[0].id);
  }

  async function testConnection() {
    setDialogBusy("test");
    setDialogError(null);
    setDialogNote(null);
    setTestNote(null);
    const result = await hermes.providers.validate(providerPayload());
    setDialogBusy(null);
    if (!result.ok) {
      // A refused connection is the log's business too — it is what a "cannot
      // connect" report gets debugged against.
      setTestNote({ ok: false, text: failureText("settings.testProvider", result.error) });
      return;
    }
    const model = pModel.trim();
    setTestNote({ ok: true, text: model ? `"${model}" answered.` : "Connection OK." });
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (dialogBusy) return;
    if (!pName.trim()) {
      setDialogError("Give this provider a name.");
      return;
    }
    if (!pModel.trim()) {
      setDialogError("Pick or type a model — the provider cannot run without one.");
      return;
    }
    if (needsKey && !pApiKey.trim() && !keyAlreadyStored) {
      setDialogError(`Add an API key — ${pType} cannot run without one.`);
      return;
    }

    setDialogBusy("save");
    setDialogError(null);
    setDialogNote(null);
    setTestNote(null);
    const result = await hermes.providers.save(providerPayload());
    setDialogBusy(null);
    if (!result.ok) {
      setDialogError(failureText("settings.saveProvider", result.error));
      return;
    }
    setDialogOpen(false);
    onChanged();
    await load();
  }

  async function makeDefault(id: string) {
    setBusyProviderId(id);
    setProvidersError(null);
    const result = await hermes.providers.setDefault(id);
    setBusyProviderId(null);
    if (!result.ok) {
      setProvidersError(failureText("settings.setDefault", result.error));
      return;
    }
    onChanged();
    await load();
  }

  async function removeStoredKey(provider: ProviderInfo) {
    if (
      !window.confirm(
        `Remove the stored API key for ${provider.name}? The provider stays configured but cannot run until you add a new key.`
      )
    ) {
      return;
    }
    setBusyProviderId(provider.id);
    setProvidersError(null);
    const result = await hermes.providers.clearKey(provider.id);
    setBusyProviderId(null);
    if (!result.ok) {
      setProvidersError(failureText("settings.clearProviderKey", result.error));
      return;
    }
    onChanged();
    await load();
  }

  async function confirmDeleteProvider() {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const result = await hermes.providers.remove(pendingDelete.id);
    setDeleteBusy(false);
    if (!result.ok) {
      setDeleteError(failureText("settings.deleteProvider", result.error));
      return;
    }
    setPendingDelete(null);
    setBusyProviderId(null);
    onChanged();
    await load();
  }

  // ---- Security -----------------------------------------------------------

  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaved, flashPinSaved, clearPinSaved] = useFlash();

  async function savePin(nextPin: string | null, confirmation: string) {
    if (pinBusy || !settings) return;
    setPinBusy(true);
    setPinError(null);
    clearPinSaved();
    const input: SettingsInput = {
      assistantName: settings.assistantName,
      idleLockMinutes: settings.idleLockMinutes,
      defaultProviderId,
      theme: settings.theme,
      accent: settings.accent,
      pin: nextPin,
    };
    const result = await hermes.app.saveSettings(input);
    setPinBusy(false);
    if (!result.ok) {
      clearPinSaved();
      setPinError(failureText("settings.savePin", result.error));
      return;
    }
    setPin("");
    flashPinSaved(confirmation);
    onChanged();
    await load();
  }

  async function submitPin(event: FormEvent) {
    event.preventDefault();
    if (pin.length < 4) {
      clearPinSaved();
      setPinError("The PIN must be at least 4 characters.");
      return;
    }
    if (pin.length > 64) {
      clearPinSaved();
      setPinError("The PIN must be 64 characters or fewer.");
      return;
    }
    await savePin(pin, "PIN set.");
  }

  // ---- About and maintenance ----------------------------------------------

  const [maintenanceBusy, setMaintenanceBusy] = useState<"log" | "workspace" | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);

  async function revealLog() {
    setMaintenanceBusy("log");
    setMaintenanceError(null);
    const result = await hermes.app.revealLog();
    setMaintenanceBusy(null);
    if (!result.ok) setMaintenanceError(failureText("settings.revealLog", result.error));
  }

  async function openWorkspace() {
    setMaintenanceBusy("workspace");
    setMaintenanceError(null);
    const result = await hermes.files.reveal(); // no argument reveals the workspace root
    setMaintenanceBusy(null);
    if (!result.ok) setMaintenanceError(failureText("settings.openWorkspace", result.error));
  }

  async function runSetupAgain() {
    if (
      !window.confirm(
        "Run setup again? The first-run wizard takes over the window and must be finished. Providers, notes, skills, PIN and theme are kept."
      )
    ) {
      return;
    }
    setSetupBusy(true);
    setMaintenanceError(null);
    const result = await hermes.app.resetSetup();
    setSetupBusy(false);
    if (!result.ok) {
      setMaintenanceError(failureText("settings.resetSetup", result.error));
      return;
    }
    onSetupRequested();
  }

  async function removePin() {
    if (
      !window.confirm(
        "Remove the PIN? hermes will stop asking for it on launch and after the idle timeout."
      )
    ) {
      return;
    }
    await savePin(null, "PIN removed.");
  }

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-sm font-semibold">Settings</h1>
        {loading && (settings !== null || providers !== null) ? (
          <span className="text-xs text-muted-foreground">Refreshing…</span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto grid max-w-3xl gap-6 p-6">
            {loading && settings === null && providers === null ? (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            ) : null}

            {error ? (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            ) : null}

            {settings ? (
              <Card>
                <CardHeader>
                  <CardTitle>Assistant</CardTitle>
                  <CardDescription>
                    Display name and how long the app may sit idle before it locks.
                  </CardDescription>
                </CardHeader>
                <form onSubmit={saveAssistant}>
                  <CardContent className="grid gap-4">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium">Assistant name</span>
                      <Input
                        value={assistantName}
                        onChange={(event) => setAssistantName(event.target.value)}
                        placeholder="hermes"
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium">Idle lock (minutes)</span>
                      <Input
                        type="number"
                        min={0}
                        max={MAX_IDLE_MINUTES}
                        value={idleMinutes}
                        onChange={(event) => setIdleMinutes(event.target.value)}
                        className="w-32"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        0 disables the idle lock.
                      </span>
                    </label>
                    {assistantError ? (
                      <p className="text-sm text-destructive">{assistantError}</p>
                    ) : null}
                  </CardContent>
                  <CardFooter className="justify-end gap-3">
                    {assistantSaved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="size-3.5" aria-hidden />
                        {assistantSaved}
                      </span>
                    ) : null}
                    <Button type="submit" disabled={assistantBusy}>
                      {assistantBusy ? "Saving…" : "Save"}
                    </Button>
                  </CardFooter>
                </form>
              </Card>
            ) : null}

            {settings ? (
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>
                    Palette for the whole window: a mode and an accent color. System follows the OS
                    setting and switches with it.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Theme</span>
                    <select
                      value={theme}
                      onChange={(event) =>
                        void saveAppearance({ theme: event.target.value as ThemeMode })
                      }
                      disabled={themeBusy}
                      className={SELECT_CLASS}
                    >
                      {THEME_MODES.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium">Accent color</span>
                    <div
                      role="radiogroup"
                      aria-label="Accent color"
                      className="flex flex-wrap gap-2"
                    >
                      {ACCENT_COLORS.map((id) => {
                        const option = ACCENTS[id];
                        const selected = accent === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={themeBusy}
                            onClick={() => void saveAppearance({ accent: id })}
                            className={cn(
                              "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition-colors",
                              "disabled:cursor-not-allowed disabled:opacity-60",
                              selected
                                ? "border-foreground/30 bg-accent text-accent-foreground"
                                : "hover:bg-muted"
                            )}
                          >
                            <span
                              aria-hidden
                              className="size-5 rounded-full border border-foreground/20"
                              style={{ background: option.swatch }}
                            />
                            {option.label}
                            {selected ? <Check className="size-3.5" aria-hidden /> : null}
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      Colors buttons, the selected page and focus rings.
                    </span>
                  </div>
                  {themeError ? (
                    <p className="text-sm text-destructive">{themeError}</p>
                  ) : themeSaved ? (
                    <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="size-3.5" aria-hidden />
                      {themeSaved}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {providers ? (
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="grid gap-1.5">
                    <CardTitle>Providers</CardTitle>
                    <CardDescription>
                      Where hermes sends model requests. The default provider answers new threads.
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={openNewProvider}>
                    <Plus aria-hidden />
                    Add provider
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {providersError ? (
                    <p className="text-sm text-destructive">{providersError}</p>
                  ) : null}

                  {providers.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-center">
                      <p className="text-sm font-medium">No providers configured</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        A provider is required before the assistant can run. Use “Add provider”
                        above to connect Ollama, OpenAI, or Anthropic.
                      </p>
                    </div>
                  ) : (
                    providers.map((provider) => (
                      <div
                        key={provider.id}
                        className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                      >
                        <div className="grid min-w-0 gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">{provider.name}</span>
                            <Badge variant="outline">{provider.type}</Badge>
                            {provider.isDefault ? (
                              <Badge variant="secondary">default</Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">{provider.model}</span>
                            {provider.baseUrl ? (
                              <span className="truncate font-mono">{provider.baseUrl}</span>
                            ) : null}
                            <span className="inline-flex items-center gap-1">
                              {provider.credentialsConfigured ? (
                                <KeyRound className="size-3.5" aria-hidden />
                              ) : (
                                <Key className="size-3.5" aria-hidden />
                              )}
                              {provider.credentialsConfigured ? "key stored" : "no key"}
                            </span>
                            <span>updated {formatRelative(provider.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {provider.isDefault ? null : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void makeDefault(provider.id)}
                              disabled={busyProviderId !== null}
                            >
                              {busyProviderId === provider.id ? "Setting…" : "Set default"}
                            </Button>
                          )}
                          {provider.credentialsConfigured ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void removeStoredKey(provider)}
                              disabled={busyProviderId !== null}
                            >
                              {busyProviderId === provider.id ? "Removing…" : "Remove stored key"}
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditProvider(provider)}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setDeleteError(null);
                              setPendingDelete(provider);
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {settings ? (
              <Card>
                <CardHeader>
                  <CardTitle>Security</CardTitle>
                  <CardDescription>
                    A PIN gates the app on launch and after the idle timeout.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {settings.pinConfigured ? (
                    <>
                      <p className="text-sm">
                        {settings.idleLockMinutes > 0
                          ? `hermes locks after ${settings.idleLockMinutes} minute${
                              settings.idleLockMinutes === 1 ? "" : "s"
                            } idle, and asks for the PIN again on the next launch.`
                          : "The idle lock is off (0 minutes), but hermes still asks for the PIN on the next launch."}
                      </p>
                      <div>
                        <Button
                          variant="outline"
                          onClick={() => void removePin()}
                          disabled={pinBusy}
                        >
                          {pinBusy ? "Working…" : "Remove PIN"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <form onSubmit={submitPin} className="grid gap-3">
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium">Set a PIN</span>
                        <Input
                          type="password"
                          value={pin}
                          onChange={(event) => setPin(event.target.value)}
                          placeholder="4+ characters"
                          autoComplete="new-password"
                          className="w-64"
                        />
                        <span className="text-[11px] text-muted-foreground">
                          With a PIN set, hermes locks on launch and after the idle timeout. There
                          is no recovery if you forget it.
                        </span>
                      </label>
                      <div>
                        <Button type="submit" disabled={pinBusy}>
                          {pinBusy ? "Saving…" : "Set PIN"}
                        </Button>
                      </div>
                    </form>
                  )}

                  {pinError ? <p className="text-sm text-destructive">{pinError}</p> : null}
                  {pinSaved ? (
                    <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Check className="size-3.5" aria-hidden />
                      {pinSaved}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {info ? (
              <Card>
                <CardHeader>
                  <CardTitle>About and diagnostics</CardTitle>
                  <CardDescription>
                    Version, and where this workspace and the error log live on disk.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Version</span>
                    <span className="font-mono">{info.version}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">Workspace</span>
                    <span className="truncate font-mono" title={info.workspaceDir}>
                      {info.workspaceDir}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">Logs</span>
                    <span className="truncate font-mono" title={info.logDir}>
                      {info.logDir}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void revealLog()}
                      disabled={maintenanceBusy !== null}
                    >
                      <ScrollText className="size-3.5" aria-hidden />
                      {maintenanceBusy === "log" ? "Opening…" : "Reveal log"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void openWorkspace()}
                      disabled={maintenanceBusy !== null}
                    >
                      <FolderOpen className="size-3.5" aria-hidden />
                      {maintenanceBusy === "workspace" ? "Opening…" : "Open workspace"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runSetupAgain()}
                      disabled={setupBusy}
                    >
                      {setupBusy ? "Resetting…" : "Run setup again"}
                    </Button>
                  </div>

                  {maintenanceError ? (
                    <p className="text-sm text-destructive">{maintenanceError}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Running setup again keeps your providers, notes, skills, PIN and theme.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogContent>
                <form
                  onSubmit={saveProvider}
                  className="grid gap-4"
                >
                  <DialogHeader>
                    <DialogTitle>{editingId ? "Edit provider" : "Add provider"}</DialogTitle>
                    <DialogDescription>
                      Connection details stay on this machine.{" "}
                      {settings?.pinConfigured
                        ? "API keys are encrypted with your PIN and never returned to this window."
                        : "API keys are stored in the OS keychain and never returned to this window."}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium">Name</span>
                      <Input
                        value={pName}
                        onChange={(event) => setPName(event.target.value)}
                        placeholder="Ollama (local)"
                      />
                    </label>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium">Type</span>
                      <select
                        value={pType}
                        onChange={(event) => pickType(event.target.value as ProviderType)}
                        className={SELECT_CLASS}
                      >
                        {PROVIDER_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium">Base URL</span>
                      <Input
                        value={pBaseUrl}
                        onChange={(event) => setPBaseUrl(event.target.value)}
                        placeholder={TYPE_DEFAULTS[pType].baseUrl}
                        className="font-mono text-xs"
                      />
                    </label>

                    <div className="grid gap-1.5">
                      <span className="text-xs font-medium">Model</span>
                      <div className="flex gap-2">
                        {modelSelectVisible ? (
                          <select
                            value={pModel}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next === CUSTOM_MODEL) {
                                setCustomModel(true);
                                setPModel("");
                                return;
                              }
                              setPModel(next);
                            }}
                            className={`${SELECT_CLASS} flex-1 font-mono text-xs`}
                          >
                            <option value="">Select a model…</option>
                            {discovered.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                            <option value={CUSTOM_MODEL}>Custom…</option>
                          </select>
                        ) : (
                          <Input
                            value={pModel}
                            onChange={(event) => setPModel(event.target.value)}
                            placeholder="llama3.1:8b"
                            className="flex-1 font-mono text-xs"
                          />
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void discoverModels()}
                          disabled={dialogBusy !== null}
                        >
                          {dialogBusy === "discover" ? "Checking…" : "Discover models"}
                        </Button>
                      </div>
                      {dialogNote ? (
                        <span className="text-[11px] text-muted-foreground">{dialogNote}</span>
                      ) : null}
                      {customModel && discovered.length > 0 ? (
                        <button
                          type="button"
                          className="w-fit text-[11px] text-muted-foreground underline"
                          onClick={() => setCustomModel(false)}
                        >
                          Back to discovered models
                        </button>
                      ) : null}
                    </div>

                    {needsKey ? (
                      <label className="grid gap-1.5">
                        <span className="text-xs font-medium">API key</span>
                        <Input
                          type="password"
                          value={pApiKey}
                          onChange={(event) => setPApiKey(event.target.value)}
                          placeholder={keyAlreadyStored ? "••••••" : "sk-…"}
                          autoComplete="off"
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {settings?.pinConfigured
                            ? "Encrypted with your PIN."
                            : "Encrypted by the OS keychain."}{" "}
                          Leave blank to keep the existing key.
                        </span>
                      </label>
                    ) : null}

                    {dialogError ? <p className="text-sm text-destructive">{dialogError}</p> : null}
                  </div>

                  <DialogFooter className="items-center justify-between gap-3 sm:justify-between">
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void testConnection()}
                        disabled={dialogBusy !== null || !pModel.trim()}
                      >
                        {dialogBusy === "test" ? "Testing…" : "Test connection"}
                      </Button>
                      {testNote ? (
                        <span
                          className={
                            testNote.ok
                              ? "text-sm text-muted-foreground"
                              : "text-sm text-destructive"
                          }
                        >
                          {testNote.text}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setDialogOpen(false)}
                        disabled={dialogBusy === "save"}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={dialogBusy !== null}>
                        {dialogBusy === "save" ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog
              open={pendingDelete !== null}
              onOpenChange={(open) => {
                if (open) return;
                setPendingDelete(null);
                setDeleteError(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
                  <DialogDescription>
                    {pendingDelete ? deleteExplanation(pendingDelete, deleteSuccessor) : null}
                  </DialogDescription>
                </DialogHeader>
                {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPendingDelete(null);
                      setDeleteError(null);
                    }}
                    disabled={deleteBusy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void confirmDeleteProvider()}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? "Deleting…" : "Delete provider"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
