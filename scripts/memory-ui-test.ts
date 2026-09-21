/**
 * Live test of the Memory surface: write a note the way the Memory view's dialog
 * does, then assert the list, the search path and the preview the view reads.
 *
 * Run: npm run memory:ui-test  (HOME is redirected there, see lib/isolated-home)
 */
import fs from "node:fs";
import path from "node:path";

import { requireIsolatedHome } from "./lib/isolated-home.js";
import {
  deleteNote,
  listNotes,
  readNote,
  searchNotes,
  toNoteInfos,
  writeNote,
} from "../src/main/agent/memory/store.js";
import { memoryDir } from "../src/main/agent/paths.js";

const home = requireIsolatedHome();

/** index.md is the agent's entry point into memory; it must track the notes. */
function readIndex(): string {
  return fs.readFileSync(path.join(memoryDir(), "index.md"), "utf8");
}

const slug = `memory-ui-test-${Date.now()}`;
const marker = "zebra-marker-9f3a";
const content = `# Preferences\n\n- Likes ${marker} briefs\n- Timezone: IST\n`;

writeNote({ slug, title: "Memory UI test", content });

const listed = toNoteInfos(listNotes());
const info = listed.find((note) => note.slug === slug);
if (!info) throw new Error("FAIL: the note just written is missing from memory:list");
if (info.title !== "Memory UI test") throw new Error(`FAIL: title "${info.title}" != the stored title`);
if (!(info.updatedAt > 0)) throw new Error("FAIL: updatedAt was not derived from the file");
console.log(`[list] ${listed.length} note(s); ${info.slug} — ${info.title}`);

const hits = toNoteInfos(searchNotes(marker));
if (!hits.some((note) => note.slug === slug)) {
  throw new Error("FAIL: searchNotes() did not match the note's content");
}
const misses = searchNotes("no-such-marker-zzz");
if (misses.some((note) => note.slug === slug)) throw new Error("FAIL: search matched an unrelated query");
console.log(`[search] "${marker}" → ${hits.length} hit(s); nonsense query → ${misses.length}`);

const read = readNote(slug);
if (read === null) throw new Error("FAIL: readNote() returned null for the note just written");
if (!read.includes(marker)) throw new Error(`FAIL: the preview lost the marker:\n${read}`);
console.log(`[read] ${read.length} bytes, marker present`);

// The view's dialog re-writes the same slug to edit a note.
const edited = `${content}\n- Edited\n`;
writeNote({ slug, title: "Memory UI test (edited)", content: edited });
const after = toNoteInfos(listNotes()).find((note) => note.slug === slug);
if (after?.title !== "Memory UI test (edited)") {
  throw new Error(`FAIL: editing the same slug did not take: "${after?.title}"`);
}
console.log("[edit] re-writing the same slug updated the note in place");

if (!readIndex().includes(`(${slug}.md)`)) {
  throw new Error("FAIL: index.md does not link the note");
}
console.log("[index] the note is linked from index.md");

// Pruning: what the Memory view's delete dialog runs.
if (!deleteNote(slug)) throw new Error("FAIL: deleteNote() reported the note as already absent");
if (readNote(slug) !== null) throw new Error("FAIL: the note file survived deleteNote()");
if (readIndex().includes(`(${slug}.md)`)) {
  throw new Error("FAIL: index.md still links the deleted note");
}
if (toNoteInfos(listNotes()).some((note) => note.slug === slug)) {
  throw new Error("FAIL: the deleted note is still listed");
}
if (deleteNote(slug)) throw new Error("FAIL: deleting a missing note must report false, not throw");
console.log("[delete] file removed, index.md regenerated, repeat delete is a no-op");

fs.rmSync(home, { recursive: true, force: true });
console.log("MEMORY_UI_TEST_DONE — write, list, search, preview, edit and delete all round-trip.");
process.exit(0);
