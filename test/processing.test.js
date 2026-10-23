import test from "node:test";
import assert from "node:assert/strict";
import { VibrationProcessor, signal, scenarios } from "../server/processing.js";
const settings = { warning: 0.15, critical: 0.35 };
test("stationary gravity is removed, and RMS windows stay independent", () => {
  const p = new VibrationProcessor();
  assert.equal(p.process("a", { x: 0, y: 0, z: 1 }, settings).rms, 0);
  assert.equal(p.process("b", { x: 1, y: 0, z: 1 }, settings).rms, 1);
  assert.equal(p.process("a", { x: 0, y: 0, z: 1 }, settings).rms, 0);
});
test("repeatable scenarios demonstrate normal, warning and critical", () => {
  for (const [name, status] of [
    ["normal", "normal"],
    ["heavy", "warning"],
    ["critical", "critical"],
  ]) {
    const p = new VibrationProcessor();
    let r;
    for (let i = 0; i < 200; i++)
      r = p.process("a", signal(i * 0.05, scenarios[name]), settings);
    assert.equal(r.status, status);
    assert.deepEqual(signal(2, scenarios[name]), signal(2, scenarios[name]));
  }
});
test("rolling RMS evicts old samples and reset clears a device", () => {
  const p = new VibrationProcessor();
  p.process("a", { x: 1, y: 0, z: 1 }, settings);
  for (let i = 0; i < 25; i++) p.process("a", { x: 0, y: 0, z: 1 }, settings);
  assert.equal(p.process("a", { x: 0, y: 0, z: 1 }, settings).rms, 0);
  p.reset("a");
  assert.equal(
    p.process("a", { x: 0.15, y: 0, z: 1 }, settings).status,
    "warning",
  );
});
