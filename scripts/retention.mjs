import { query, pool } from "../server/db.js";
const args = process.argv.slice(2),
  index = args.indexOf("--days"),
  days = Number(index >= 0 ? args[index + 1] : 90),
  apply = args.includes("--apply");
if (!Number.isSafeInteger(days) || days < 30 || days > 3650)
  throw new Error("Retention must be 30–3650 days");
try {
  for (const [table, column] of [
    ["sensor_readings", "timestamp"],
    ["remote_samples", "measured_at"],
  ]) {
    const [count] = await query(
      `SELECT COUNT(*) count FROM ${table} WHERE ${column}<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY)`,
      [days],
    );
    console.log(
      `${apply ? "Apply" : "Dry run"}: ${table}: ${count.count} readings older than ${days} days.`,
    );
    if (apply) {
      let rows;
      do {
        rows = await query(
          `DELETE FROM ${table} WHERE ${column}<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY) LIMIT 1000`,
          [days],
        );
      } while (rows.affectedRows === 1000);
    }
  }
  if (apply)
    await query(
      "INSERT INTO audit_log(actor,action,resource,status_code) VALUES ('retention-job','DELETE',?,200)",
      ["Readings older than " + days + " days"],
    );
} finally {
  await pool.end();
}
