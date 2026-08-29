/**
 * Deterministic UI checks — no model, no daemon. Section 1 drives UIStore
 * with realistic chunk shapes (mirroring render.ts's doc comments and
 * gate-dual-check.ts); section 2 renders components via ink-testing-library.
 */
import { createElement } from "react";
import type { ComponentType } from "react";
import type { HITLRequest, HITLResponse } from "langchain";
import { parseChunk } from "../src/stream-events.js";
import { UIStore, type ApprovalState } from "../src/ui/store.js";
import { App } from "../src/ui/App.js";
import { matchThreadPrefix } from "../src/ui/resume.js";
import { Header } from "../src/ui/components/Header.js";
import { ApprovalCard } from "../src/ui/components/ApprovalCard.js";
import { InputBox } from "../src/ui/components/InputBox.js";
import { TodoPanel } from "../src/ui/components/TodoPanel.js";
import { TranscriptEntryView } from "../src/ui/components/TranscriptEntryView.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

/** Feed a raw stream chunk through the exact seam: parseChunk → store.consume. */
function feed(store: UIStore, chunk: unknown): void {
  for (const ev of parseChunk(chunk)) store.consume(ev);
}

const tokenChunk = (msg: Record<string, unknown>): unknown => [
  ["model_request:x"],
  "messages",
  [msg, {}],
];
// Same, but one tools:<id> segment deep — a subagent's tokens (depth 1).
const subTokenChunk = (msg: Record<string, unknown>): unknown => [
  ["tools:sub1", "model_request:x"],
  "messages",
  [msg, {}],
];
const updateChunk = (node: string, body: Record<string, unknown>): unknown => [
  [],
  "updates",
  { [node]: body },
];

// ---------------------------------------------------------------- Section 1: store
console.log("\n== store ==");

{
  const store = new UIStore();
  // Thinking token, then answer tokens — must land in live, not entries.
  feed(store, tokenChunk({ type: "ai", content: "", additional_kwargs: { reasoning_content: "pondering" } }));
  feed(store, tokenChunk({ type: "ai", content: "Hello" }));
  feed(store, tokenChunk({ type: "ai", content: " world" }));
  check("tokens stay live (no entries yet)", store.entries.length === 0);
  check("live accumulates thinking", store.live?.thinking === "pondering");
  check("live accumulates text", store.live?.text === "Hello world");
  check("live records depth", store.live?.depth === 0);

  // ai tool_call update flushes live and logs the tool.
  feed(store, updateChunk("model", {
    messages: [{ type: "ai", content: "", tool_calls: [{ name: "execute", args: { command: "ls" } }] }],
  }));
  check("flushLive on tool_call → thinking entry first",
    store.entries[0]?.kind === "thinking" && store.entries[0]?.text === "pondering", store.entries);
  check("flushLive → assistant entry after thinking",
    store.entries[1]?.kind === "assistant" && store.entries[1]?.text === "Hello world");
  check("tool entry logged with args",
    store.entries[2]?.kind === "tool" && store.entries[2]?.text.includes("execute")
      && store.entries[2]?.text.includes("ls"));
  check("live cleared after flush", store.live === null);

  // write_todos tool call is skipped (rendered from state instead).
  feed(store, updateChunk("model", {
    messages: [{ type: "ai", content: "", tool_calls: [{ name: "write_todos", args: { todos: [] } }] }],
  }));
  check("write_todos skipped",
    !store.entries.some((e) => e.kind === "tool" && e.text.includes("write_todos")));

  // Erroring tool message → toolResult with isError.
  feed(store, updateChunk("tools", {
    messages: [{ type: "tool", content: "boom", status: "error" }],
  }));
  const errEntry = store.entries.find((e) => e.kind === "toolResult");
  check("toolResult isError flag set", errEntry?.isError === true, errEntry);

  // task tool_call → delegate entry.
  feed(store, updateChunk("model", {
    messages: [{
      type: "ai",
      content: "",
      tool_calls: [{ name: "task", args: { subagent_type: "researcher", description: "dig up facts" } }],
    }],
  }));
  const del = store.entries.find((e) => e.kind === "delegate");
  check("delegate entry from task tool", del?.text === "delegate → researcher — dig up facts", del);

  // update.todos → panel state.
  feed(store, updateChunk("tools", { todos: [
    { content: "step one", status: "pending" },
    { content: "step two", status: "in_progress" },
  ] }));
  check("todos consumed from update",
    store.todos.length === 2 && store.todos[1]?.status === "in_progress", store.todos);

  // "Updated todo list" tool result is skipped.
  const before = store.entries.length;
  feed(store, updateChunk("tools", {
    messages: [{ type: "tool", content: "Updated todo list: 2 items" }],
  }));
  check("Updated todo list result skipped", store.entries.length === before);
}

