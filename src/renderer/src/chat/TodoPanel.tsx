import type { Todo } from "@shared/wire";
import { Check, Circle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="mb-3 w-full rounded-xl border border-border bg-card/90 px-3.5 py-2.5 text-left shadow-sm">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Plan</span>
        <span className="text-muted-foreground/60">
          {done}/{todos.length} done
        </span>
      </div>
      <ul className="space-y-1">
        {todos.map((t) => (
          <li key={t.content} className="flex items-start gap-2 text-sm leading-snug">
            {t.status === "completed" ? (
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
            ) : t.status === "in_progress" ? (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                t.status === "completed" && "text-muted-foreground line-through",
                t.status === "in_progress" && "font-medium text-foreground"
              )}
            >
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}