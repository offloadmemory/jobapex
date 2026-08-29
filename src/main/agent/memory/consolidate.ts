import { slugify, writeNote } from "./store.js";

const CONSOLIDATE_PROMPT = `You are a memory consolidator. Given a conversation, extract durable learnings worth remembering in a month: user preferences, decisions and their reasons, verified commands, and pitfalls with fixes. Ignore session trivia.

Return ONLY a JSON array of objects, each with "slug" (kebab-case), "title" (short), and "content" (1-3 sentences). If nothing is worth remembering, return [].`;

/** Run a cheap consolidation call and append durable learnings to memory. */
export async function consolidateMemory(model: any, messages: any[]): Promise<number> {
  const res = await model.invoke([
    { role: "system", content: CONSOLIDATE_PROMPT },
    ...messages.slice(-12), // last 12 messages is enough context
  ]);
  const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return 0;
  let items: { slug?: string; title?: string; content?: string }[];
  try {
    items = JSON.parse(match[0]);
  } catch {
    return 0;
  }
  let written = 0;
  for (const it of items) {
    if (!it?.content) continue;
    const slug = slugify(it.slug ?? it.title ?? `note-${written}`);
    if (!slug) continue; // punctuation-only input slugifies to "" — no ".md" file
    writeNote({
      slug,
      title: it.title ?? "Note",
      content: it.content,
    });
    written++;
  }
  return written;
}
