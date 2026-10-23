import test from "node:test";
import assert from "node:assert/strict";
import {
  sensorFaults,
  validateRemoteSamples,
  liveEligible,
  baselineChange,
} from "../server/advanced-analysis.js";
import { signal } from "../server/sensor-simulator.js";
test("fault diagnostics distinguish missing/stuck/noisy/saturated inputs without structural classification", () => {
  const now = Date.now(),
    rows = Array.from({ length: 100 }, () => ({ x: 0, y: 0, z: 1 }));
  assert.deepEqual(
    sensorFaults(rows, new Date(now), 5000, now).faults.map((v) => v.code),
    ["stuck"],
  );
  assert.equal(sensorFaults([], null, 5000, now).faults[0].code, "missing");
  assert.equal(
    sensorFaults(rows.slice(0, 20), new Date(now), 5000, now).sufficient,
    false,
  );
  const noise = rows.map((r, i) => ({ ...r, x: i % 2 ? 16 : -16 }));
  assert.deepEqual(
    sensorFaults(noise, new Date(now), 5000, now).faults.map((v) => v.code),
    ["noise", "saturation"],
  );
});
test("batch validation rejects duplicate IDs, invalid times, nonfinite values and environmental outliers", () => {
  const now = Date.now(),
    s = {
      sequence: 1,
      measured_at: new Date(now).toISOString(),
      x: 0,
      y: 0,
      z: 1,
      temperature: 30,
      tilt_x: 2,
    };
  const b = { device_id: "esp32-test", boot_id: "boot-01", samples: [s] };
  assert.equal(validateRemoteSamples(b, now).length, 1);
  for (const samples of [
    [s, s],
    [{ ...s, x: NaN }],
    [{ ...s, temperature: 200 }],
    [{ ...s, measured_at: new Date(now + 10000).toISOString() }],
    [{ ...s, measured_at: new Date(now - 31 * 86400000).toISOString() }],
  ])
    assert.throws(() => validateRemoteSamples({ ...b, samples }, now));
});
test("late and reordered readings cannot enter the live alarm pipeline", () => {
  const now = Date.now();
  assert.equal(liveEligible(now - 100, now, null, 5000), true);
  assert.equal(liveEligible(now - 6000, now, null, 5000), false);
  assert.equal(liveEligible(now - 1000, now, now - 500, 5000), false);
  assert.equal(liveEligible(now, now, now, 5000), false);
});
test("baseline comparison handles zero baselines and vehicle scenario has a crossing envelope", () => {
  assert.equal(baselineChange({ mean_rms: 0 }, 0.1).ratio, null);
  assert.equal(baselineChange({ mean_rms: 0.1 }, 0.2).ratio, 2);
  assert.deepEqual(signal(3, { scenario: "sensor_fault" }), {
    x: 0,
    y: 0,
    z: 1,
  });
  const config = {
    scenario: "vehicle",
    amplitude: 0.2,
    frequency: 1.6,
    noise: 0,
  };
  assert.deepEqual(signal(0, config), { x: 0, y: 0, z: 1 });
  assert.ok(Math.hypot(signal(6, config).x, signal(6, config).y) > 0.01);
});
