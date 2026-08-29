import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string" ? block : ((block as { text?: string }).text ?? "")
      )
      .join("\n");
  }
  return JSON.stringify(content);
}

/**
 * Compatibility shim for @langchain/ollama, which rejects ToolMessages whose
 * content is an array of content blocks ("Non string tool message content is
 * not supported"). Deep Agents' filesystem tools emit block content, so we
 * flatten it to plain text right before each model call.
 *
 * Must be attached to the main agent AND to every custom subagent (custom
 * subagents do not inherit the main agent's middleware).
 */
export const ollamaToolContentShim = createMiddleware({
  name: "OllamaToolContentShim",
  wrapModelCall: async (request, handler) => {
    const messages = request.messages.map((m) => {
      if (m.getType() === "tool" && typeof m.content !== "string") {
        const t = m as ToolMessage;
        return new ToolMessage({
          content: flattenContent(t.content),
          tool_call_id: t.tool_call_id,
          name: t.name,
          status: t.status,
          id: t.id,
        });
      }
      return m;
    });
    return handler({ ...request, messages });
  },
});
