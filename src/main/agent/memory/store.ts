import fs from "node:fs";
import path from "node:path";
import type { NoteInfo } from "../../../shared/wire.js";
import { memoryDir } from "../paths.js";

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export interface MemoryNote {
  slug: string;
  title: string;
  content: string;
  /** Rename: the note is written under `slug` and the old file is unlinked. */
  previousSlug?: string;
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

/** index.md is what the agent reads first: it must never link a file that is gone. */
function writeIndex(notes: MemoryNote[]): void {
  const index = notes.map((n) => `- [${n.title}](${n.slug}.md)`).join("\n") + "\n";
  fs.writeFileSync(path.join(memoryDir(), "index.md"), index);
}

/** Append-or-replace a note by slug; keeps index.md current (one line per note). */
export function writeNote(note: MemoryNote): void {
  fs.writeFileSync(notePath(note.slug), `# ${note.title}\n\n${note.content}\n`);

  // A rename must not orphan the old file: listNotes would keep surfacing it and
  // index.md would keep linking a note the user renamed away from.
  const previous = note.previousSlug;
  if (previous !== undefined && previous !== note.slug) {
    const old = notePath(previous);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  writeIndex(listNotes());
}

/** Remove a note and drop it from index.md. False when it was already absent. */
export function deleteNote(slug: string): boolean {
  if (!fs.existsSync(notePath(slug))) return false;
  fs.unlinkSync(notePath(slug));
  writeIndex(listNotes());
  return true;
}

/** List shape for the Memory view: the note's mtime is its last-write time. */
export function toNoteInfos(notes: MemoryNote[]): NoteInfo[] {
  const dir = memoryDir();
  return notes.map((note) => {
    const file = path.join(dir, `${note.slug}.md`);
    return {
      slug: note.slug,
      title: note.title,
      updatedAt: fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0,
    };
  });
}

export function searchNotes(query: string): MemoryNote[] {
  const q = query.toLowerCase();
  return listNotes().filter(
    (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );
}
