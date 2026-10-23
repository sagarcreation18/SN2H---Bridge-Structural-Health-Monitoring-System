import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
export async function migrateFeatures() {
  for (const file of ["features.sql", "advanced.sql"]) {
    const sql = await readFile(
      new URL("../database/" + file, import.meta.url),
      "utf8",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await pool.query(statement);
  }
  await pool.query(
    "UPDATE demo_runs SET state='interrupted',ended_at=UTC_TIMESTAMP(3) WHERE state='running'",
  );
}
