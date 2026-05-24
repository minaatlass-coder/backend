import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedVersions(): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  return new Set(rows.map((r) => r.version));
}

export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  await ensureMigrationsTable();
  const done = await appliedVersions();

  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    if (done.has(file)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  console.log("[migrate] up to date");
}
