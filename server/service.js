import { query } from "./db.js";
import { VibrationProcessor, scenarios, signal } from "./processing.js";
import { fail, number, validateHealth } from "./validation.js";
export class Monitor {
  constructor(io) {
    this.io = io;
    this.processor = new VibrationProcessor();
    this.previous = new Map();
    this.offline = new Set();
    this.sim = {
      state: "stopped",
      scenario: "normal",
      ...scenarios.normal,
      elapsed: 0,
    };
    this.busy = false;
  }
  async init() {
    const rows = await query(
      "SELECT config FROM monitoring_settings WHERE id=1",
    );
    this.settings =
      typeof rows[0].config === "string"
        ? JSON.parse(rows[0].config)
        : rows[0].config;
    this.simEnabled = Boolean(
      (await query("SELECT enabled FROM devices WHERE id='sim-adxl345'"))[0]
        ?.enabled,
    );
    await query(
      "UPDATE simulation_sessions SET state='interrupted',ended_at=UTC_TIMESTAMP(3) WHERE ended_at IS NULL",
    );
    this.timer = setInterval(
      () =>
        this.tick().catch((e) => {
          console.error("Sampling failed:", e.message);
          this.io.emit("system:error", {
            message: "Database write failed; check server logs.",
          });
        }),
      50,
    );
    this.watch = setInterval(
      () => this.checkOffline().catch((e) => console.error(e.message)),
      1000,
    );
  }
  async ingest(deviceId, raw, source, remote = null) {
    if (typeof deviceId !== "string" || !/^[a-zA-Z0-9-]{1,40}$/.test(deviceId))
      throw fail("A valid device_id is required");
    const devices = await query(
      "SELECT d.*,c.offset_x,c.offset_y,c.offset_z FROM devices d LEFT JOIN sensor_calibrations c ON c.device_id=d.id WHERE d.id=?",
      [deviceId],
    );
    const device = devices[0];
    if (!device || device.source !== source || !device.enabled)
      throw fail("Unknown, disabled, or mismatched device", 403);
    for (const key of ["x", "y", "z"]) number(raw[key], -16, 16, key);
    const health = validateHealth(raw.health);
    const processed = this.processor.process(
      deviceId,
      {
        x: raw.x - (device.offset_x || 0),
        y: raw.y - (device.offset_y || 0),
        z: raw.z - (device.offset_z || 0),
      },
      this.settings,
    );
    // Preserve raw acceleration in history; derived vibration uses saved calibration.
    processed.x = raw.x;
    processed.y = raw.y;
    processed.z = raw.z;
    const receivedAt = new Date();
    const timestamp = remote ? new Date(remote.measuredAt) : receivedAt;
    const conn = (await import("./db.js")).pool;
    const tx = await conn.getConnection();
    let alert = null;
    try {
      await tx.beginTransaction();
      // Lock the parent before inserting FK children, avoiding concurrent lock upgrades.
      await tx.execute("SELECT id FROM devices WHERE id=? FOR UPDATE", [
        deviceId,
      ]);
      if (remote) {
        const [[row]] = await tx.execute(
          "SELECT disposition FROM remote_samples WHERE id=? AND device_id=? FOR UPDATE",
          [remote.id, deviceId],
        );
        if (!row || row.disposition !== "pending")
          throw fail("Remote sample already dispatched", 409);
      }
      const [insert] = await tx.execute(
        "INSERT INTO sensor_readings(device_id,source,timestamp,x,y,z,magnitude,rms,status) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          deviceId,
          source,
          timestamp,
          processed.x,
          processed.y,
          processed.z,
          processed.magnitude,
          processed.rms,
          processed.status,
        ],
      );
      await tx.execute("UPDATE devices SET last_seen=? WHERE id=?", [
        receivedAt,
        deviceId,
      ]);
      if (health)
        await tx.execute(
          "INSERT INTO device_profiles(device_id,rssi,uptime_ms,firmware,battery,telemetry_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rssi=COALESCE(VALUES(rssi),rssi),uptime_ms=COALESCE(VALUES(uptime_ms),uptime_ms),firmware=COALESCE(VALUES(firmware),firmware),battery=COALESCE(VALUES(battery),battery),telemetry_at=VALUES(telemetry_at)",
          [
            deviceId,
            health.rssi ?? null,
            health.uptimeMs ?? null,
            health.firmware ?? null,
            health.battery ?? null,
            timestamp,
          ],
        );
      if (
        processed.status !== "normal" &&
        this.previous.get(deviceId) !== processed.status
      ) {
        alert = {
          device_id: deviceId,
          source,
          severity: processed.status,
          message: `${processed.status.toUpperCase()} demonstration RMS threshold reached`,
          timestamp,
          acknowledged: false,
        };
        const [a] = await tx.execute(
          "INSERT INTO alerts(device_id,source,severity,message,timestamp) VALUES (?,?,?,?,?)",
          [deviceId, source, alert.severity, alert.message, timestamp],
        );
        alert.id = a.insertId;
      }
      if (remote)
        await tx.execute(
          "UPDATE remote_samples SET disposition='live' WHERE id=?",
          [remote.id],
        );
      await tx.commit();
      processed.id = insert.insertId;
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.release();
    }
    this.previous.set(deviceId, processed.status);
    this.offline.delete(deviceId);
    const reading = { ...processed, device_id: deviceId, source, timestamp };
    this.io.emit("sensor:update", reading);
    this.io.emit("bridge:status", {
      device_id: deviceId,
      status: processed.status,
      source,
    });
    if (alert) {
      this.io.emit("alert:new", alert);
      await this.notifications
        ?.enqueue(alert)
        .catch((e) => console.error("Notification queue:", e.message));
    }
    return reading;
  }
  async tick() {
    if (
      this.sim.state !== "running" ||
      this.simEnabled === false ||
      this.busy ||
      this.controlling ||
      Date.now() - (this.lastTick || 0) < this.settings.samplingMs
    )
      return;
    this.busy = true;
    this.lastTick = Date.now();
    try {
      this.sim.elapsed += this.settings.samplingMs / 1000;
      if (this.sim.scenario !== "connection_loss")
        await this.ingest(
          "sim-adxl345",
          signal(this.sim.elapsed, this.sim),
          "simulation",
        );
      if (Date.now() - (this.lastStatus || 0) >= 1000) {
        this.io.emit("simulation:status", this.sim);
        this.lastStatus = Date.now();
      }
    } finally {
      this.busy = false;
    }
  }
  async control(action, body = {}) {
    if (this.controlling)
      throw fail("Another simulator control is in progress", 409);
    this.controlling = true;
    try {
      while (this.busy) await new Promise((resolve) => setTimeout(resolve, 5));
      if (action === "start") {
        if (!["stopped"].includes(this.sim.state))
          throw fail("Stop the current session before starting another", 409);
        const scenario = body.scenario || "normal";
        if (!scenarios[scenario]) throw fail("Unknown scenario");
        const config = { ...scenarios[scenario] };
        for (const [key, min, max] of [
          ["amplitude", 0, 2],
          ["frequency", 0.05, 8],
          ["noise", 0, 0.5],
        ])
          if (body[key] !== undefined)
            config[key] = number(body[key], min, max, key);
        if (config.frequency >= 500 / this.settings.samplingMs)
          throw fail("Frequency must be below half the sampling rate");
        const result = await query(
          "INSERT INTO simulation_sessions(scenario,started_at,state) VALUES (?,UTC_TIMESTAMP(3),'running')",
          [scenario],
        );
        this.processor.reset("sim-adxl345");
        this.previous.delete("sim-adxl345");
        this.sim = {
          state: "running",
          scenario,
          ...config,
          elapsed: 0,
          sessionId: result.insertId,
        };
      } else if (action === "pause" || action === "resume") {
        const required = action === "pause" ? "running" : "paused";
        if (this.sim.state !== required)
          throw fail(`Simulation must be ${required}`, 409);
        const state = action === "pause" ? "paused" : "running";
        await query("UPDATE simulation_sessions SET state=? WHERE id=?", [
          state,
          this.sim.sessionId,
        ]);
        this.sim.state = state;
      } else if (action === "stop" || action === "reset") {
        if (this.sim.sessionId)
          await query(
            "UPDATE simulation_sessions SET state='stopped',ended_at=UTC_TIMESTAMP(3) WHERE id=?",
            [this.sim.sessionId],
          );
        this.sim.state = "stopped";
        if (action === "reset") {
          this.sim = {
            state: "stopped",
            scenario: "normal",
            ...scenarios.normal,
            elapsed: 0,
          };
          this.processor.reset("sim-adxl345");
        }
      } else throw fail("Unknown simulation action", 404);
      this.io.emit("simulation:status", this.sim);
      return this.sim;
    } finally {
      this.controlling = false;
    }
  }
  async checkOffline() {
    if (this.checkingOffline) return;
    this.checkingOffline = true;
    try {
      const devices = await query(
        "SELECT * FROM devices WHERE enabled=TRUE AND last_seen IS NOT NULL",
      );
      for (const d of devices) {
        if (
          Date.now() - new Date(d.last_seen).getTime() >
            this.settings.offlineMs &&
          !this.offline.has(d.id)
        ) {
          const alert = {
            device_id: d.id,
            source: d.source,
            severity: "offline",
            message: "Sensor measurements are stale",
            timestamp: new Date(),
            acknowledged: false,
          };
          const result = await query(
            "INSERT INTO alerts(device_id,source,severity,message,timestamp) VALUES (?,?,?,?,?)",
            [d.id, d.source, "offline", alert.message, alert.timestamp],
          );
          alert.id = result.insertId;
          this.offline.add(d.id);
          this.previous.delete(d.id);
          this.io.emit("device:offline", { device_id: d.id });
          this.io.emit("alert:new", alert);
          await this.notifications
            ?.enqueue(alert)
            .catch((e) => console.error("Notification queue:", e.message));
        }
      }
    } finally {
      this.checkingOffline = false;
    }
  }
  close() {
    clearInterval(this.timer);
    clearInterval(this.watch);
  }
}
