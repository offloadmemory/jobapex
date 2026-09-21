import Database from "better-sqlite3";
import { appDbPath } from "../agent/paths.js";

/**
 * App-owned structured state: the thread index, provider rows, settings, and
 * the PIN hash. Agent-read state (skills, memory, identity, OpenWiki) stays
 * markdown on disk — this database only holds what the app itself reads.
 */
let db: Database | null = null;

/**
 * Lazy: importing this module must not touch the disk. Unit tests import the
 * main-process runtime (which reaches the provider store), and vitest replaces
 * better-sqlite3 with an inert stub — opening a file at import time would make
 * every such suite depend on the stub's shape.
 */
export function getDb(): Database {
  if (db) return db;
  const opened = new Database(appDbPath());
  opened.pragma("journal_mode = WAL");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS threads_updated_at ON threads (updatedAt DESC);
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      baseUrl TEXT,
      model TEXT NOT NULL,
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db = opened;
  return opened;
}
