import test from "node:test";
import assert from "node:assert/strict";
import { spectrum } from "../server/spectrum.js";
import { hashPassword, checkPassword } from "../server/auth.js";
test("FFT resolves a known sine frequency and amplitude while removing gravity/DC", () => {
  const origin = Date.now();
  const rows = Array.from({ length: 512 }, (_, i) => ({
    timestamp: new Date(origin + i * 10),
    x: 2 + 0.2 * Math.sin((2 * Math.PI * 10 * i) / 100),
    y: 0,
    z: 1,
  }));
  const s = spectrum(rows, "x");
  assert.ok(Math.abs(s.dominantHz - 10) < s.resolution);
  assert.ok(
    Math.abs(Math.max(...s.bins.map((b) => b.amplitude)) - 0.2) < 0.025,
  );
  assert.ok(s.bins[0].amplitude < 0.01);
});
test("FFT rejects short or disconnected histories", () => {
  assert.throws(() => spectrum([]), /32/);
  const rows = Array.from({ length: 64 }, (_, i) => ({
    timestamp: new Date(1000 + i * 50 + (i > 30 ? 10000 : 0)),
    x: 0,
  }));
  assert.throws(() => spectrum(rows), /gap/);
});
test("password hashes are salted and only verify the correct secret", async () => {
  const a = await hashPassword("test-password-2026"),
    b = await hashPassword("test-password-2026");
  assert.notEqual(a, b);
  assert.ok(await checkPassword("test-password-2026", a));
  assert.equal(await checkPassword("incorrect-password", a), false);
});
