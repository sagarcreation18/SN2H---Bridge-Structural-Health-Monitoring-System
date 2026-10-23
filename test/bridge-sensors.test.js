import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const context = { window: {} };
vm.runInNewContext(
  readFileSync(new URL("../public/bridge-sensors.js", import.meta.url), "utf8"),
  context,
);
const { statusFor } = context.window.SN2HBridgeSensors;
const now = Date.now(),
  device = { id: "hardware-1", source: "hardware", enabled: true };
const sample = {
  device_id: device.id,
  source: device.source,
  timestamp: new Date(now).toISOString(),
  status: "normal",
};
test("sensor light follows each fresh valid status", () => {
  for (const status of ["normal", "warning", "critical"])
    assert.equal(
      statusFor(device, { ...sample, status }, { offlineMs: 5000 }, now),
      status,
    );
});
test("stale, future, malformed and missing samples stay offline", () => {
  for (const timestamp of [
    new Date(now - 5000).toISOString(),
    new Date(now + 5001).toISOString(),
    "invalid",
  ])
    assert.equal(
      statusFor(
        device,
        { ...sample, status: "critical", timestamp },
        { offlineMs: 5000 },
        now,
      ),
      "offline",
    );
  assert.equal(statusFor(device, null, {}, now), "offline");
  assert.equal(statusFor(null, sample, {}, now), "offline");
});
test("sensor status cannot mix devices or sources, or activate disabled devices", () => {
  assert.equal(
    statusFor(device, { ...sample, device_id: "other" }, {}, now),
    "offline",
  );
  assert.equal(
    statusFor(device, { ...sample, source: "simulation" }, {}, now),
    "offline",
  );
  assert.equal(
    statusFor({ ...device, enabled: false }, sample, {}, now),
    "disabled",
  );
});
