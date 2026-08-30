import { FC, type ReactNode, useState } from "react";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type DataMessagePartProps,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
} from "@assistant-ui/react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronRight,
  Square,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Hand-written Thread UI (assistant-ui registry fallback).
 *
 * The shadcn registry items for assistant-ui (`npx shadcn add
 * @assistant-ui/thread`) depend on Tailwind v4 tooling (`tw-shimmer` requires
 * `tailwindcss >= 4`), which conflicts with this project's pinned Tailwind v3.
 * This file is the faithful subset instead: viewport + message list +
 * composer, styled with our shadcn theme tokens.
 *
 * Must be mounted inside an `AssistantRuntimeProvider`. Structured transcript
 * events arrive as `data` message parts (see to-thread-message.ts) and are
 * rendered by the `data.by_name` component map below.
 */

type ToolCallData = { name: string; args: unknown };
type ToolResultData = { content: string; isError: boolean };

const MAX_ARGS_CHARS = 64;

/** Render tool arguments compactly — full JSON on hover via title. */
const formatArgs = (args: unknown): string => {
  if (args == null) return "";
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    return String(args);
  }
  if (json === "{}") return "";
  return json.length > MAX_ARGS_CHARS ? `${json.slice(0, MAX_ARGS_CHARS)}…` : json;
};

const TextPart: FC<TextMessagePartProps> = ({ text }) => (
  <span className="whitespace-pre-wrap">{text}</span>
);

/** Collapsible reasoning ("thinking") block, collapsed while streaming. */
const ReasoningPart: FC<ReasoningMessagePartProps> = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        Thinking
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
};

const ToolCallPart: FC<DataMessagePartProps<ToolCallData>> = ({ data: raw }) => {
  const data = raw ?? { name: "tool", args: null };
  return (
    <div className="my-1 flex items-center gap-2 overflow-hidden text-xs text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 font-mono text-[11px] font-medium text-foreground">
        <Wrench className="size-3" aria-hidden />
        {data.name}
      </span>
      <span
        className="truncate font-mono text-[11px]"
        title={typeof data.args === "string" ? data.args : formatArgs(data.args)}
      >
        {formatArgs(data.args)}
      </span>
    </div>
  );
};

const ToolResultPart: FC<DataMessagePartProps<ToolResultData>> = ({ data: raw }) => {
  const data = raw ?? { content: "", isError: false };
  return (
    <div
      className={cn(
        "my-1 max-w-full whitespace-pre-wrap rounded-md border px-2.5 py-1.5 text-xs leading-relaxed",
        data.isError
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      {data.content}
    </div>
  );
};

const DelegatePart: FC<DataMessagePartProps<{ text: string }>> = ({ data }) => (
  <div className="my-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-accent/60 px-2.5 py-1 text-xs font-medium text-accent-foreground">
    <Bot className="size-3.5" aria-hidden />
    {data?.text}
  </div>
);

const ErrorPart: FC<DataMessagePartProps<{ text: string }>> = ({ data }) => (
  <div className="my-1.5 flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
    <span className="whitespace-pre-wrap">{data?.text}</span>
  </div>
);

const SystemNotePart: FC<DataMessagePartProps<{ text: string }>> = ({ data }) => (
  <div className="my-1 text-xs italic text-muted-foreground">{data?.text}</div>
);

const MessageParts: FC = () => (
  <MessagePrimitive.Parts
    components={{
      Text: TextPart,
      Reasoning: ReasoningPart,
      data: {
        by_name: {
          toolCall: ToolCallPart,
          toolResult: ToolResultPart,
          delegate: DelegatePart,
          error: ErrorPart,
          systemNote: SystemNotePart,
        },
      },
    }}
  />
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root className="flex w-full justify-end py-2">
    <div className="max-w-[75%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed text-secondary-foreground">
      <MessageParts />
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className="flex w-full flex-col justify-start py-2">
    <div className="text-[15px] leading-relaxed text-foreground">
      <MessageParts />
    </div>
  </MessagePrimitive.Root>
);

const ComposerActions: FC = () => (
  <div className="flex items-center gap-2 pb-0.5">
    <ThreadPrimitive.If running={false}>
      <ComposerPrimitive.Send asChild>
        <button
          type="submit"
          aria-label="Send message"
          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </ComposerPrimitive.Send>
    </ThreadPrimitive.If>
    <ThreadPrimitive.If running>
      <ComposerPrimitive.Cancel asChild>
        <button
          type="button"
          aria-label="Stop generating"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      </ComposerPrimitive.Cancel>
    </ThreadPrimitive.If>
  </div>
);

const Composer: FC = () => (
  <ComposerPrimitive.Root className="w-full rounded-2xl border border-border bg-card shadow-md shadow-black/[0.04] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10">
    <ComposerPrimitive.Input
      placeholder="Message hermes…"
      className="max-h-44 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] outline-none placeholder:text-muted-foreground/70"
      rows={1}
      autoFocus
    />
    <div className="flex items-center justify-between px-3 pb-2">
      <span className="select-none text-[11px] text-muted-foreground/60">
        ↵ send · ⇧↵ newline
      </span>
      <ComposerActions />
    </div>
  </ComposerPrimitive.Root>
);

const ThreadScrollToBottomButton: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <button
      type="button"
      aria-label="Scroll to bottom"
      className="mb-1 flex size-8 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-opacity hover:bg-muted disabled:pointer-events-none disabled:opacity-0"
    >
      <ArrowDown className="size-4 text-muted-foreground" />
    </button>
  </ThreadPrimitive.ScrollToBottom>
);

interface ThreadProps {
  children?: ReactNode;
  className?: string;
  /** Extra content stacked above the composer in the sticky footer. */
  footerExtra?: ReactNode;
  /** Shown as one-tap prompts on the empty screen. */
  suggestions?: string[];
  onSuggestion?: (text: string) => void;
}

export const Thread: FC<ThreadProps> = ({
  children,
  className,
  footerExtra,
  suggestions,
  onSuggestion,
}) => (
  <ThreadPrimitive.Root
    className={cn("flex h-full flex-col items-center overflow-hidden px-6", className)}
  >
    <ThreadPrimitive.Viewport className="flex w-full max-w-3xl grow flex-col items-center overflow-y-scroll scroll-smooth">
      {children}
      <ThreadPrimitive.Empty>
        <div className="flex grow flex-col items-center justify-center pb-20 pt-10 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-500 text-white shadow-md">
            ✻
          </div>
          <h2 className="text-xl font-semibold tracking-tight">What can I do for you?</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ask anything — hermes plans, runs tools, and checks in before risky actions.
          </p>
          {suggestions && suggestions.length > 0 && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSuggestion?.(s)}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </ThreadPrimitive.Empty>
      <div className="flex w-full flex-col items-center pt-6">
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </div>
      <ThreadPrimitive.ViewportFooter className="sticky bottom-0 flex w-full flex-col items-center justify-end bg-gradient-to-t from-background from-60% to-transparent pb-4 pt-8">
        <ThreadScrollToBottomButton />
        {footerExtra}
        <Composer />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>
);