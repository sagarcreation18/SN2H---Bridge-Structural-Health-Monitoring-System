import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";
import { Monitor } from "../server/service.js";
import { pool, query } from "../server/db.js";
test("MySQL persists ingestion, scenarios, alerts, controls, and stale devices", async () => {
  const io = { emit() {} },
    m = new Monitor(io);
  await m.init();
  clearInterval(m.timer);
  clearInterval(m.watch);
  try {
    const before = (
      await query("SELECT COUNT(*) count FROM sensor_readings")
    )[0].count;
    for (const scenario of ["normal", "heavy", "critical"]) {
      await m.control("start", { scenario });
      for (let i = 0; i < 30; i++)
        await m.ingest(
          "sim-adxl345",
          (await import("../server/processing.js")).signal(i * 0.05, m.sim),
          "simulation",
        );
      await m.control("pause");
      assert.equal(m.sim.state, "paused");
      await m.control("resume");
      assert.equal(m.sim.state, "running");
      await m.control("stop");
    }
    assert.equal(
      (await query("SELECT COUNT(*) count FROM sensor_readings"))[0].count -
        before,
      90,
    );
    const alerts = await query(
      "SELECT DISTINCT severity FROM alerts WHERE source='simulation'",
    );
    assert.ok(alerts.some((a) => a.severity === "warning"));
    assert.ok(alerts.some((a) => a.severity === "critical"));
    await query(
      "UPDATE devices SET last_seen=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE id='sim-adxl345'",
    );
    await m.checkOffline();
    assert.ok(m.offline.has("sim-adxl345"));
    await m.control("reset");
    assert.equal(m.sim.elapsed, 0);
    await assert.rejects(() =>
      m.ingest("esp32-01", { x: 0, y: 0, z: 1 }, "simulation"),
    );
    await assert.rejects(() => m.control("resume"));
  } finally {
    m.close();
    await pool.end();
  }
});
