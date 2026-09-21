import { describe, expect, it } from "vitest";

import { COMMAND_HELP, parseSlashCommand } from "./commands";

describe("parseSlashCommand", () => {
  it("ignores prose", () => {
    expect(parseSlashCommand("hey, what's up?")).toBeNull();
    expect(parseSlashCommand("  ")).toBeNull();
  });

  it("maps navigation commands onto pages", () => {
    expect(parseSlashCommand("/memory")).toEqual({ kind: "navigate", nav: "memory" });
    expect(parseSlashCommand("/THREADS")).toEqual({ kind: "navigate", nav: "threads" });
    expect(parseSlashCommand("/todos")).toEqual({ kind: "navigate", nav: "chat" });
  });

  it("tolerates trailing arguments and whitespace", () => {
    expect(parseSlashCommand("  /skills now please  ")).toEqual({
      kind: "navigate",
      nav: "skills",
    });
  });

  it("treats /reset as a new thread and /help as the command list", () => {
    expect(parseSlashCommand("/reset")).toEqual({ kind: "newThread" });
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
  });

  it("navigates to the workspace on /files and reports anything else as unknown", () => {
    expect(parseSlashCommand("/files")).toEqual({ kind: "navigate", nav: "files" });
    expect(parseSlashCommand("/nope")).toEqual({ kind: "unknown", name: "/nope" });
  });

  it("documents every command it answers", () => {
    for (const spec of [
      "/todos",
      "/threads",
      "/skills",
      "/memory",
      "/files",
      "/settings",
      "/reset",
      "/help",
    ]) {
      expect(COMMAND_HELP).toContain(spec);
    }
  });
});
