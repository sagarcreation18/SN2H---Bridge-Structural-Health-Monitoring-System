// One-time provisioning for the isolated development instance, never the existing service.
import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3307,
  user: "root",
});
try {
  const password = randomBytes(32).toString("hex"),
    rootPassword = randomBytes(32).toString("hex");
  await db.query(
    "CREATE USER IF NOT EXISTS 'bridge_app'@'localhost' IDENTIFIED BY ?",
    [password],
  );
  await db.query("ALTER USER 'bridge_app'@'localhost' IDENTIFIED BY ?", [
    password,
  ]);
  await db.query(
    "GRANT ALL PRIVILEGES ON bridge_health_monitor.* TO 'bridge_app'@'localhost'",
  );
  await db.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [
    rootPassword,
  ]);
  const env = await readFile(".env", "utf8");
  await writeFile(
    ".env",
    env
      .replace("DB_USER=root", "DB_USER=bridge_app")
      .replace(/^DB_PASSWORD=.*$/m, "DB_PASSWORD=" + password),
  );
  await writeFile(".runtime/mysql-admin-password.txt", rootPassword);
  console.log("Isolated database secured; app account written to .env.");
} finally {
  await db.end();
}
