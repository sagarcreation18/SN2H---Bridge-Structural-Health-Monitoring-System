import "dotenv/config";
import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
const db = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
});
try {
  for (const file of ["schema.sql", "seed.sql", "features.sql", "advanced.sql"])
    await db.query(await readFile(new URL(file, import.meta.url), "utf8"));
  console.log("Schema and seeds ready.");
} finally {
  await db.end();
}
