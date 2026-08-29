/**
 * Vitest-only stub for better-sqlite3.
 *
 * `npm run rebuild:native` compiles better-sqlite3 for Electron's ABI, which
 * makes the real module unloadable from system-node processes — including the
 * vitest runner. Renderer-chat and stream-event unit tests never touch the
 * checkpointer database, so replace the binding with an inert stub instead of
 * maintaining two ABI builds.
 */
export default class Database {
  exec() {}
  pragma() {
    return [];
  }
  prepare() {
    return {
      run() {
        return { changes: 0 };
      },
      get() {
        return undefined;
      },
      all() {
        return [];
      },
      iterate() {
        return [][Symbol.iterator]();
      },
    };
  }
  transaction(fn) {
    return fn;
  }
  close() {}
}