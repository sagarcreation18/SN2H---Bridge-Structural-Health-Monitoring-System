// Run with the main Node server stopped. Starts/stops its own protected server.
import "dotenv/config";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { query, pool } from "../server/db.js";
import { hashPassword } from "../server/auth.js";
const base = "http://127.0.0.1:3100",
  username = "test-secure-" + randomBytes(4).toString("hex"),
  password = randomBytes(16).toString("hex");
let child, socket, anonymous;
try {
  const occupied = await fetch(base + "/api/health")
    .then(() => true)
    .catch(() => false);
  assert.equal(occupied, false, "Stop the main server before this test");
  await query(
    "INSERT INTO app_users(username,password_hash,role) VALUES (?,?,'viewer')",
    [username, await hashPassword(password)],
  );
  child = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: "3100",
      HOST: "127.0.0.1",
      REQUIRE_SIGN_IN: "true",
      ALLOW_LEGACY_DEVICE_TOKEN: "false",
      BACKUP_INTERVAL_HOURS: "0",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (
      await fetch(base + "/api/health")
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Protected server did not start");
  assert.equal((await fetch(base + "/api/fleet")).status, 401);
  anonymous = io(base, { transports: ["websocket"], reconnection: false });
  const denial = await Promise.race([
    once(anonymous, "connect_error"),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Missing anonymous socket rejection")),
        3000,
      ),
    ),
  ]);
  assert.match(denial[0].message, /Sign in/);
  anonymous.disconnect();
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0],
    session = await login.json();
  assert.equal(
    (await fetch(base + "/api/fleet", { headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/inspections", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": session.csrf,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    401,
  );
  socket = io(base, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: cookie },
  });
  await Promise.race([
    once(socket, "connect"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Authenticated socket failed")), 3000),
    ),
  ]);
  const disconnected = once(socket, "disconnect");
  const logout = await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": session.csrf },
  });
  assert.equal(logout.status, 200);
  await Promise.race([
    disconnected,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Logout did not disconnect live stream")),
        3000,
      ),
    ),
  ]);
  assert.equal(
    (await fetch(base + "/api/fleet", { headers: { Cookie: cookie } })).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/sensor-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.DEVICE_TOKEN,
        },
        body: JSON.stringify({ device_id: "esp32-01", x: 0, y: 0, z: 1 }),
      })
    ).status,
    401,
  );
  console.log(
    "PASS: protected reads, anonymous WebSocket rejection, viewer sign-in/read access, mutation denial, logout stream revocation, and disabled legacy ingestion.",
  );
} finally {
  socket?.disconnect();
  anonymous?.disconnect();
  if (child) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  await query("DELETE FROM app_users WHERE username=?", [username]);
  await pool.end();
}
