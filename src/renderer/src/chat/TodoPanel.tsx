import type { Todo } from "@shared/wire";

const ICON: Record<Todo["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

export function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 text-sm font-semibold">📋 plan</div>
      <ul className="space-y-1 text-sm">
        {todos.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted-foreground">{ICON[t.status]}</span>
            <span
              className={t.status === "completed" ? "line-through text-muted-foreground" : ""}
            >
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}