import test from "node:test";
import assert from "node:assert/strict";
import { AdvancedWorker } from "../server/advanced-worker.js";
test("escalation cancels acknowledged alerts and retries failed delivery without external mail", async () => {
  const updates = [],
    sent = [];
  const worker = new AdvancedWorker(
    {
      configured: () => true,
      transport: () => ({
        sendMail: async (m) => {
          sent.push(m);
          throw new Error("mock network failure");
        },
      }),
    },
    {
      queryFn: async (sql, args) => {
        if (sql === "SELECT config FROM escalation_config WHERE id=1")
          return [
            {
              config: {
                enabled: true,
                recipient: "backup@example.invalid",
                delayMinutes: 10,
              },
            },
          ];
        if (sql.startsWith("SELECT e.*"))
          return [
            { alert_id: 1, acknowledged: 1 },
            {
              alert_id: 2,
              acknowledged: 0,
              attempts: 0,
              source: "simulation",
              device_id: "test",
              message: "Mock only",
              recipient: "backup@example.invalid",
            },
          ];
        if (sql === "SELECT acknowledged FROM alerts WHERE id=?")
          return [{ acknowledged: 0 }];
        if (sql.startsWith("UPDATE")) updates.push({ sql, args });
        return {};
      },
    },
  );
  await worker.escalate();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /simulation/);
  assert.ok(
    updates.some((v) => v.sql.includes("state='cancelled'") && v.args[0] === 1),
  );
  assert.ok(updates.some((v) => v.args[0] === "retry" && v.args[1] === 2));
});
test("disabled escalation does not enqueue or deliver", async () => {
  let calls = 0;
  const worker = new AdvancedWorker(
    { configured: () => true },
    {
      queryFn: async () => {
        calls++;
        return [{ config: { enabled: false } }];
      },
    },
  );
  await worker.escalate();
  assert.equal(calls, 1);
});
test("push delivery uses short TTL, expires old/acknowledged alerts and removes dead subscriptions", async () => {
  const updates = [],
    sent = [],
    now = new Date();
  const rows = [
    { id: 1, acknowledged: 1, timestamp: now },
    { id: 2, acknowledged: 0, timestamp: new Date(Date.now() - 360000) },
    {
      id: 3,
      acknowledged: 0,
      timestamp: now,
      subscription: { endpoint: "https://example.invalid" },
      subscription_id: 7,
      message: "Mock",
      device_id: "fixture",
      source: "simulation",
      alert_id: 8,
      attempts: 0,
    },
  ];
  const worker = new AdvancedWorker(
    {},
    {
      queryFn: async (sql, args) => {
        if (sql.startsWith("SELECT p.*")) return rows;
        if (sql.startsWith("UPDATE") || sql.startsWith("DELETE"))
          updates.push({ sql, args });
        return {};
      },
      sendPush: async (sub, payload, options) => {
        sent.push({ payload: JSON.parse(payload), options });
        throw Object.assign(new Error("expired"), { statusCode: 410 });
      },
    },
  );
  await worker.push();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.TTL, 60);
  assert.equal(sent[0].payload.url, "/#alerts");
  assert.ok(
    updates.some(
      (v) =>
        v.sql.startsWith("DELETE FROM push_subscriptions") && v.args[0] === 7,
    ),
  );
  assert.equal(
    updates.filter((v) => v.sql.includes("state='expired'")).length,
    2,
  );
});
