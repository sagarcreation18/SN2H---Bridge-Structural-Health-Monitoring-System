import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function harness(search = "", audio = false) {
  let now = Date.now(),
    interval;
  let tones = 0;
  class Audio {
    state = "suspended";
    currentTime = 0;
    destination = {};
    async resume() {
      this.state = "running";
    }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
        start() {
          tones++;
        },
        stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
  }
  const elements = new Map(),
    classes = new Set();
  const get = (id) => {
    if (!elements.has(id))
      elements.set(id, { hidden: false, textContent: "", onclick: null });
    return elements.get(id);
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const context = {
    window: audio ? { AudioContext: Audio } : {},
    location: { search },
    URLSearchParams,
    Date: Clock,
    setInterval: (fn) => (interval = fn),
    document: {
      getElementById: get,
      addEventListener() {},
      body: {
        classList: {
          toggle(name, on) {
            on ? classes.add(name) : classes.delete(name);
          },
        },
      },
    },
  };
  vm.runInNewContext(
    readFileSync(new URL("../public/alarm.js", import.meta.url), "utf8"),
    context,
  );
  return {
    alarm: context.window.SN2HAlarm,
    get,
    active: () => classes.has("critical-mode"),
    tones: () => tones,
    advance(ms) {
      now += ms;
      interval();
    },
    reading(status) {
      return { status, rms: 0.5, timestamp: new Date(now).toISOString() };
    },
  };
}
test("critical alarm follows fresh live readings and clears on recovery, staleness, or disconnect", () => {
  const h = harness(),
    s = { offlineMs: 5000, sound: false };
  h.alarm.sync(h.reading("normal"), s, true);
  assert.equal(h.active(), false);
  h.alarm.sync(h.reading("critical"), s, true);
  assert.equal(h.active(), true);
  assert.equal(h.get("criticalAlarm").hidden, false);
  h.alarm.sync(h.reading("normal"), s, true);
  assert.equal(h.active(), false);
  h.alarm.sync(h.reading("critical"), s, true);
  h.advance(5001);
  assert.equal(h.active(), false);
  h.alarm.sync(h.reading("critical"), s, false);
  assert.equal(h.active(), false);
});
test("preview sound starts after interaction, repeats, and respects mute", async () => {
  const h = harness("", true);
  assert.equal(h.tones(), 0);
  h.get("previewCriticalAlarm").onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.tones(), 2);
  h.advance(2300);
  assert.equal(h.tones(), 4);
  h.get("muteCriticalAlarm").onclick();
  h.advance(2300);
  assert.equal(h.tones(), 4);
});
test("preview can be stopped, expires after 20 seconds, and does not hide a continuing real critical condition", () => {
  const h = harness("?alarmPreview=1");
  assert.equal(h.active(), true);
  assert.match(h.get("criticalAlarmTitle").textContent, /PREVIEW/);
  h.get("endAlarmPreview").onclick();
  assert.equal(h.active(), false);
  h.get("previewCriticalAlarm").onclick();
  assert.equal(h.active(), true);
  h.advance(20001);
  assert.equal(h.active(), false);
  const k = harness("?alarmPreview=1");
  k.alarm.sync(k.reading("critical"), { offlineMs: 60000 }, true);
  k.advance(20001);
  assert.equal(k.active(), true);
  assert.doesNotMatch(k.get("criticalAlarmTitle").textContent, /PREVIEW/);
});
