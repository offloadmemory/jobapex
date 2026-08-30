import fs from "node:fs";
import path from "node:path";
import { memoryDir } from "../paths.js";

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export interface MemoryNote {
  slug: string;
  title: string;
  content: string;
}

function notePath(slug: string): string {
  return path.join(memoryDir(), `${slug}.md`);
}

export function listNotes(): MemoryNote[] {
  const dir = memoryDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const title = raw.split("\n")[0]?.replace(/^#\s*/, "") ?? slug;
      return { slug, title, content: raw };
    });
}

export function readNote(slug: string): string | null {
  const p = notePath(slug);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** Append-or-replace a note by slug; keeps index.md current (one line per note). */
export function writeNote(note: MemoryNote): void {
  const dir = memoryDir();
  fs.writeFileSync(notePath(note.slug), `# ${note.title}\n\n${note.content}\n`);
  const notes = listNotes();
  const index = notes.map((n) => `- [${n.title}](${n.slug}.md)`).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "index.md"), index);
}

export function searchNotes(query: string): MemoryNote[] {
  const q = query.toLowerCase();
  return listNotes().filter(
    (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );
}
