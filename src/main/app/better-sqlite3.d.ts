/**
 * Minimal ambient types for better-sqlite3.
 *
 * The package ships no typings and `@types/better-sqlite3` is not a dependency
 * of this repo, while `skipLibCheck` hides the same gap in
 * `@langchain/langgraph-checkpoint-sqlite`. Only the surface `db.ts` uses is
 * declared here: adding a types package for one file would be a bigger
 * dependency than the code it describes.
 */
declare module "better-sqlite3" {
  interface Statement {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }

  class Database {
    constructor(path: string, options?: { readonly?: boolean; fileMustExist?: boolean });
    pragma(source: string): unknown;
    exec(source: string): Database;
    prepare(source: string): Statement;
    close(): void;
  }

  export = Database;
}
