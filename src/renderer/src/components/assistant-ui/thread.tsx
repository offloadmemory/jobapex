import { FC, type ReactNode } from "react";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Minimal hand-written Thread UI (assistant-ui registry fallback).
 *
 * The shadcn registry items for assistant-ui (`npx shadcn add
 * @assistant-ui/thread`) depend on Tailwind v4 tooling (`tw-shimmer` requires
 * `tailwindcss >= 4`), which conflicts with this project's pinned Tailwind v3.
 * This file is the faithful subset instead: viewport + message list +
 * composer, styled with our shadcn theme tokens.
 *
 * Must be mounted inside an `AssistantRuntimeProvider`. The runtime itself is
 * wired up in Task 8 (ChatView).
 */

const ErrorMessage: FC = () => (
  <div className="mt-1 w-full rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
    <MessagePrimitive.Error />
  </div>
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root className="flex w-full flex-col py-2">
    <div className="flex w-full justify-end">
      <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-sm leading-relaxed text-primary-foreground">
        <MessagePrimitive.Parts />
      </div>
    </div>
    <ErrorMessage />
  </MessagePrimitive.Root>
);

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className="flex w-full flex-col py-2">
    <div className="flex w-full justify-start">
      <div className="max-w-[80%] text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts />
      </div>
    </div>
    <ErrorMessage />
  </MessagePrimitive.Root>
);

const ComposerInput: FC = () => (
  <ComposerPrimitive.Input
    placeholder="Message..."
    className="max-h-40 w-full resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
    rows={1}
    autoFocus
  />
);

const ComposerActions: FC = () => (
  <div className="flex items-center gap-1 p-2">
    <ThreadPrimitive.If running={false}>
      <ComposerPrimitive.Send asChild>
        <Button size="sm" className="h-8 px-3">
          Send
        </Button>
      </ComposerPrimitive.Send>
    </ThreadPrimitive.If>
    <ThreadPrimitive.If running>
      <ComposerPrimitive.Cancel asChild>
        <Button size="sm" variant="outline" className="h-8 px-3">
          Stop
        </Button>
      </ComposerPrimitive.Cancel>
    </ThreadPrimitive.If>
  </div>
);

const Composer: FC = () => (
  <ComposerPrimitive.Root className="flex w-full items-end rounded-lg border border-border bg-card px-2 pt-2 shadow-sm transition-colors focus-within:border-ring">
    <ComposerInput />
    <ComposerActions />
  </ComposerPrimitive.Root>
);

const ThreadScrollToBottomButton: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <Button
      variant="ghost"
      size="icon"
      className="mb-1 rounded-full shadow-sm"
      aria-label="Scroll to bottom"
    >
      <ArrowDown className="size-4" />
    </Button>
  </ThreadPrimitive.ScrollToBottom>
);

export const Thread: FC<{ children?: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <ThreadPrimitive.Root
    className={cn(
      "flex h-full flex-col items-center overflow-hidden bg-background px-4",
      className
    )}
  >
    <ThreadPrimitive.Viewport className="flex w-full max-w-[44rem] grow flex-col items-center overflow-y-scroll scroll-smooth pt-8">
      {children}
      <ThreadPrimitive.Empty>
        <div className="flex grow flex-col items-center justify-center gap-2 text-muted-foreground">
          <p className="text-sm">No messages yet — say something to get started.</p>
        </div>
      </ThreadPrimitive.Empty>
      <div className="flex w-full flex-col items-center">
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </div>
      <ThreadPrimitive.ViewportFooter className="sticky bottom-0 flex w-full flex-col items-center justify-end rounded-t-lg bg-background pb-4">
        <ThreadScrollToBottomButton />
        <Composer />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>
);