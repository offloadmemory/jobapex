import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { buildAgent } from "../src/agent.js";
import { consolidateMemory } from "../src/memory/consolidate.js";
import { listNotes, readNote, slugify } from "../src/memory/store.js";
import { readMemory, writeMemory } from "../src/memory/tools.js";
import { memoryDir } from "../src/paths.js";
import { ChatOllama } from "@langchain/ollama";

const cfg = loadConfig(["--yolo"]);
const model = new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl, think: false });

const before = listNotes().length;
const n = await consolidateMemory(model, [
  { role: "user", content: "My name is Kartik and I prefer TypeScript over Python." },
  { role: "assistant", content: "Noted — I'll remember you prefer TypeScript." },
]);
const after = listNotes().length;
console.log(`notes written: ${n}; total before=${before} after=${after}`);
console.log("PASS" === (n > 0 && after > before ? "PASS" : "FAIL") ? "PASS" : "FAIL");

// read_memory with no arguments must return the index plus at least one note slug.
const index = await readMemory.invoke({});
console.log("read_memory index (first 400 chars):", index.slice(0, 400));
const slugs = listNotes().map((note) => note.slug);
const readOk = slugs.some((slug) => index.includes(slug));
console.log(readOk ? "PASS" : "FAIL");

// write_memory: the tool must write a note into the real store and read_memory must see it.
const wmTitle = "QA Validation Note!";
const wmSlug = slugify(wmTitle); // "qa-validation-note"
const wmResult = await writeMemory.invoke({ title: wmTitle, content: "write_memory round-trip works" });
const noteBody = readNote(wmSlug);
const wmOk = noteBody !== null && noteBody.includes("round-trip works") && wmResult.includes(wmSlug);
console.log("write_memory write:", wmOk ? "PASS" : `FAIL (result=${wmResult}, note=${noteBody})`);
const wmRead = await readMemory.invoke({ name: wmSlug });
const wmReadOk = wmRead.includes("round-trip works");
console.log("write_memory read-back:", wmReadOk ? "PASS" : "FAIL");
// Clean up so the user's real memory stays pristine.
fs.rmSync(path.join(memoryDir(), `${wmSlug}.md`), { force: true });

console.log("MEMORY_TEST_DONE — consolidation + read_memory index check + write_memory round-trip.");