{
  const store = new UIStore();
  // Streamed prose stays live until the end-of-run flush.
  feed(store, tokenChunk({ type: "ai", content: "final answer" }));
  check("prose still live before flush", store.entries.length === 0);
  store.flushLive();
  check("flushLive produces an assistant entry",
    store.entries.length === 1 && store.entries[0]?.kind === "assistant"
      && store.entries[0]?.text === "final answer");
  check("second flush is a no-op", store.entries.length === 1);
}

{
  // Tokens crossing a depth boundary flush the live block first (render.ts
  // re-indents on depth transitions, so the two sides can't share an entry).
  const store = new UIStore();
  feed(store, tokenChunk({ type: "ai", content: "top-level words" }));
  feed(store, subTokenChunk({ type: "ai", content: "subagent words" }));
  check("depth change flushes the first live block",
    store.entries.length === 1 && store.entries[0]?.depth === 0
      && store.entries[0]?.text === "top-level words", store.entries);
  check("fresh live block opened at the new depth",
    store.live?.depth === 1 && store.live?.text === "subagent words", store.live);
  store.flushLive();
  check("flushed entries carry depths [0, 1]",
    store.entries.length === 2
      && store.entries.map((e) => e.depth).join(",") === "0,1", store.entries);
}

{
  // Same-depth tokens must NOT split — only depth changes break the block.
  const store = new UIStore();
  feed(store, tokenChunk({ type: "ai", content: "still " }));
  feed(store, tokenChunk({ type: "ai", content: "one line" }));
  check("same-depth tokens share one live block",
    store.entries.length === 0 && store.live?.text === "still one line", store.entries);
}

{
  // Fake interrupt → approval state; resolve completes the promise.
  const store = new UIStore();
  const request = {
    actionRequests: [{ name: "execute", args: { command: "echo hi" } }],
  } as unknown as HITLRequest;
  let resolveRef!: (r: HITLResponse) => void;
  const pending = new Promise<HITLResponse>((r) => (resolveRef = r));
  // Same wrapper the entry installs: resolve clears the card and resumes
  // streaming before handing the decision to agent-runner.
  store.approval = {
    request,
    resolve: (resp) => {
      store.approval = null;
      store.setStatus("streaming");
      resolveRef(resp);
    },
  };
  store.setStatus("approval");
  check("approval stored",
    store.approval?.request === (request as unknown) && store.status === "approval");
  store.approval.resolve({ decisions: [{ type: "approve" }] } as HITLResponse);
  const out = await pending;
  check("approval resolves with decisions", out.decisions.length === 1, out);
  check("approval cleared, status back to streaming",
    store.approval === null && store.status === "streaming");
}

// ---------------------------------------------------------------- Section 2: components
console.log("\n== components ==");

const { render } = await import("ink-testing-library");

async function frame(component: ComponentType<never>, props: Record<string, unknown>): Promise<string> {
  const instance = render(createElement(component as never, props as never));
  await new Promise((r) => setTimeout(r, 30)); // let ink commit a frame
  const last = instance.lastFrame() ?? "";
  instance.unmount();
  return last;
}

{
  const last = await frame(TodoPanel, { todos: [
    { content: "pending thing", status: "pending" },
    { content: "active thing", status: "in_progress" },
    { content: "done thing", status: "completed" },
  ] });
  check("TodoPanel header", last.includes("📋 plan"), last);
  check("TodoPanel lists todos", last.includes("pending thing") && last.includes("done thing"));
  check("TodoPanel icons", last.includes("○") && last.includes("◐") && last.includes("●"));
}
{
  const last = await frame(TodoPanel, { todos: [] });
  check("TodoPanel hidden when empty", !last.includes("plan"), last);
}
{
  const last = await frame(TranscriptEntryView, { entry: { id: 1, kind: "user", text: "hi there", depth: 0 } });
  check("user entry prompt marker", last.includes("❯") && last.includes("hi there"), last);
}
{
  const last = await frame(TranscriptEntryView, { entry: { id: 2, kind: "tool", text: 'execute {"command":"ls"}', depth: 0 } });
  check("tool entry wrench + name", last.includes("🔧") && last.includes("execute"), last);
}
{
  const last = await frame(TranscriptEntryView, { entry: { id: 3, kind: "toolResult", text: "boom", depth: 0, isError: true } });
  check("error toolResult mark", last.includes("✗") && last.includes("boom"), last);
}
{
  const last = await frame(InputBox, { disabled: false, history: [] });
  check("InputBox placeholder", last.includes("ask hermes anything"), last);
  check("InputBox bordered prompt", last.includes("❯"), last);
}
{
  const last = await frame(InputBox, { disabled: true, history: [] });
  check("disabled InputBox hides placeholder", !last.includes("ask hermes anything"), last);
}
{
  const last = await frame(Header, {
    model: "glm-5.2:cloud",
    baseUrl: "http://localhost:11434",
    workspaceDir: "/tmp/ws",
    memfs: false,
    yolo: false,
    threadId: "12345678-aaaa",
  });
  check("Header brand", last.includes("✻ hermes"), last);
  check("Header model line", last.includes("glm-5.2:cloud") && last.includes("http://localhost:11434"), last);
  check("Header filesystem line", last.includes("/tmp/ws"), last);
  check("Header thread id (first 8)", last.includes("12345678"), last);
}

