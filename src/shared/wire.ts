export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface WireToolCall {
  name: string;
  args: unknown;
}

export interface WireMsg {
  type: "ai" | "tool";
  content: string;
  reasoning?: string;
  toolCalls?: WireToolCall[];
  isError?: boolean;
}

export type WireEvent =
  | { type: "token"; depth: number; msg: WireMsg }
  | { type: "update"; depth: number; msg: WireMsg }
  | { type: "todos"; depth: number; todos: Todo[] }
  | { type: "drain" }
  | { type: "approval"; runId: string; request: HITLRequestWire }
  | { type: "done"; cancelled: boolean; error?: string; rememberedNotes?: number };

/** Pages the application menu can ask the renderer to open. */
export type AppCommand = "new-thread" | "chat" | "threads" | "skills" | "memory" | "files" | "settings";

/**
 * Main → renderer app-level notices. The application menu can lock the app in
 * the main process, so the renderer gate follows this instead of guessing.
 */
export type AppEvent = { type: "locked" } | { type: "command"; command: AppCommand };

export type HITLDecisionKind = "approve" | "reject" | "edit";

export interface HITLActionWire {
  name: string;
  args: Record<string, unknown>;
  /** Decisions this gate accepts; the UI must not offer one that is absent. */
  allowedDecisions: HITLDecisionKind[];
}

export interface HITLRequestWire {
  actionRequests: HITLActionWire[];
}

export type HITLDecisionWire =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; editedAction: { name: string; args: Record<string, unknown> } };

export interface HITLResponseWire {
  decisions: HITLDecisionWire[];
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface AppInfo {
  model: string;
  baseUrl: string;
  workspaceDir: string;
  memfs: boolean;
  yolo: boolean;
  /** Display name of the active provider row, or null when running on config/env defaults. */
  providerName: string | null;
  /** Provider kind behind the active model, or null on config/env defaults. */
  providerType: ProviderType | null;
  /** Absolute path of the rotating log directory ("Reveal log"). */
  logDir: string;
  /** App version, for the About/footer line. */
  version: string;
}

/** A workspace file or directory, relative to the workspace root. */
export interface FileEntry {
  /** POSIX-separated path relative to the workspace root; "" is the root itself. */
  path: string;
  name: string;
  isDir: boolean;
  /** Bytes; 0 for directories. */
  size: number;
  /** Epoch ms of the entry's mtime. */
  updatedAt: number;
}

/** Result of copying a renderer-side attachment into the workspace. */
export interface StagedFile {
  name: string;
  /** Path relative to the workspace root, for pasting into a prompt. */
  relativePath: string;
  bytes: number;
}

export interface ThreadSummary {
  id: string;
  title: string;
  /** Epoch ms of the last run's completion (or creation, for a thread with no finished run). */
  updatedAt: number;
  messageCount: number;
}

export interface ThreadHistoryMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  source: "user" | "project";
  path: string;
}

export interface SkillInput {
  name: string;
  description: string;
  content: string;
  /** Rename: the old slug is removed after the new one is written. */
  previousName?: string;
}

export interface NoteInfo {
  slug: string;
  title: string;
  /** Epoch ms of the note file's mtime. */
  updatedAt: number;
}

export interface NoteInput {
  slug: string;
  title: string;
  content: string;
  /** Rename: the old slug is removed after the new one is written. */
  previousSlug?: string;
}

export type ProviderType = "ollama" | "openai" | "anthropic";

export interface ProviderInfo {
  id: string;
  name: string;
  type: ProviderType;
  /** Address returned in full; it is not a secret. */
  baseUrl?: string;
  model: string;
  isDefault: boolean;
  /** True when a key is stored in secrets.bin. The key itself never crosses the bridge. */
  credentialsConfigured: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  /** Present when editing an existing row. */
  id?: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  /** Optional on discover/validate; required on save. */
  model?: string;
  /** Omit or leave blank to keep the stored key on update. */
  apiKey?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

/** Renderer appearance; "system" follows the OS and is the default. */
export type ThemeMode = "system" | "light" | "dark";

/**
 * Accent hue layered on top of the mode: it drives `--primary`/`--ring`, so
 * buttons, the active nav row and focus rings take the colour. "neutral" is the
 * monochrome default and needs no token override.
 */
export const ACCENT_COLORS = ["neutral", "blue", "violet", "emerald", "amber", "rose"] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

/** Stored settings rows are strings; an unknown one must read as the default. */
export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && (ACCENT_COLORS as readonly string[]).includes(value);
}

