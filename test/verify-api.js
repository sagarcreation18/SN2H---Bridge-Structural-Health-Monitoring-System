import "dotenv/config";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { query, pool } from "../server/db.js";
const base = "http://127.0.0.1:" + (process.env.PORT || 3100);
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer " + process.env.ADMIN_TOKEN,
};
async function request(path, method = "GET", body) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.ok(r.ok, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const socket = io(base, { transports: ["websocket"], reconnection: true });
const received = new Set();
for (const event of [
  "sensor:update",
  "bridge:status",
  "alert:new",
  "device:offline",
  "simulation:status",
])
  socket.on(event, () => received.add(event));
let originalSettings;
try {
  assert.equal((await request("/health")).database, "mysql");
  assert.equal(
    (await fetch(base + "/api/simulation/pause", { method: "POST" })).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/sensor-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: 0, y: 0, z: 1 }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ warning: -1 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(base + "/api/sensor-data/history?from=not-a-date")).status,
    400,
  );
  await request("/admin/verify", "POST");
  assert.equal((await request("/bridges"))[0].id, 1);
  assert.equal((await request("/devices")).length, 2);
  assert.equal(
    (await request("/devices/sim-adxl345/status")).source,
    "simulation",
  );
  const settings = await request("/settings");
  originalSettings = settings;
  await request("/simulation/stop", "POST");
  await request("/settings", "PUT", {
    ...settings,
    samplingMs: 50,
    offlineMs: 1000,
  });
  await request("/simulation/start", "POST", { scenario: "critical" });
  await wait(1800);
  assert.ok((await request("/sensor-data/latest")).rms >= 0.35);
  await request("/simulation/pause", "POST");
  const latest = (await request("/sensor-data/latest")).id;
  await wait(2200);
  assert.equal((await request("/sensor-data/latest")).id, latest);
  assert.equal(
    (await request("/devices/sim-adxl345/status")).status,
    "offline",
  );
  await request("/simulation/resume", "POST");
  await wait(300);
  const h = await request("/sensor-data/history?limit=2");
  assert.equal(h.rows.length, 2);
  assert.ok(h.total >= 2);
  assert.equal(
    (await request("/sensor-data/history?limit=2&page=2")).rows.length,
    2,
  );
  const stats = await request("/sensor-data/statistics");
  assert.ok(stats.summary.samples > 0);
  assert.ok(stats.hourly.length);
  assert.ok(stats.daily.length);
  const alerts = await request("/alerts?severity=critical");
  assert.ok(alerts.rows.length);
  await request("/alerts/" + alerts.rows[0].id + "/acknowledge", "PATCH");
  assert.ok(
    (await request("/alerts?severity=critical")).rows.find(
      (a) => a.id === alerts.rows[0].id,
    ).acknowledged,
  );
  for (const type of ["readings", "alerts"]) {
    const r = await fetch(
      base +
        "/api/reports/" +
        type +
        "?from=" +
        new Date(Date.now() - 60000).toISOString(),
    );
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/csv/);
    assert.match(await r.text(), /source/);
  }
  await request("/devices/esp32-01", "PATCH", { enabled: false });
  assert.equal((await request("/devices/esp32-01/status")).status, "disabled");
  await request("/devices/esp32-01", "PATCH", { enabled: true });
  await request("/devices/sim-adxl345", "PATCH", { enabled: false });
  await wait(200);
  const disabledLatest = (await request("/sensor-data/latest")).id;
  await wait(350);
  assert.equal((await request("/sensor-data/latest")).id, disabledLatest);
  await request("/devices/sim-adxl345", "PATCH", { enabled: true });
  await wait(250);
  assert.ok((await request("/sensor-data/latest")).id > disabledLatest);
  await query(
    "INSERT INTO devices(id,bridge_id,name,source) VALUES ('verify-esp32',1,'Temporary API test fixture','hardware')",
  );
  const sensor = await fetch(base + "/api/sensor-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.DEVICE_TOKEN,
    },
    body: JSON.stringify({ device_id: "verify-esp32", x: 0, y: 0, z: 1 }),
  });
  assert.equal(sensor.status, 201);
  assert.equal((await sensor.json()).source, "hardware");
  socket.disconnect();
  socket.connect();
  await wait(500);
  assert.ok(socket.connected);
  await request("/simulation/stop", "POST");
  await request("/simulation/reset", "POST");
  await request("/settings", "PUT", settings);
  await request("/simulation/start", "POST", { scenario: "normal" });
  for (const event of [
    "sensor:update",
    "bridge:status",
    "alert:new",
    "device:offline",
    "simulation:status",
  ])
    assert.ok(received.has(event), "Missing Socket.IO event " + event);
  console.log(
    "PASS: APIs, authentication, validation, MySQL history, controls, stale sensors, acknowledgment, settings, device ingestion, CSV, all five Socket.IO events, and reconnection.",
  );
} finally {
  socket.disconnect();
  await query("DELETE FROM sensor_readings WHERE device_id='verify-esp32'");
  await query("DELETE FROM alerts WHERE device_id='verify-esp32'");
  await query("DELETE FROM devices WHERE id='verify-esp32'");
  if (originalSettings) {
    await request("/devices/sim-adxl345", "PATCH", { enabled: true });
    await request("/simulation/stop", "POST");
    await request("/settings", "PUT", originalSettings);
    await request("/simulation/start", "POST", { scenario: "normal" });
  }
  await pool.end();
}