// ------------------------------------------------- Section 3: approval card
console.log("\n== approval card ==");

const wait = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

const execRequest = (commands: string[]): HITLRequest =>
  ({
    actionRequests: commands.map((command) => ({ name: "execute", args: { command } })),
  }) as unknown as HITLRequest;

{
  // y approves ONLY the current action and advances; the second y resolves.
  const responses: HITLResponse[] = [];
  const approval: ApprovalState = {
    request: execRequest(["ls", "rm -rf /"]),
    resolve: (r) => responses.push(r),
  };
  const instance = render(createElement(ApprovalCard, { approval }));
  await wait();
  let frame = instance.lastFrame() ?? "";
  check("card shows first command", frame.includes("ls"), frame);
  check("bulk hint shown with count for 2 remaining",
    frame.includes("[a] allow all remaining (2 commands)"), frame);
  instance.stdin.write("y");
  await wait();
  frame = instance.lastFrame() ?? "";
  check("y advances instead of resolving", responses.length === 0, responses);
  check("card shows second command after y", frame.includes("rm -rf"), frame);
  check("bulk hint hidden for last action", !frame.includes("allow all remaining"), frame);
  instance.stdin.write("n");
  await wait();
  instance.stdin.write("\r");
  await wait();
  check("resolve-once after every action decided", responses.length === 1, responses);
  check("decisions match actionRequests one-to-one",
    responses[0]?.decisions.length === 2 && responses[0]?.decisions[0]?.type === "approve"
      && responses[0]?.decisions[1]?.type === "reject", responses);
  instance.unmount();
}
{
  // a bulk-approves all remaining actions in one shot.
  const responses: HITLResponse[] = [];
  const approval: ApprovalState = {
    request: execRequest(["a", "b", "c"]),
    resolve: (r) => responses.push(r),
  };
  const instance = render(createElement(ApprovalCard, { approval }));
  await wait();
  check("bulk hint shows count for 3 remaining",
    (instance.lastFrame() ?? "").includes("[a] allow all remaining (3 commands)"),
    instance.lastFrame());
  instance.stdin.write("a");
  await wait(50);
  check("a resolves once with all approves",
    responses.length === 1 && responses[0]?.decisions.length === 3
      && responses[0]?.decisions.every((d) => d.type === "approve"), responses);
  instance.unmount();
}
{
  // Single action: no bulk hint, and `a` is inert — y still approves it.
  const responses: HITLResponse[] = [];
  const approval: ApprovalState = { request: execRequest(["echo only"]), resolve: (r) => responses.push(r) };
  const instance = render(createElement(ApprovalCard, { approval }));
  await wait();
  check("no bulk hint for single action",
    !(instance.lastFrame() ?? "").includes("allow all remaining"), instance.lastFrame());
  instance.stdin.write("a");
  await wait(50);
  check("a does nothing with one action left", responses.length === 0, responses);
  instance.stdin.write("y");
  await wait(50);
  check("y resolves a single action immediately",
    responses.length === 1 && responses[0]?.decisions.length === 1
      && responses[0]?.decisions[0]?.type === "approve", responses);
  instance.unmount();
}

// ------------------------------------------------- Section 4: App render
console.log("\n== app ==");

