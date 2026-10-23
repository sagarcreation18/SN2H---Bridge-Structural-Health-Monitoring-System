import { Router } from "express";
import { query, pool } from "./db.js";
import { adminAccess } from "./auth.js";
import { asyncRoute as wrap, fail, number } from "./validation.js";
import { spectrum } from "./spectrum.js";
import { pdfReport } from "./pdf-report.js";
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);
export function featureRoutes(monitor, notifications, demo) {
  const r = Router();
  r.get(
    "/fleet",
    wrap(async (req, res) => {
      const devices = await query(
        "SELECT d.*,p.location,p.position,p.rssi,p.uptime_ms,p.firmware,p.battery,p.telemetry_at,c.offset_x,c.offset_y,c.offset_z,c.sample_count,c.updated_at calibration_at FROM devices d LEFT JOIN device_profiles p ON p.device_id=d.id LEFT JOIN sensor_calibrations c ON c.device_id=d.id ORDER BY d.source,d.id",
      );
      for (const d of devices) {
        const [latest] = await query(
          "SELECT * FROM sensor_readings WHERE device_id=? ORDER BY timestamp DESC,id DESC LIMIT 1",
          [d.id],
        );
        d.latest = latest || null;
        d.status = !d.enabled
          ? "disabled"
          : d.last_seen &&
              Date.now() - new Date(d.last_seen).getTime() <
                monitor.settings.offlineMs
            ? "online"
            : "offline";
      }
      res.json(devices);
    }),
  );
  r.post(
    "/devices",
    adminAccess,
    wrap(async (req, res) => {
      const b = req.body;
      if (typeof b.id !== "string" || !/^esp32-[a-zA-Z0-9-]{1,30}$/.test(b.id))
        throw fail(
          "Hardware ID must start esp32- and use letters, numbers or hyphens",
        );
      if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 100)
        throw fail("Device name is required (up to 100 characters)");
      if (
        typeof b.location !== "string" ||
        !b.location.trim() ||
        b.location.length > 120
      )
        throw fail("Location is required (up to 120 characters)");
      number(b.position, 0, 1, "position");
      const [bridge] = await query("SELECT id FROM bridges WHERE id=?", [
        Number(b.bridge_id || 1),
      ]);
      if (!bridge) throw fail("Bridge not found", 404);
      const tx = await pool.getConnection();
      try {
        await tx.beginTransaction();
        await tx.execute(
          "INSERT INTO devices(id,bridge_id,name,source) VALUES (?,?,?,'hardware')",
          [b.id, bridge.id, b.name.trim()],
        );
        await tx.execute(
          "INSERT INTO device_profiles(device_id,location,position) VALUES (?,?,?)",
          [b.id, b.location.trim(), b.position],
        );
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        if (e.code === "ER_DUP_ENTRY")
          throw fail("Device ID already exists", 409);
        throw e;
      } finally {
        tx.release();
      }
      monitor.io.emit("device:update", { device_id: b.id });
      res.status(201).json({ created: true });
    }),
  );
  r.patch(
    "/devices/:id/profile",
    adminAccess,
    wrap(async (req, res) => {
      const b = req.body;
      if (
        typeof b.location !== "string" ||
        b.location.length < 1 ||
        b.location.length > 120
      )
        throw fail("Location is required (1–120 characters)");
      number(b.position, 0, 1, "position");
      if (
        !(await query("SELECT id FROM devices WHERE id=?", [req.params.id]))
          .length
      )
        throw fail("Device not found", 404);
      await query(
        "INSERT INTO device_profiles(device_id,location,position) VALUES (?,?,?) ON DUPLICATE KEY UPDATE location=VALUES(location),position=VALUES(position)",
        [req.params.id, b.location, b.position],
      );
      monitor.io.emit("device:update", { device_id: req.params.id });
      res.json({ updated: true });
    }),
  );
  r.get(
    "/devices/:id/calibration",
    wrap(async (req, res) => {
      if (
        !(await query("SELECT id FROM devices WHERE id=?", [req.params.id]))
          .length
      )
        throw fail("Device not found", 404);
      const [calibration] = await query(
        "SELECT * FROM sensor_calibrations WHERE device_id=?",
        [req.params.id],
      );
      res.json(
        calibration || {
          device_id: req.params.id,
          offset_x: 0,
          offset_y: 0,
          offset_z: 0,
          sample_count: 0,
        },
      );
    }),
  );
  r.post(
    "/devices/:id/calibration",
    adminAccess,
    wrap(async (req, res) => {
      if (req.body.stationary !== true)
        throw fail(
          "Confirm that the sensor is stationary with +Z pointing upward",
        );
      const rows = await query(
        "SELECT x,y,z FROM sensor_readings WHERE device_id=? AND timestamp>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE) ORDER BY timestamp DESC,id DESC LIMIT 200",
        [req.params.id],
      );
      if (rows.length < 100)
        throw fail(
          "At least 100 recent stationary raw measurements are required",
          422,
        );
      const means = ["x", "y", "z"].map(
          (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length,
        ),
        deviations = ["x", "y", "z"].map((k, i) =>
          Math.sqrt(
            rows.reduce((a, r) => a + (r[k] - means[i]) ** 2, 0) / rows.length,
          ),
        );
      if (
        Math.max(...deviations) > 0.035 ||
        Math.abs(means[0]) > 0.3 ||
        Math.abs(means[1]) > 0.3 ||
        Math.abs(means[2] - 1) > 0.3
      )
        throw fail(
          "Window is moving or not mounted +Z-up. Hold stationary and retry.",
          422,
        );
      await query(
        "INSERT INTO sensor_calibrations(device_id,offset_x,offset_y,offset_z,sample_count) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE offset_x=VALUES(offset_x),offset_y=VALUES(offset_y),offset_z=VALUES(offset_z),sample_count=VALUES(sample_count),updated_at=UTC_TIMESTAMP(3)",
        [req.params.id, means[0], means[1], means[2] - 1, rows.length],
      );
      monitor.processor.reset(req.params.id);
      res.json({
        calibrated: true,
        samples: rows.length,
        offsets: { x: means[0], y: means[1], z: means[2] - 1 },
      });
    }),
  );
  r.delete(
    "/devices/:id/calibration",
    adminAccess,
    wrap(async (req, res) => {
      await query("DELETE FROM sensor_calibrations WHERE device_id=?", [
        req.params.id,
      ]);
      monitor.processor.reset(req.params.id);
      res.json({ reset: true });
    }),
  );
  r.get(
    "/analysis/spectrum",
    wrap(async (req, res) => {
      const id = String(req.query.device_id || "sim-adxl345");
      const rows = await query(
        "SELECT timestamp,x,y,z FROM sensor_readings WHERE device_id=? ORDER BY timestamp DESC,id DESC LIMIT 1024",
        [id],
      );
      res.json({
        device_id: id,
        ...spectrum(rows.reverse(), req.query.axis || "x"),
      });
    }),
  );
  r.get(
    "/alerts/:id/playback",
    wrap(async (req, res) => {
      if (!/^\d+$/.test(req.params.id)) throw fail("Invalid alert ID");
      const [event] = await query("SELECT * FROM alerts WHERE id=?", [
        req.params.id,
      ]);
      if (!event) throw fail("Alert not found", 404);
      const center = +new Date(event.timestamp),
        from = new Date(center - 30000),
        to = new Date(center + 30000);
      const rows = await query(
        "SELECT * FROM sensor_readings WHERE device_id=? AND source=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp,id LIMIT 2001",
        [event.device_id, event.source, from, to],
      );
      res.json({
        event,
        from,
        to,
        rows: rows.slice(0, 2000),
        truncated: rows.length > 2000,
      });
    }),
  );
  r.get("/demo/status", (req, res) => res.json(demo.snapshot()));
  r.post(
    "/demo/start",
    adminAccess,
    wrap(async (req, res) => res.json(await demo.start())),
  );
  r.post(
    "/demo/stop",
    adminAccess,
    wrap(async (req, res) => res.json(await demo.stop())),
  );
  r.get(
    "/notifications",
    adminAccess,
    wrap(async (req, res) =>
      res.json({
        config: await notifications.config(),
        configured: notifications.configured(),
        deliveries: await query(
          "SELECT id,alert_id,device_id,severity,status,attempts,detail,created_at,sent_at FROM notification_deliveries ORDER BY id DESC LIMIT 50",
        ),
      }),
    ),
  );
  r.put(
    "/notifications",
    adminAccess,
    wrap(async (req, res) => {
      const b = req.body;
      for (const k of ["enabled", "critical", "warning", "offline"])
        if (typeof b[k] !== "boolean") throw fail(`${k} must be boolean`);
      if (
        typeof b.recipient !== "string" ||
        (b.recipient &&
          !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(b.recipient)) ||
        b.recipient.length > 254
      )
        throw fail("A valid recipient email address is required");
      number(b.cooldownSeconds, 30, 3600, "cooldownSeconds");
      if (b.enabled && (!b.recipient || !notifications.configured()))
        throw fail(
          "Set a recipient and configure SMTP in .env before enabling delivery",
        );
      const config = Object.fromEntries(
        [
          "enabled",
          "recipient",
          "critical",
          "warning",
          "offline",
          "cooldownSeconds",
        ].map((k) => [k, b[k]]),
      );
      await query("UPDATE notification_config SET config=? WHERE id=1", [
        JSON.stringify(config),
      ]);
      res.json({ saved: true });
    }),
  );
  r.post(
    "/notifications/verify",
    adminAccess,
    wrap(async (req, res) => {
      try {
        res.json(await notifications.verify());
      } catch (e) {
        throw fail(
          e.status
            ? e.message
            : "SMTP verification failed; check credentials, TLS and server logs",
          e.status || 502,
        );
      }
    }),
  );
  r.get("/reports/pdf", wrap(pdfReport));
  return r;
}