export interface AppSettings {
  assistantName: string;
  idleLockMinutes: number;
  defaultProviderId: string | null;
  theme: ThemeMode;
  accent: AccentColor;
  /** Derived from the auth table; true when a PIN is stored. */
  pinConfigured: boolean;
  /** False until the first-run wizard has been completed. */
  setupComplete: boolean;
}

export interface SettingsInput {
  assistantName: string;
  idleLockMinutes: number;
  defaultProviderId: string | null;
  theme: ThemeMode;
  accent: AccentColor;
  /** Unset keeps the stored PIN; null removes it; a string replaces it. */
  pin?: string | null;
}

export interface SetupInput {
  assistantName: string;
  provider: ProviderInput;
  /** Optional 4+ character PIN; when present the app locks on next launch. */
  pin?: string;
}

/**
 * The API the preload bridge exposes on `window.hermes`.
 *
 * Declared here (in shared code) rather than in `src/preload/` so the renderer
 * can type against it without importing anything that pulls in Electron's
 * typings — `tsconfig.web.json` must stay free of Node types.
 */
export interface HermesApi {
  chat: {
    run(req: { prompt: string; threadId: string }): Promise<Result<{ runId: string }>>;
    cancel(threadId: string): Promise<Result<null>>;
    resolveApproval(runId: string, decision: HITLResponseWire): Promise<Result<null>>;
  };
  threads: {
    list(): Promise<Result<ThreadSummary[]>>;
    history(threadId: string): Promise<Result<ThreadHistoryMessage[]>>;
    rename(threadId: string, title: string): Promise<Result<null>>;
    /** Removes the thread index row and its LangGraph checkpoints. */
    remove(threadId: string): Promise<Result<null>>;
  };
  skills: {
    list(): Promise<Result<SkillInfo[]>>;
    read(name: string): Promise<Result<string | null>>;
    write(s: SkillInput): Promise<Result<null>>;
    remove(name: string, source: "user" | "project"): Promise<Result<null>>;
  };
  memory: {
    list(): Promise<Result<NoteInfo[]>>;
    search(query: string): Promise<Result<NoteInfo[]>>;
    read(slug: string): Promise<Result<string | null>>;
    write(n: NoteInput): Promise<Result<null>>;
    /** Pruning: the note file is removed and index.md regenerated. */
    delete(slug: string): Promise<Result<null>>;
  };
  providers: {
    list(): Promise<Result<ProviderInfo[]>>;
    save(p: ProviderInput): Promise<Result<ProviderInfo>>;
    discover(p: ProviderInput): Promise<Result<ModelInfo[]>>;
    validate(p: ProviderInput): Promise<Result<null>>;
    setDefault(id: string): Promise<Result<null>>;
    /** Removes the row and any stored key; the next provider becomes default. */
    remove(id: string): Promise<Result<null>>;
    /** Removes the stored key but keeps the row (the row then needs one to run). */
    clearKey(id: string): Promise<Result<null>>;
  };
  files: {
    /** Workspace-relative listing; no `dir` lists the root. */
    list(dir?: string): Promise<Result<FileEntry[]>>;
    /** UTF-8 text; paths outside the workspace root are rejected. */
    read(path: string): Promise<Result<string>>;
    write(path: string, content: string): Promise<Result<null>>;
    /** Copies an attachment into the workspace and returns its prompt-ready path. */
    stage(name: string, data: Uint8Array): Promise<Result<StagedFile>>;
    /** Reveals a workspace path (or the root) in the OS file manager. */
    reveal(path?: string): Promise<Result<null>>;
  };
  app: {
    getInfo(): Promise<Result<AppInfo>>;
    getSettings(): Promise<Result<AppSettings>>;
    saveSettings(s: SettingsInput): Promise<Result<null>>;
    isLocked(): Promise<Result<boolean>>;
    /** Called by the renderer's idle timer; the main process is the lock authority. */
    lock(): Promise<Result<null>>;
    unlock(pin: string): Promise<Result<null>>;
    setup(w: SetupInput): Promise<Result<null>>;
    /** Renderer failures are invisible in a packaged build; mirror them into hermes.log. */
    log(level: "info" | "warn" | "error", message: string): Promise<Result<null>>;
    /** Save-dialog export of a transcript; null when the user cancels. */
    exportTranscript(suggestedName: string, content: string): Promise<Result<{ path: string } | null>>;
    /** Reveals the rotating log directory in the OS file manager. */
    revealLog(): Promise<Result<null>>;
    /** Returns the app to the first-run wizard (providers/notes/skills are kept). */
    resetSetup(): Promise<Result<null>>;
  };
  onEvent(cb: (ev: WireEvent) => void): () => void;
  onAppEvent(cb: (ev: AppEvent) => void): () => void;
}