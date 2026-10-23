import { history, statistics, report } from "./controllers.js";
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { query } from "./db.js";
import { asyncRoute as wrap, fail, range, number } from "./validation.js";
import { adminAccess } from "./auth.js";
import { deviceAccess } from "./remote.js";
export function authorized(token, expected) {
  if (!token || !expected) return false;
  const a = Buffer.from(token),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function routes(monitor) {
  const r = Router();
  const admin = adminAccess;
  r.post("/admin/verify", admin, (req, res) =>
    res.json({ authenticated: true }),
  );
  r.get(
    "/health",
    wrap(async (req, res) => {
      await query("SELECT 1");
      res.json({
        status: "ok",
        database: "mysql",
        mode: "simulation",
        simulation: monitor.sim.state,
      });
    }),
  );
  r.get(
    "/bridges",
    wrap(async (req, res) => res.json(await query("SELECT * FROM bridges"))),
  );
  r.get(
    "/devices",
    wrap(async (req, res) => res.json(await devices())),
  );
  async function devices() {
    return (await query("SELECT * FROM devices")).map((d) => ({
      ...d,
      status: !d.enabled
        ? "disabled"
        : d.last_seen &&
            Date.now() - new Date(d.last_seen).getTime() <
              monitor.settings.offlineMs
          ? "online"
          : "offline",
    }));
  }
  r.get(
    "/devices/:id/status",
    wrap(async (req, res) => {
      const d = (await devices()).find((d) => d.id === req.params.id);
      if (!d) throw fail("Device not found", 404);
      res.json(d);
    }),
  );
  r.patch(
    "/devices/:id",
    admin,
    wrap(async (req, res) => {
      if (typeof req.body.enabled !== "boolean")
        throw fail("enabled must be boolean");
      const result = await query("UPDATE devices SET enabled=? WHERE id=?", [
        req.body.enabled,
        req.params.id,
      ]);
      if (!result.affectedRows) throw fail("Device not found", 404);
      if (req.params.id === "sim-adxl345")
        monitor.simEnabled = req.body.enabled;
      monitor.io.emit("device:update", {
        device_id: req.params.id,
        enabled: req.body.enabled,
      });
      res.json({ updated: true });
    }),
  );
  r.post(
    "/sensor-data",
    deviceAccess,
    wrap(async (req, res) => {
      res
        .status(201)
        .json(await monitor.ingest(req.body.device_id, req.body, "hardware"));
    }),
  );
  r.get(
    "/sensor-data/latest",
    wrap(async (req, res) => {
      const rows = await query(
        "SELECT * FROM sensor_readings ORDER BY timestamp DESC,id DESC LIMIT 1",
      );
      res.json(rows[0] || null);
    }),
  );
  r.get("/sensor-data/history", wrap(history));
  r.get("/sensor-data/statistics", wrap(statistics));
  r.get("/simulation/status", (req, res) => res.json(monitor.sim));
  for (const action of ["start", "pause", "resume", "stop", "reset"])
    r.post(
      "/simulation/" + action,
      admin,
      wrap(async (req, res) => {
        if (monitor.demo?.state.state === "running")
          await monitor.demo.stop("cancelled", false);
        res.json(await monitor.control(action, req.body));
      }),
    );
  r.get(
    "/alerts",
    wrap(async (req, res) => {
      const f = range(req.query);
      const params = [f.from, f.to];
      let where = "timestamp BETWEEN ? AND ?";
      if (req.query.severity) {
        if (!["warning", "critical", "offline"].includes(req.query.severity))
          throw fail("Invalid severity");
        where += " AND severity=?";
        params.push(req.query.severity);
      }
      if (req.query.search) {
        where += " AND (message LIKE ? OR device_id LIKE ?)";
        params.push(
          "%" + String(req.query.search).slice(0, 100) + "%",
          "%" + String(req.query.search).slice(0, 100) + "%",
        );
      }
      const count = await query(
        `SELECT COUNT(*) total FROM alerts WHERE ${where}`,
        params,
      );
      const rows = await query(
        `SELECT * FROM alerts WHERE ${where} ORDER BY timestamp DESC,id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
        params,
      );
      res.json({ rows, total: count[0].total, page: f.page, limit: f.limit });
    }),
  );
  r.patch(
    "/alerts/:id/acknowledge",
    admin,
    wrap(async (req, res) => {
      if (!/^\d+$/.test(req.params.id)) throw fail("Invalid alert ID");
      const result = await query(
        "UPDATE alerts SET acknowledged=TRUE,acknowledged_at=UTC_TIMESTAMP(3) WHERE id=?",
        [req.params.id],
      );
      if (!result.affectedRows) throw fail("Alert not found", 404);
      monitor.io.emit("alert:acknowledged", { id: Number(req.params.id) });
      res.json({ acknowledged: true });
    }),
  );
  r.get("/settings", (req, res) => res.json(monitor.settings));
  r.put(
    "/settings",
    admin,
    wrap(async (req, res) => {
      const s = { ...monitor.settings };
      const allowed = [
        "warning",
        "critical",
        "samplingMs",
        "offlineMs",
        "sound",
        "autoStart",
      ];
      if (Object.keys(req.body).some((k) => !allowed.includes(k)))
        throw fail("Unknown setting");
      Object.assign(s, req.body);
      number(s.warning, 0.01, 5, "warning");
      number(s.critical, 0.02, 10, "critical");
      number(s.samplingMs, 50, 2000, "samplingMs");
      number(s.offlineMs, 1000, 120000, "offlineMs");
      if (s.warning >= s.critical || s.offlineMs < s.samplingMs * 3)
        throw fail(
          "Critical must exceed warning and offline timeout must exceed three samples",
        );
      if (typeof s.sound !== "boolean" || typeof s.autoStart !== "boolean")
        throw fail("Preferences must be boolean");
      if (
        monitor.sim.state !== "stopped" &&
        monitor.sim.frequency >= 500 / s.samplingMs
      )
        throw fail("Stop simulation or choose a faster sampling rate");
      await query("UPDATE monitoring_settings SET config=? WHERE id=1", [
        JSON.stringify(s),
      ]);
      monitor.settings = s;
      monitor.io.emit("settings:update", s);
      res.json(s);
    }),
  );
  r.get("/reports/:type", wrap(report));
  return r;
}
