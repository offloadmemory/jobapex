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
  | { type: "todos"; todos: Todo[] }
  | { type: "drain" }
  | { type: "approval"; runId: string; request: HITLRequestWire }
  | { type: "done"; cancelled: boolean; error?: string; rememberedNotes?: number };

export interface HITLActionWire {
  name: string;
  args: Record<string, unknown>;
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
}