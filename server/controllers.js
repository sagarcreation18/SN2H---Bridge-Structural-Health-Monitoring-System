import { query } from "./db.js";
import { range, fail } from "./validation.js";
export async function history(req, res) {
  const f = range(req.query);
  const source = req.query.source || "simulation";
  if (!["simulation", "hardware", "all"].includes(source))
    throw fail("Invalid source");
  let where =
    "timestamp BETWEEN ? AND ?" + (source === "all" ? "" : " AND source=?");
  const args = [f.from, f.to, ...(source === "all" ? [] : [source])];
  if (req.query.device_id) {
    where += " AND device_id=?";
    args.push(String(req.query.device_id));
  }
  const count = await query(
    `SELECT COUNT(*) total FROM sensor_readings WHERE ${where}`,
    args,
  );
  const rows = await query(
    `SELECT * FROM sensor_readings WHERE ${where} ORDER BY timestamp DESC,id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
    args,
  );
  res.json({ rows, total: count[0].total, page: f.page, limit: f.limit });
}
export async function statistics(req, res) {
  const f = range(req.query);
  const source = req.query.source || "simulation";
  if (!["simulation", "hardware"].includes(source))
    throw fail("Choose simulation or hardware");
  const args = [f.from, f.to, source];
  const [summary] = await query(
    "SELECT COUNT(*) samples,MAX(rms) max_rms,AVG(rms) avg_rms,MAX(magnitude) peak FROM sensor_readings WHERE timestamp BETWEEN ? AND ? AND source=?",
    args,
  );
  const hourly = await query(
    "SELECT DATE_FORMAT(timestamp,'%Y-%m-%d %H:00') period,AVG(rms) average,MAX(rms) maximum FROM sensor_readings WHERE timestamp BETWEEN ? AND ? AND source=? GROUP BY period ORDER BY period",
    args,
  );
  const daily = await query(
    "SELECT DATE_FORMAT(timestamp,'%Y-%m-%d') period,AVG(rms) average,MAX(rms) maximum FROM sensor_readings WHERE timestamp BETWEEN ? AND ? AND source=? GROUP BY period ORDER BY period",
    args,
  );
  const events = await query(
    "SELECT severity,COUNT(*) count FROM alerts WHERE timestamp BETWEEN ? AND ? AND source=? GROUP BY severity",
    args,
  );
  res.json({ summary, hourly, daily, events, source });
}
export async function report(req, res) {
  const f = range(req.query);
  if (!["readings", "alerts"].includes(req.params.type))
    throw fail("Unknown report");
  const type = req.params.type;
  const source = req.query.source || "simulation";
  if (!["simulation", "hardware"].includes(source))
    throw fail("Invalid source");
  const table = type === "readings" ? "sensor_readings" : "alerts";
  const columns =
    type === "readings"
      ? [
          "id",
          "device_id",
          "source",
          "timestamp",
          "x",
          "y",
          "z",
          "magnitude",
          "rms",
          "status",
        ]
      : [
          "id",
          "device_id",
          "source",
          "timestamp",
          "severity",
          "message",
          "acknowledged",
        ];
  const rows = await query(
    `SELECT ${columns.join(",")} FROM ${table} WHERE timestamp BETWEEN ? AND ? AND source=? ORDER BY timestamp,id LIMIT 10001`,
    [f.from, f.to, source],
  );
  if (rows.length > 10000)
    throw fail("Report exceeds 10,000 rows. Narrow the date range.", 413);
  const escape = (value) =>
    '"' +
    String(value instanceof Date ? value.toISOString() : (value ?? ""))
      .replace(/"/g, '""')
      .replace(/^[=+@-]/, "'$&") +
    '"';
  res
    .attachment(`sn2h-${type}-${source}.csv`)
    .type("csv")
    .send(
      [
        columns.join(","),
        ...rows.map((row) => columns.map((k) => escape(row[k])).join(",")),
      ].join("\r\n"),
    );
}