const appProps = {
  model: "glm-5.2:cloud",
  baseUrl: "http://localhost:11434",
  workspaceDir: "/tmp/ws",
  memfs: false,
  yolo: false,
  threadId: "12345678-aaaa",
  history: [] as string[],
  onSubmit: () => {},
  onCancel: () => {},
  onExit: () => {},
};
const appFrame = async (store: UIStore) => {
  const instance = render(createElement(App, { ...appProps, store }));
  await wait();
  return instance;
};
{
  const store = new UIStore();
  store.addEntry("user", "first user message");
  store.addEntry("system", "system line from the store");
  store.setTodos([{ content: "app-level todo", status: "in_progress" }]);
  const instance = await appFrame(store);
  const first = instance.lastFrame() ?? "";
  check("App renders user entry", first.includes("❯") && first.includes("first user message"), first);
  check("App renders system entry", first.includes("system line from the store"), first);
  check("App renders todo panel", first.includes("app-level todo"), first);
  // Regression for the copy-on-write fix: <Static> memoizes on array identity,
  // so an entry added after mount must still show up in a later frame.
  store.addEntry("assistant", "post-mount entry appears");
  await wait();
  check("App renders entry added after mount", (instance.lastFrame() ?? "").includes("post-mount entry appears"), instance.lastFrame());
  instance.unmount();
}
{
  // An open approval surfaces the card in the app frame.
  const store = new UIStore();
  const approval: ApprovalState = {
    request: execRequest(["echo hi"]),
    resolve: () => {},
  };
  store.approval = approval;
  store.setStatus("approval");
  const instance = await appFrame(store);
  const last = instance.lastFrame() ?? "";
  check("App renders open approval", last.includes("approval needed") && last.includes("echo hi"), last);
  instance.unmount();
}

// ------------------------------------------------- Section 5: /resume prefix
console.log("\n== /resume prefix match ==");

const threadIds = [
  "3fa9c1a2-1111-4aaa-8ccc-000000000001",
  "3fa9c1a2-1111-4aaa-8ccc-000000000002",
  "9b2e77d0-2222-4bbb-9ddd-000000000003",
];
{
  const full = threadIds[0] as string;
  const exact = matchThreadPrefix(threadIds, full);
  check("exact id wins over prefix rules",
    exact.kind === "exact" && exact.id === full, exact);
  const unique = matchThreadPrefix(threadIds, "9b2e");
  check("unique prefix resolves to full id",
    unique.kind === "unique" && unique.id === threadIds[2], unique);
  const none = matchThreadPrefix(threadIds, "deadbeef");
  check("no match reported", none.kind === "none", none);
  const ambiguous = matchThreadPrefix(threadIds, "3fa9");
  check("shared prefix is ambiguous with a count",
    ambiguous.kind === "ambiguous" && ambiguous.count === 2, ambiguous);
  // The empty arg never reaches the matcher (usage message in index.tsx),
  // but an empty string would prefix-match everything — guard the shape anyway.
  check("empty string prefix-matches everything",
    matchThreadPrefix(threadIds, "").kind === "ambiguous", matchThreadPrefix(threadIds, ""));
}

// ------------------------------------------------- Section 6: double-Ctrl+C
console.log("\n== double-ctrl+c ==");

{
  // Idle first press shows an inline hint; any other key disarms; a second
  // press inside the 2s window exits. onExit is a spy — nothing actually quits.
  const store = new UIStore();
  let exits = 0;
  const instance = render(createElement(App, {
    ...appProps,
    store,
    onExit: () => {
      exits++;
    },
  }));
  await wait();
  instance.stdin.write("\x03");
  await wait();
  check("first idle Ctrl+C shows the exit hint",
    (instance.lastFrame() ?? "").includes("press ctrl+c again to exit"), instance.lastFrame());
  instance.stdin.write("x");
  await wait();
  check("other keypress disarms the hint",
    exits === 0 && !(instance.lastFrame() ?? "").includes("press ctrl+c again"),
    instance.lastFrame());
  instance.stdin.write("\x03");
  await wait();
  instance.stdin.write("\x03");
  await wait(50);
  check("second Ctrl+C inside the window exits",
    exits === 1 && !(instance.lastFrame() ?? "").includes("press ctrl+c again"),
    { exits, frame: instance.lastFrame() });
  instance.unmount();
}
{
  // Streaming keeps the old behavior: Ctrl+C cancels, never exits.
  const store = new UIStore();
  store.setStatus("streaming");
  let exits = 0;
  let cancels = 0;
  const instance = render(createElement(App, {
    ...appProps,
    store,
    onExit: () => {
      exits++;
    },
    onCancel: () => {
      cancels++;
    },
  }));
  await wait();
  instance.stdin.write("\x03");
  await wait();
  check("Ctrl+C while streaming cancels instead of exiting", exits === 0 && cancels === 1, { exits, cancels });
  instance.unmount();
}

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${passed} passed, ${failed} failed`);
console.log("UI_TEST_DONE");
if (failed > 0) process.exit(1);