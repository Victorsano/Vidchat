import { readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
export type Result<T = Record<string, any>> = { rows: T[]; rowCount: number };
export interface Database {
  query<T = Record<string, any>>(
    text: string,
    values?: any[],
  ): Promise<Result<T>>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
function postgres(pool: Pool, client?: PoolClient): Database {
  return {
    async query(text, values = []) {
      const r = await (client || pool).query(text, values);
      return { rows: r.rows, rowCount: r.rowCount || 0 };
    },
    async transaction(fn) {
      if (client) return fn(postgres(pool, client));
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(postgres(pool, c));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      if (!client) await pool.end();
    },
  };
}
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = await tx.query(
      "SELECT version FROM schema_migrations WHERE version=$1",
      ["001_core"],
    );
    if (!done.rowCount) {
      await tx.query(
        await readFile(
          path.join(process.cwd(), "migrations/001_core.sql"),
          "utf8",
        ),
      );
      await tx.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        "001_core",
      ]);
    }
  });
}
export async function embedded(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const engine = new PGlite(dataDir);
  const wrap = (p: any): Database => ({
    async query(text, values = []) {
      if (!values.length && text.includes(";")) {
        const results = await p.exec(text);
        const r = results.at(-1);
        return { rows: r?.rows || [], rowCount: r?.affectedRows || 0 };
      }
      const r = await p.query(text, values);
      return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
    },
    transaction: (fn) => p.transaction((t: any) => fn(wrap(t))),
    close: () => engine.close(),
  });
  const db = wrap(engine);
  await migrate(db);
  return db;
}
const globalDb = globalThis as unknown as { dorcasDb?: Promise<Database> };
export function getDb() {
  return (globalDb.dorcasDb ??= (async () => {
    if (process.env.DATABASE_URL) {
      return postgres(
        new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 8,
          connectionTimeoutMillis: 10000,
          statement_timeout: 10000,
        }),
      );
    }
    if (process.env.NODE_ENV === "production")
      throw new Error("DATABASE_URL is required in production");
    return embedded(
      process.env.DEV_DB_DIR ||
        path.join(
          tmpdir(),
          "dorcas-dev-" +
            createHash("sha256")
              .update(process.cwd())
              .digest("hex")
              .slice(0, 12),
        ),
    );
  })());
}
