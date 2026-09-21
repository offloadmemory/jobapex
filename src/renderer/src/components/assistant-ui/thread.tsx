import { FC, type ComponentPropsWithoutRef, type ReactNode, useState } from "react";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInputHistory,
  type DataMessagePartProps,
  type MessageState,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
} from "@assistant-ui/react";
import {
  MarkdownTextPrimitive,
  useIsMarkdownCodeBlock,
  type MarkdownTextPrimitiveProps,
} from "@assistant-ui/react-markdown";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronRight,
  Square,
  Wrench,
} from "lucide-react";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { messageDepth } from "@/lib/to-thread-message";

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
 * rendered by the `data.by_name` component map below; assistant prose is
 * markdown (`MarkdownTextPrimitive`), and nested subagent output is labelled
 * from the depth carried on the message metadata.
 */

type ToolCallData = { name: string; args: unknown };
type ToolResultData = { content: string; isError: boolean };

/**
 * Full, pretty-printed tool arguments. Cards grow and scroll instead of
 * cutting the JSON short — an argument the agent actually used is exactly what
 * a user opens the card to read.
 */
const prettyArgs = (args: unknown): string => {
  if (args == null) return "";
  try {
    const json = JSON.stringify(args, null, 2);
    return json === "{}" ? "" : json;
  } catch {
    return String(args);
  }
};

/** react-markdown hands each element its AST node; it is not a DOM prop. */
type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { node?: unknown };

/**
 * Fenced code sits inside the `pre` below; only inline code gets a chip.
 * `node` is dropped rather than forwarded — the markdown AST node is not a DOM
 * prop and React would render it as a `node="[object Object]"` attribute.
 */
const MarkdownCode: FC<MarkdownCodeProps> = ({ node, className, ...props }) => {
  const inCodeBlock = useIsMarkdownCodeBlock();
  return (
    <code
      {...props}
      className={cn(!inCodeBlock && "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)}
    />
  );
};

/**
 * Markdown element styles. This project is pinned to Tailwind v3 without the
 * typography plugin, and Tailwind's preflight strips list markers and heading
 * sizes, so every element a model commonly emits needs its classes spelled out.
 */
const MARKDOWN_COMPONENTS: NonNullable<MarkdownTextPrimitiveProps["components"]> = {
  p: ({ node, ...props }) => <p className="mb-2.5 whitespace-pre-wrap last:mb-0" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  ul: ({ node, ...props }) => <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
  ol: ({ node, ...props }) => <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
  li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
  h1: ({ node, ...props }) => <h1 className="mb-2 mt-3 text-lg font-semibold first:mt-0" {...props} />,
  h2: ({ node, ...props }) => <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props} />,
  h3: ({ node, ...props }) => <h3 className="mb-1.5 mt-2.5 text-[15px] font-semibold first:mt-0" {...props} />,
  a: ({ node, ...props }) => (
    <a className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote className="mb-2.5 border-l-2 border-border pl-3 text-muted-foreground last:mb-0" {...props} />
  ),
  hr: ({ node, ...props }) => <hr className="my-3 border-border" {...props} />,
  // remark-gfm tables arrive unstyled and would otherwise collapse into a wall.
  table: ({ node, ...props }) => (
    <div className="mb-2.5 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => <th className="border border-border px-2 py-1 text-left font-semibold" {...props} />,
  td: ({ node, ...props }) => <td className="border border-border px-2 py-1 align-top" {...props} />,
  // Fenced blocks reach this through assistant-ui's code-block override, which
  // merges the element's own (empty) className into the props — so the class
  // list is composed last, not spread over.
  pre: ({ node, className, ...props }) => (
    <pre
      {...props}
      className={cn(
        "mb-2.5 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed last:mb-0",
        className
      )}
    />
  ),
  code: MarkdownCode,
};

const TextPart: FC<TextMessagePartProps> = () => (
  <MarkdownTextPrimitive
    remarkPlugins={[remarkGfm]}
    components={MARKDOWN_COMPONENTS}
    className="leading-relaxed"
  />
);

/** Collapsible reasoning ("thinking") block, collapsed while streaming. */
const ReasoningPart: FC<ReasoningMessagePartProps> = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
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

/** Tool call chip; expands to the complete JSON arguments. */
const ToolCallPart: FC<DataMessagePartProps<ToolCallData>> = ({ data: raw }) => {
  const [open, setOpen] = useState(false);
  const data = raw ?? { name: "tool", args: null };
  const args = prettyArgs(data.args);
  return (
    <div className="my-1 flex w-full flex-col items-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Wrench className="size-3 shrink-0" aria-hidden />
        {data.name}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-80 w-full overflow-auto rounded-md border border-border bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
          {args || "no arguments"}
        </pre>
      )}
    </div>
  );
};

/** Tool result card; open by default, collapsible once the run gets long. */
const ToolResultPart: FC<DataMessagePartProps<ToolResultData>> = ({ data: raw }) => {
  const [open, setOpen] = useState(true);
  const data = raw ?? { content: "", isError: false };
  return (
    <div className="my-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted",
          data.isError ? "text-destructive" : "text-muted-foreground"
        )}
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        {data.isError ? "Error result" : "Result"}
      </button>
      {open && (
        <div
          className={cn(
            "mt-1.5 max-w-full whitespace-pre-wrap rounded-md border px-2.5 py-1.5 text-xs leading-relaxed",
            data.isError
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground"
          )}
        >
          {data.content}
        </div>
      )}
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

const AssistantMessage: FC<{ depth?: number }> = ({ depth = 0 }) => (
  <MessagePrimitive.Root
    className={cn(
      "flex w-full flex-col justify-start py-2",
      // Subagent output is indented under the main thread so a nested run reads
      // as a branch of the conversation rather than as the assistant itself.
      depth > 0 && "border-l-2 border-border pl-3"
    )}
  >
    {depth > 0 && (
      <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-accent/60 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
        <Bot className="size-3" aria-hidden />
        Subagent · depth {depth}
      </div>
    )}
    <div className="text-[15px] leading-relaxed text-foreground">
      <MessageParts />
    </div>
  </MessagePrimitive.Root>
);

/** Module scope: a stable identity keeps the thread's message list memoized. */
const renderThreadMessage = ({ message }: { message: MessageState }) =>
  message.role === "user" ? <UserMessage /> : <AssistantMessage depth={messageDepth(message)} />;

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

const Composer: FC = () => {
  // ↑/↓ recall previously sent prompts while the draft is empty.
  const inputHistory = unstable_useComposerInputHistory();
  return (
    <ComposerPrimitive.Root className="w-full rounded-2xl border border-border bg-card shadow-md shadow-black/[0.04] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10">
      <ComposerPrimitive.Input
        {...inputHistory}
        placeholder="Message hermes…  (/ for commands)"
        className="max-h-44 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] outline-none placeholder:text-muted-foreground/70"
        rows={1}
        autoFocus
      />
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="select-none text-[11px] text-muted-foreground/60">
          / commands · ↵ send · ⇧↵ newline
        </span>
        <ComposerActions />
      </div>
    </ComposerPrimitive.Root>
  );
};

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
        <ThreadPrimitive.Messages>{renderThreadMessage}</ThreadPrimitive.Messages>
      </div>
      <ThreadPrimitive.ViewportFooter className="sticky bottom-0 flex w-full flex-col items-center justify-end bg-gradient-to-t from-background from-60% to-transparent pb-4 pt-8">
        <ThreadScrollToBottomButton />
        {footerExtra}
        <Composer />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>
);
