import express, { Router } from "express";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { query } from "./db.js";
import { adminAccess, equal } from "./auth.js";
import { asyncRoute as wrap, fail, number } from "./validation.js";
import { sensorFaults, baselineChange } from "./advanced-analysis.js";
import { tokenHash, deviceAccess, RemoteIngest } from "./remote.js";
import { decode } from "./advanced-worker.js";

const text = (v, name, max = 1000) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw fail(`${name} required (up to ${max} characters)`);
  return v.trim();
};
const email = (v) =>
  typeof v === "string" &&
  v.length <= 254 &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const id = (v) => {
  if (!/^\d{1,15}$/.test(String(v))) throw fail("Invalid ID");
  return v;
};
const actor = (req) => req.user?.username || "recovery-admin";
async function device(deviceId) {
  const [d] = await query("SELECT * FROM devices WHERE id=?", [deviceId]);
  if (!d) throw fail("Device not found", 404);
  return d;
}
function dates(b) {
  const from = new Date(b.from),
    to = new Date(b.to);
  if (
    !Number.isFinite(+from) ||
    !Number.isFinite(+to) ||
    from >= to ||
    to - from > 31 * 86400000
  )
    throw fail("Select a valid interval of at most 31 days");
  return [from, to];
}
export function auditMiddleware(req, res, next) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
    res.on("finish", () => {
      const recovery = equal(
        req.headers.authorization?.replace(/^Bearer /, ""),
        process.env.ADMIN_TOKEN,
      );
      if (!req.user && !recovery) return;
      // Request bodies, credentials, cookies and subscription endpoints are never logged.
      query(
        "INSERT INTO audit_log(actor,action,resource,status_code) VALUES (?,?,?,?)",
        [
          actor(req),
          req.method,
          req.originalUrl.split("?")[0].slice(0, 200),
          res.statusCode,
        ],
      ).catch((e) => console.error("Audit write failed:", e.message));
    });
  next();
}
export function advancedRoutes(monitor, notifications, worker) {
  const r = Router(),
    remote = new RemoteIngest(monitor);
  r.post(
    "/remote/batch",
    deviceAccess,
    wrap(async (req, res) =>
      res.status(201).json(await remote.accept(req.body)),
    ),
  );
  r.get(
    "/remote/status",
    wrap(async (req, res) =>
      res.json({
        transport: "HTTPS",
        mqtt: false,
        host: process.env.HOST || "127.0.0.1",
        localAddresses: Object.values(networkInterfaces())
          .flat()
          .filter((v) => v.family === "IPv4" && !v.internal)
          .map((v) => `http://${v.address}:${process.env.PORT || 3100}`),
        secureCookies: process.env.COOKIE_SECURE === "true",
        publicUrl: process.env.PUBLIC_URL || null,
        legacyDeviceToken: process.env.ALLOW_LEGACY_DEVICE_TOKEN !== "false",
        pushConfigured: worker.pushConfigured(),
      }),
    ),
  );
  r.post(
    "/devices/:id/credential",
    adminAccess,
    wrap(async (req, res) => {
      const d = await device(req.params.id);
      if (d.source !== "hardware") throw fail("Hardware credentials only");
      const token = randomBytes(32).toString("hex");
      await query(
        "INSERT INTO device_credentials(device_id,token_hash) VALUES (?,?) ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),rotated_at=UTC_TIMESTAMP(3)",
        [d.id, tokenHash(token)],
      );
      res.set("Cache-Control", "no-store").json({
        device_id: d.id,
        token,
        note: "Shown once. Rotation revokes the previous credential and shared-token access for this device.",
      });
    }),
  );
  r.get(
    "/devices/:id/diagnostics",
    wrap(async (req, res) => {
      const d = await device(req.params.id),
        rows = await query(
          "SELECT x,y,z,rms,timestamp FROM sensor_readings WHERE device_id=? ORDER BY timestamp DESC,id DESC LIMIT 100",
          [d.id],
        );
      const [environment] = await query(
        "SELECT measured_at,received_at,temperature,tilt_x,tilt_y,disposition FROM remote_samples WHERE device_id=? ORDER BY measured_at DESC LIMIT 1",
        [d.id],
      );
      const [stats] = await query(
        "SELECT COUNT(*) samples,SUM(disposition='archived') archived,MAX(received_at) last_upload FROM remote_samples WHERE device_id=?",
        [d.id],
      );
      res.json({
        device_id: d.id,
        source: d.source,
        enabled: Boolean(d.enabled),
        ...sensorFaults(rows, d.last_seen, monitor.settings.offlineMs),
        environment: environment || null,
        uploads: stats,
        notice:
          "Diagnostic indicators require inspection; they are not structural safety judgments.",
      });
    }),
  );
  r.get(
    "/devices/:id/remote-history",
    wrap(async (req, res) => {
      await device(req.params.id);
      res.json(
        await query(
          "SELECT boot_id,sequence_no,measured_at,received_at,x,y,z,temperature,tilt_x,tilt_y,disposition FROM remote_samples WHERE device_id=? ORDER BY measured_at DESC,id DESC LIMIT 500",
          [req.params.id],
        ),
      );
    }),
  );
  r.get(
    "/inspections",
    wrap(async (req, res) =>
      res.json(
        await query(
          "SELECT i.*,b.name bridge_name,(SELECT COUNT(*) FROM inspection_photos p WHERE p.inspection_id=i.id) photos FROM inspections i JOIN bridges b ON b.id=i.bridge_id ORDER BY i.inspected_at DESC LIMIT 200",
        ),
      ),
    ),
  );
  function inspectionBody(b) {
    const inspected = new Date(b.inspected_at);
    if (!Number.isFinite(+inspected))
      throw fail("Valid inspection date required");
    if (
      b.next_inspection &&
      (!/^\d{4}-\d\d-\d\d$/.test(b.next_inspection) ||
        !Number.isFinite(+new Date(b.next_inspection)))
    )
      throw fail("Invalid next inspection date");
    if (!["open", "in-progress", "completed"].includes(b.status))
      throw fail("Invalid inspection status");
    return [
      text(b.title, "Title", 160),
      text(b.notes, "Notes", 10000),
      text(b.responsible, "Responsible person", 120),
      b.status,
      inspected,
      b.next_inspection || null,
    ];
  }
  r.post(
    "/inspections",
    adminAccess,
    wrap(async (req, res) => {
      const values = inspectionBody(req.body),
        bridge = Number(req.body.bridge_id);
      if (!(await query("SELECT id FROM bridges WHERE id=?", [bridge])).length)
        throw fail("Bridge not found", 404);
      const result = await query(
        "INSERT INTO inspections(bridge_id,title,notes,responsible,status,inspected_at,next_inspection,created_by) VALUES (?,?,?,?,?,?,?,?)",
        [bridge, ...values, actor(req)],
      );
      res.status(201).json({ id: result.insertId });
    }),
  );
  r.patch(
    "/inspections/:id",
    adminAccess,
    wrap(async (req, res) => {
      const result = await query(
        "UPDATE inspections SET title=?,notes=?,responsible=?,status=?,inspected_at=?,next_inspection=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [...inspectionBody(req.body), id(req.params.id)],
      );
      if (!result.affectedRows) throw fail("Inspection not found", 404);
      res.json({ updated: true });
    }),
  );
  r.post(
    "/inspections/:id/photos",
    adminAccess,
    express.raw({ type: ["image/jpeg", "image/png"], limit: "2mb" }),
    wrap(async (req, res) => {
      if (
        !(
          await query("SELECT id FROM inspections WHERE id=?", [
            id(req.params.id),
          ])
        ).length
      )
        throw fail("Inspection not found", 404);
      const b = req.body,
        mime = req.get("content-type");
      if (!Buffer.isBuffer(b) || b.length < 16)
        throw fail("JPEG or PNG image required");
      if (
        !(
          mime === "image/png" &&
          b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ) &&
        !(
          mime === "image/jpeg" &&
          b[0] === 255 &&
          b[1] === 216 &&
          b[b.length - 2] === 255 &&
          b[b.length - 1] === 217
        )
      )
        throw fail("Image content does not match its type");
      if (
        (
          await query(
            "SELECT COUNT(*) n FROM inspection_photos WHERE inspection_id=?",
            [req.params.id],
          )
        )[0].n >= 8
      )
        throw fail("Maximum 8 photos per inspection");
      const p = await query(
        "INSERT INTO inspection_photos(inspection_id,mime,image) VALUES (?,?,?)",
        [req.params.id, mime, b],
      );
      res.status(201).json({ id: p.insertId });
    }),
  );
  r.get(
    "/inspections/:id/photos",
    wrap(async (req, res) =>
      res.json(
        await query(
          "SELECT id,mime,created_at FROM inspection_photos WHERE inspection_id=?",
          [id(req.params.id)],
        ),
      ),
    ),
  );
  r.get(
    "/inspection-photos/:id",
    wrap(async (req, res) => {
      const [p] = await query(
        "SELECT mime,image FROM inspection_photos WHERE id=?",
        [id(req.params.id)],
      );
      if (!p) throw fail("Photo not found", 404);
      res
        .set({
          "Content-Type": p.mime,
          "Cache-Control": "private, max-age=300",
          "Content-Disposition": "inline",
        })
        .send(p.image);
    }),
  );
  r.get(
    "/devices/:id/baselines",
    wrap(async (req, res) => {
      await device(req.params.id);
      const rows = await query(
        "SELECT * FROM sensor_baselines WHERE device_id=? ORDER BY id DESC LIMIT 30",
        [req.params.id],
      );
      const [current] = await query(
        "SELECT AVG(rms) mean FROM (SELECT rms FROM sensor_readings WHERE device_id=? ORDER BY timestamp DESC,id DESC LIMIT 100) r",
        [req.params.id],
      );
      res.json({
        rows,
        current: current.mean,
        comparison:
          rows.length && current.mean !== null
            ? baselineChange(rows[0], current.mean)
            : null,
      });
    }),
  );
  r.post(
    "/devices/:id/baselines",
    adminAccess,
    wrap(async (req, res) => {
      await device(req.params.id);
      const [from, to] = dates(req.body),
        label = text(req.body.label, "Label", 100);
      const [b] = await query(
        "SELECT COUNT(*) n,AVG(rms) mean,MAX(rms) maximum,SUM(status<>'normal') abnormal FROM sensor_readings WHERE device_id=? AND timestamp BETWEEN ? AND ?",
        [req.params.id, from, to],
      );
      if (b.n < 100 || b.abnormal > 0)
        throw fail(
          "Baseline requires at least 100 normal samples and no warning/critical samples in the interval",
        );
      const result = await query(
        "INSERT INTO sensor_baselines(device_id,label,from_at,to_at,sample_count,mean_rms,max_rms) VALUES (?,?,?,?,?,?,?)",
        [req.params.id, label, from, to, b.n, b.mean, b.maximum],
      );
      res.status(201).json({ id: result.insertId });
    }),
  );
  r.get(
    "/devices/:id/trends",
    wrap(async (req, res) => {
      await device(req.params.id);
      res.json(
        await query(
          "SELECT DATE(timestamp) day,COUNT(*) samples,AVG(rms) mean_rms,MAX(rms) max_rms FROM sensor_readings WHERE device_id=? AND timestamp>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) GROUP BY DATE(timestamp) ORDER BY day",
          [req.params.id],
        ),
      );
    }),
  );
  r.get(
    "/audit",
    adminAccess,
    wrap(async (req, res) => {
      const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
      res.json({
        rows: await query(
          `SELECT * FROM audit_log ORDER BY id DESC LIMIT 50 OFFSET ${Math.floor(page - 1) * 50}`,
        ),
        page,
        total: (await query("SELECT COUNT(*) n FROM audit_log"))[0].n,
      });
    }),
  );
  r.get(
    "/alerts/:id/notes",
    wrap(async (req, res) =>
      res.json(
        await query("SELECT * FROM alert_notes WHERE alert_id=? ORDER BY id", [
          id(req.params.id),
        ]),
      ),
    ),
  );
  r.post(
    "/alerts/:id/notes",
    adminAccess,
    wrap(async (req, res) => {
      if (
        !(await query("SELECT id FROM alerts WHERE id=?", [id(req.params.id)]))
          .length
      )
        throw fail("Alert not found", 404);
      await query(
        "INSERT INTO alert_notes(alert_id,actor,note) VALUES (?,?,?)",
        [req.params.id, actor(req), text(req.body.note, "Note")],
      );
      res.status(201).json({ saved: true });
    }),
  );
  r.get(
    "/escalation",
    adminAccess,
    wrap(async (req, res) =>
      res.json({
        config: decode(
          (await query("SELECT config FROM escalation_config WHERE id=1"))[0]
            .config,
        ),
        deliveries: await query(
          "SELECT * FROM alert_escalations ORDER BY alert_id DESC LIMIT 50",
        ),
      }),
    ),
  );
  r.put(
    "/escalation",
    adminAccess,
    wrap(async (req, res) => {
      const b = req.body;
      if (
        typeof b.enabled !== "boolean" ||
        (b.recipient && !email(b.recipient))
      )
        throw fail("Valid enabled flag and email required");
      number(b.delayMinutes, 1, 1440, "delayMinutes");
      if (b.enabled && (!email(b.recipient) || !notifications.configured()))
        throw fail("Configure SMTP and a recipient before enabling escalation");
      await query("UPDATE escalation_config SET config=? WHERE id=1", [
        JSON.stringify({
          enabled: b.enabled,
          recipient: b.recipient || "",
          delayMinutes: b.delayMinutes,
        }),
      ]);
      res.json({ saved: true });
    }),
  );
  function account(req, res, next) {
    if (!req.user)
      return next(fail("Sign in to manage phone notifications", 401));
    if (
      req.method !== "GET" &&
      !equal(req.headers["x-csrf-token"], req.user.csrf_token)
    )
      return next(fail("Invalid security token", 403));
    next();
  }
  r.get("/push/config", account, (req, res) =>
    res.json({
      configured: worker.pushConfigured(),
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
    }),
  );
  r.post(
    "/push/subscribe",
    account,
    wrap(async (req, res) => {
      if (!worker.pushConfigured())
        throw fail("Configure VAPID keys and HTTPS first", 503);
      const s = req.body;
      let endpoint;
      try {
        endpoint = new URL(s.endpoint);
      } catch {
        throw fail("Invalid push endpoint");
      }
      const allowed = (
        process.env.PUSH_ALLOWED_HOSTS ||
        "fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com"
      )
        .split(",")
        .map((v) => v.trim());
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        (endpoint.port && endpoint.port !== "443") ||
        !allowed.includes(endpoint.hostname)
      )
        throw fail("Push provider is not allowed");
      if (
        s.endpoint.length > 2048 ||
        !s.keys ||
        !/^[-_\w]{80,100}$/.test(s.keys.p256dh) ||
        !/^[-_\w]{20,30}$/.test(s.keys.auth)
      )
        throw fail("Invalid subscription keys");
      const hash = tokenHash(s.endpoint),
        [old] = await query(
          "SELECT user_id FROM push_subscriptions WHERE endpoint_hash=?",
          [hash],
        );
      if (old && old.user_id !== req.user.id)
        throw fail(
          "Unsubscribe the previous account on this browser first",
          409,
        );
      await query(
        "INSERT INTO push_subscriptions(user_id,endpoint_hash,subscription) VALUES (?,?,?) ON DUPLICATE KEY UPDATE subscription=VALUES(subscription)",
        [
          req.user.id,
          hash,
          JSON.stringify({ endpoint: s.endpoint, keys: s.keys }),
        ],
      );
      res.status(201).json({ subscribed: true });
    }),
  );
  r.post(
    "/push/unsubscribe",
    account,
    wrap(async (req, res) => {
      if (typeof req.body.endpoint !== "string")
        throw fail("Endpoint required");
      await query(
        "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint_hash=?",
        [req.user.id, tokenHash(req.body.endpoint)],
      );
      res.json({ unsubscribed: true });
    }),
  );
  return r;
}
