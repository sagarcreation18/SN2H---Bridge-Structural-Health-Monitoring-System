import "dotenv/config";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
const base = "http://127.0.0.1:" + (process.env.PORT || 3100),
  headers = { Authorization: "Bearer " + process.env.ADMIN_TOKEN };
async function call(path) {
  const r = await fetch(base + "/api" + path, { method: "POST", headers });
  const json = await r.json();
  assert.ok(r.ok, JSON.stringify(json));
  return json;
}
const socket = io(base, { transports: ["websocket"] }),
  statuses = new Set(),
  scenarios = new Set();
socket.on("sensor:update", (r) => {
  if (r.source === "simulation") statuses.add(r.status);
});
socket.on("simulation:status", (s) => scenarios.add(s.scenario));
let started = false;
try {
  const demo = await call("/demo/start");
  started = true;
  assert.equal(demo.state, "running");
  console.log("Guided demo started. Testing all four stages.");
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Guided demo exceeded 60 seconds")),
      60000,
    );
    socket.on("demo:status", (s) => {
      if (s.state === "complete") {
        clearTimeout(timer);
        resolve(s);
      } else if (s.state === "failed" || s.state === "cancelled") {
        clearTimeout(timer);
        reject(new Error("Demo ended " + s.state));
      }
    });
  });
  assert.equal(result.step, 3);
  for (const value of ["normal", "warning", "critical"])
    assert.ok(statuses.has(value), "Missing measured status " + value);
  for (const s of ["normal", "heavy", "critical"]) assert.ok(scenarios.has(s));
  const sample = await (await fetch(base + "/api/sensor-data/latest")).json();
  assert.equal(sample.status, "normal");
  await call("/demo/start");
  await call("/demo/stop");
  const stopped = await (await fetch(base + "/api/simulation/status")).json();
  assert.equal(stopped.state, "stopped");
  const demoStopped = await (await fetch(base + "/api/demo/status")).json();
  assert.equal(demoStopped.state, "cancelled");
  console.log(
    "PASS: full normal → warning → critical → recovery sequence, measured threshold states, completion, and cancellation.",
  );
} finally {
  socket.disconnect();
  if (started) {
    await call("/demo/stop");
    await call("/simulation/stop");
    const r = await fetch(base + "/api/simulation/start", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "normal" }),
    });
    assert.ok(r.ok);
  }
}
