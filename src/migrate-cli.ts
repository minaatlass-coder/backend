import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";

runMigrations()
  .then(() => pool.end())
  .catch((e) => {
    console.error("[migrate] failed", e);
    process.exit(1);
  });
