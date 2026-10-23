import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { query, pool } from "../server/db.js";
const base = "http://127.0.0.1:" + (process.env.PORT || 3100) + "/api",
  suffix = randomBytes(4).toString("hex"),
  device = "esp32-test-" + suffix;
const admin = {
  Authorization: "Bearer " + process.env.ADMIN_TOKEN,
  "Content-Type": "application/json",
};
let inspection = null;
async function request(
  path,
  method = "GET",
  body,
  headers = admin,
  expected = 200,
) {
  const r = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const b = await r.json();
  assert.equal(r.status, expected, JSON.stringify(b));
  return b;
}
try {
  await request(
    "/devices",
    "POST",
    {
      id: device,
      name: "Advanced test fixture",
      location: "Test only",
      position: 0.25,
    },
    admin,
    201,
  );
  const key = await request(`/devices/${device}/credential`, "POST");
  const credentials = {
    Authorization: "Bearer " + key.token,
    "Content-Type": "application/json",
  };
  const old = {
    sequence: 1,
    measured_at: new Date(Date.now() - 60000).toISOString(),
    x: 2,
    y: 0,
    z: 1,
    temperature: 29,
    tilt_x: 1,
    tilt_y: 2,
  };
  let b = { device_id: device, boot_id: "test-boot", samples: [old] };
  let r = await request("/remote/batch", "POST", b, credentials, 201);
  assert.equal(r.archived, 1);
  assert.equal(r.live, 0);
  assert.equal(
    (
      await query("SELECT COUNT(*) n FROM sensor_readings WHERE device_id=?", [
        device,
      ])
    )[0].n,
    0,
  );
  assert.equal(
    (
      await query("SELECT COUNT(*) n FROM alerts WHERE device_id=?", [device])
    )[0].n,
    0,
  );
  const fresh = {
    sequence: 2,
    measured_at: new Date().toISOString(),
    x: 0.01,
    y: 0.01,
    z: 1,
    temperature: 28,
    tilt_x: 1,
    tilt_y: 2,
  };
  b = {
    ...b,
    samples: [fresh],
    health: { rssi: -62, uptimeMs: 45000, firmware: "test-remote" },
  };
  r = await request("/remote/batch", "POST", b, credentials, 201);
  assert.equal(r.live, 1);
  r = await request("/remote/batch", "POST", b, credentials, 201);
  assert.equal(r.duplicates, 1);
  assert.equal(r.live, 0);
  await request(
    "/remote/batch",
    "POST",
    { ...b, samples: [{ ...fresh, x: 3 }] },
    credentials,
    409,
  );
  await request(
    "/remote/batch",
    "POST",
    {
      ...b,
      samples: [
        {
          ...fresh,
          sequence: 3,
          measured_at: new Date(Date.now() + 60000).toISOString(),
        },
      ],
    },
    credentials,
    400,
  );
  // A valid sample followed by an ID conflict must roll back the entire batch.
  await request(
    "/remote/batch",
    "POST",
    {
      ...b,
      samples: [
        { ...fresh, sequence: 0 },
        { ...fresh, x: 4 },
      ],
    },
    credentials,
    409,
  );
  assert.equal(
    (
      await query("SELECT COUNT(*) n FROM remote_samples WHERE device_id=?", [
        device,
      ])
    )[0].n,
    2,
  );
  assert.equal(
    (
      await query("SELECT COUNT(*) n FROM sensor_readings WHERE device_id=?", [
        device,
      ])
    )[0].n,
    1,
  );
  const diagnostics = await request(`/devices/${device}/diagnostics`);
  assert.equal(diagnostics.environment.temperature, 28);
  assert.equal(Number(diagnostics.uploads.archived), 1);
  const profile = (
    await query(
      "SELECT rssi,uptime_ms,firmware FROM device_profiles WHERE device_id=?",
      [device],
    )
  )[0];
  assert.equal(profile.rssi, -62);
  assert.equal(Number(profile.uptime_ms), 45000);
  assert.equal(profile.firmware, "test-remote");
  await request(`/devices/${device}/credential`, "POST");
  await request("/remote/batch", "POST", b, credentials, 401);
  await request(
    "/sensor-data",
    "POST",
    { device_id: device, x: 0, y: 0, z: 1 },
    { ...credentials, Authorization: "Bearer " + process.env.DEVICE_TOKEN },
    401,
  );
  // Normal, explicitly labeled fixture measurements for baseline validation.
  const from = new Date(Date.now() - 3600000),
    to = new Date(+from + 30000);
  for (let i = 0; i < 100; i++)
    await query(
      "INSERT INTO sensor_readings(device_id,source,timestamp,x,y,z,magnitude,rms,status) VALUES (?,'hardware',?,0,0,1,.01,.01,'normal')",
      [device, new Date(+from + i * 100)],
    );
  await request(
    `/devices/${device}/baselines`,
    "POST",
    { label: "Test baseline", from: from.toISOString(), to: to.toISOString() },
    admin,
    201,
  );
  const baseline = await request(`/devices/${device}/baselines`);
  assert.equal(baseline.rows[0].sample_count, 100);
  assert.ok(baseline.comparison);
  assert.ok((await request(`/devices/${device}/trends`)).length);
  const record = {
    bridge_id: 1,
    title: "Test inspection " + suffix,
    notes: "Test repair and evidence",
    responsible: "Test operator",
    status: "open",
    inspected_at: new Date().toISOString(),
    next_inspection: "2026-12-01",
  };
  inspection = (await request("/inspections", "POST", record, admin, 201)).id;
  await request("/inspections/" + inspection, "PATCH", {
    ...record,
    status: "completed",
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = await fetch(base + `/inspections/${inspection}/photos`, {
    method: "POST",
    headers: {
      Authorization: admin.Authorization,
      "Content-Type": "image/png",
    },
    body: png,
  });
  assert.equal(upload.status, 201);
  const photo = (await upload.json()).id,
    p = await fetch(base + "/inspection-photos/" + photo);
  assert.equal(p.status, 200);
  assert.deepEqual(Buffer.from(await p.arrayBuffer()), png);
  const bad = await fetch(base + `/inspections/${inspection}/photos`, {
    method: "POST",
    headers: {
      Authorization: admin.Authorization,
      "Content-Type": "image/png",
    },
    body: Buffer.from("not a real image data content"),
  });
  assert.equal(bad.status, 400);
  const alert = await query(
    "INSERT INTO alerts(device_id,source,severity,message,timestamp) VALUES (?,'hardware','critical','Test response note',UTC_TIMESTAMP(3))",
    [device],
  );
  await request(
    `/alerts/${alert.insertId}/notes`,
    "POST",
    { note: "Inspected; test only" },
    admin,
    201,
  );
  assert.equal(
    (await request(`/alerts/${alert.insertId}/notes`))[0].note,
    "Inspected; test only",
  );
  await request(
    "/escalation",
    "PUT",
    { enabled: true, recipient: "invalid", delayMinutes: 0 },
    admin,
    400,
  );
  await request(
    "/inspections",
    "POST",
    record,
    { "Content-Type": "application/json" },
    401,
  );
  await request("/audit", "GET", undefined, {}, 401);
  await request("/push/config", "GET", undefined, {}, 401);
  // Wait for asynchronous request-completion audit writes, using an explicit query.
  for (let i = 0; i < 10; i++) {
    const a = await request("/audit");
    if (a.rows.some((r) => r.resource === `/api/devices/${device}/credential`))
      break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    (await request("/audit")).rows.some(
      (r) => r.resource === `/api/devices/${device}/credential`,
    ),
  );
  for (const path of [
    "/remote/status",
    "/inspections",
    "/advanced.js",
    "/manifest.webmanifest",
    "/sw.js",
  ]) {
    const response = await fetch(
      path.startsWith("/remote") || path === "/inspections"
        ? base + path
        : base.replace("/api", "") + path,
    );
    assert.equal(response.status, 200);
  }
  console.log(
    "PASS: per-device credential rotation, replay protection, atomic batch rollback, delayed-data alarm isolation, environment telemetry, diagnostics, baselines/trends, inspection edit/photo validation, response notes, authorization and audit records.",
  );
} finally {
  if (inspection)
    await query("DELETE FROM inspections WHERE id=?", [inspection]);
  await query("DELETE FROM notification_deliveries WHERE device_id=?", [
    device,
  ]);
  await query("DELETE FROM alerts WHERE device_id=?", [device]);
  await query("DELETE FROM sensor_readings WHERE device_id=?", [device]);
  await query("DELETE FROM devices WHERE id=?", [device]);
  await pool.end();
}
