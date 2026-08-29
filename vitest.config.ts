import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      // better-sqlite3 is rebuilt for Electron's ABI (npm run rebuild:native),
      // so system-node vitest must not load the real binding. Stub it for unit
      // tests, which never touch the checkpointer database.
      "better-sqlite3": resolve("scripts/testing/better-sqlite3-stub.mjs"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // Checkpoint-sqlite imports better-sqlite3 through Node's own loader, so it
    // must be inlined (vite-processed) for the alias above to intercept it.
    server: { deps: { inline: ["@langchain/langgraph-checkpoint-sqlite"] } },
  },
});