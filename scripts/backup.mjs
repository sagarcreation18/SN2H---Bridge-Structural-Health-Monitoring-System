import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, unlink, rename, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export async function backup() {
  const dir = resolve(process.env.BACKUP_DIRECTORY || "output/backups");
  await mkdir(dir, { recursive: true });
  const name = resolve(
      dir,
      "sn2h-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sql.gz",
    ),
    partial = name + ".partial";
  const dump = spawn(
    process.env.MYSQLDUMP_PATH || "mysqldump",
    [
      "--host=" + process.env.DB_HOST,
      "--port=" + (process.env.DB_PORT || 3306),
      "--user=" + process.env.DB_USER,
      "--single-transaction",
      "--no-tablespaces",
      "--set-gtid-purged=OFF",
      "--hex-blob",
      "--default-character-set=utf8mb4",
      process.env.DB_NAME || "bridge_health_monitor",
    ],
    {
      env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let error = "";
  dump.stderr.on("data", (chunk) => {
    error = (error + chunk).slice(-500);
  });
  const completion = new Promise((resolve, reject) => {
    dump.on("error", reject);
    dump.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "mysqldump failed; check installation and database backup permissions",
            ),
          ),
    );
  });
  try {
    await Promise.all([
      pipeline(
        dump.stdout,
        createGzip(),
        createWriteStream(partial, { flags: "wx", mode: 0o600 }),
      ),
      completion,
    ]);
    await rename(partial, name);
    return { path: name, bytes: (await stat(name)).size };
  } catch (e) {
    dump.kill();
    await unlink(partial).catch(() => {});
    throw new Error(
      e.code === "ENOENT"
        ? "mysqldump not found. Set MYSQLDUMP_PATH."
        : e.message,
    );
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(await backup());
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
