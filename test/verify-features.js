import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { query, pool } from "../server/db.js";
import { Notifications } from "../server/notifications.js";
const base = "http://127.0.0.1:" + (process.env.PORT || 3100),
  suffix = randomBytes(4).toString("hex"),
  device = "esp32-test-" + suffix,
  adminName = "verify_admin_" + suffix,
  viewerName = "verify_viewer_" + suffix,
  password = randomBytes(24).toString("hex");
const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: "Bearer " + process.env.ADMIN_TOKEN,
};
async function call(
  path,
  method = "GET",
  body,
  headers = adminHeaders,
  status = 200,
) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(result)}`);
  return { result, headers: r.headers };
}
let originalMail, adminCookie, adminCsrf, viewerCookie;
try {
  await call(
    "/auth/users",
    "POST",
    { username: adminName, password, role: "admin" },
    adminHeaders,
    201,
  );
  await call(
    "/auth/users",
    "POST",
    { username: viewerName, password, role: "viewer" },
    adminHeaders,
    201,
  );
  const login = await call(
    "/auth/login",
    "POST",
    { username: adminName, password },
    { "Content-Type": "application/json" },
  );
  adminCookie = login.headers.get("set-cookie").split(";")[0];
  adminCsrf = login.result.csrf;
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  const authenticated = {
    "Content-Type": "application/json",
    Cookie: adminCookie,
    "X-CSRF-Token": adminCsrf,
  };
  const viewer = await call(
    "/auth/login",
    "POST",
    { username: viewerName, password },
    { "Content-Type": "application/json" },
  );
  viewerCookie = viewer.headers.get("set-cookie").split(";")[0];
  await call(
    "/simulation/pause",
    "POST",
    {},
    {
      "Content-Type": "application/json",
      Cookie: viewerCookie,
      "X-CSRF-Token": viewer.result.csrf,
    },
    401,
  );
  await call(
    "/devices",
    "POST",
    {
      id: device,
      name: "Temporary integration test",
      location: "Test-only location",
      position: 0.2,
    },
    { "Content-Type": "application/json", Cookie: adminCookie },
    403,
  );
  await call(
    "/devices",
    "POST",
    {
      id: device,
      name: "Temporary integration test",
      location: "Test-only location",
      position: 0.2,
    },
    authenticated,
    201,
  );
  await call(
    "/devices/" + device + "/profile",
    "PATCH",
    { location: "Updated test-only location", position: 0.3 },
    authenticated,
  );
  const origin = Date.now() - 10000;
  for (let i = 0; i < 120; i++)
    await query(
      "INSERT INTO sensor_readings(device_id,source,timestamp,x,y,z,magnitude,rms,status) VALUES (?,'hardware',?,?,?,?,?,?,'normal')",
      [device, new Date(origin + i * 50), 0.02, -0.01, 1.03, 0.0374, 0.0374],
    );
  const calibration = (
    await call(
      "/devices/" + device + "/calibration",
      "POST",
      { stationary: true },
      authenticated,
    )
  ).result;
  assert.ok(Math.abs(calibration.offsets.z - 0.03) < 1e-8);
  const hardwareHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + process.env.DEVICE_TOKEN,
  };
  const sample = (
    await call(
      "/sensor-data",
      "POST",
      {
        device_id: device,
        x: 0.02,
        y: -0.01,
        z: 1.03,
        health: {
          rssi: -65,
          uptimeMs: 123456,
          firmware: "test-only-1",
          battery: 90,
        },
      },
      hardwareHeaders,
      201,
    )
  ).result;
  assert.ok(sample.rms < 1e-8);
  assert.equal(sample.x, 0.02);
  const fleet = (await call("/fleet")).result.find((d) => d.id === device);
  assert.equal(fleet.rssi, -65);
  assert.equal(fleet.location, "Updated test-only location");
  assert.equal(fleet.battery, 90);
  await query("DELETE FROM sensor_readings WHERE device_id=?", [device]);
  const start = Date.now() - 26000;
  for (let i = 0; i < 512; i++)
    await query(
      "INSERT INTO sensor_readings(device_id,source,timestamp,x,y,z,magnitude,rms,status) VALUES (?,'hardware',?,?,?,?,?,?,'normal')",
      [
        device,
        new Date(start + i * 50),
        0.02 + 0.1 * Math.sin(2 * Math.PI * 2 * i * 0.05),
        -0.01,
        1.03,
        0.1,
        0.07,
      ],
    );
  const fft = (await call("/analysis/spectrum?device_id=" + device + "&axis=x"))
    .result;
  assert.ok(Math.abs(fft.dominantHz - 2) < 0.15);
  const event = await query(
    "INSERT INTO alerts(device_id,source,severity,message,timestamp) VALUES (?,'hardware','critical','Temporary test-only event',?)",
    [device, new Date(start + 12000)],
  );
  const replay = (await call("/alerts/" + event.insertId + "/playback")).result;
  assert.equal(replay.event.device_id, device);
  assert.ok(replay.rows.length > 100);
  assert.ok(
    replay.rows.every((r) => r.device_id === device && r.source === "hardware"),
  );
  await call(
    "/alerts/" + event.insertId + "/acknowledge",
    "PATCH",
    {},
    authenticated,
  );
  const mail = (await call("/notifications", "GET", undefined, authenticated))
    .result;
  originalMail = mail.config;
  await call(
    "/notifications",
    "PUT",
    { ...originalMail, enabled: false, recipient: "test@example.invalid" },
    authenticated,
  );
  if (!mail.configured)
    await call("/notifications/verify", "POST", {}, authenticated, 503);
  const queued = (
    await query(
      "SELECT COUNT(*) count FROM notification_deliveries WHERE status IN ('queued','retry')",
    )
  )[0].count;
  if (!queued) {
    let sent = 0;
    const fake = new Notifications();
    fake.config = async () => ({
      ...originalMail,
      enabled: true,
      recipient: "test@example.invalid",
      critical: true,
      cooldownSeconds: 30,
    });
    fake.configured = () => true;
    fake.transport = () => ({
      sendMail: async () => {
        sent++;
      },
    });
    await fake.enqueue({
      id: event.insertId,
      device_id: device,
      severity: "critical",
    });
    await fake.flush();
    assert.equal(sent, 1);
    assert.equal(
      (
        await query(
          "SELECT status FROM notification_deliveries WHERE alert_id=?",
          [event.insertId],
        )
      )[0].status,
      "sent",
    );
  }
  const pdf = await fetch(
    base +
      "/api/reports/pdf?source=simulation&from=" +
      new Date(Date.now() - 300000).toISOString(),
  );
  assert.equal(pdf.status, 200);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/sn2h-verification-report.pdf", bytes);
  await call(
    "/devices/" + device + "/calibration",
    "DELETE",
    undefined,
    authenticated,
  );
  assert.equal(
    (await call("/devices/" + device + "/calibration")).result.sample_count,
    0,
  );
  await call(
    "/auth/password",
    "POST",
    { currentPassword: password, password: password + "-changed" },
    authenticated,
  );
  await call(
    "/devices",
    "POST",
    { id: device + "x", name: "No session", location: "Test", position: 0.3 },
    authenticated,
    401,
  );
  console.log(
    "PASS: password login, viewer/admin authorization, CSRF, session invalidation, sensor registration/location/health, calibration/raw preservation, FFT, event playback, mock-only email delivery, and PDF download.",
  );
} finally {
  if (originalMail) await call("/notifications", "PUT", originalMail);
  await query("DELETE FROM notification_deliveries WHERE device_id=?", [
    device,
  ]);
  await query("DELETE FROM alerts WHERE device_id=?", [device]);
  await query("DELETE FROM sensor_readings WHERE device_id=?", [device]);
  await query("DELETE FROM devices WHERE id=?", [device]);
  await query("DELETE FROM app_users WHERE username IN (?,?)", [
    adminName,
    viewerName,
  ]);
  await pool.end();
}
