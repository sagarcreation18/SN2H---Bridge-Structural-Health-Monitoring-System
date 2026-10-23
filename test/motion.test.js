import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
    new URL("../public/motion.js", import.meta.url),
    "utf8",
  ),
  app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function harness() {
  const classes = new Set(),
    timers = new Map();
  let sequence = 0;
  const context = {
    window: {},
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null },
    document: {
      hidden: false,
      querySelector: () => ({
        classList: {
          add: (v) => classes.add(v),
          remove: (v) => classes.delete(v),
        },
      }),
    },
    setTimeout: (fn) => {
      const id = ++sequence;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    state: { token: "", csrf: "" },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(
    app.slice(
      app.indexOf("async function api("),
      app.indexOf("async function task("),
    ),
    context,
  );
  return {
    motion: context.window.SN2HMotion,
    context,
    loading: () => classes.has("is-loading"),
    flush: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
}
test("loading feedback stays active until all concurrent requests finish and completion is idempotent", () => {
  const h = harness(),
    first = h.motion.beginRequest(),
    second = h.motion.beginRequest();
  first();
  first();
  h.flush();
  assert.equal(h.loading(), true);
  second();
  assert.equal(h.loading(), false);
});
test("fast background requests do not flash the loading indicator", () => {
  const h = harness(),
    done = h.motion.beginRequest();
  done();
  h.flush();
  assert.equal(h.loading(), false);
});
test("API failures release motion activity for both transport and response parsing errors", async () => {
  for (const response of [
    () => Promise.reject(new Error("transport failed")),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    }),
  ]) {
    const h = harness();
    h.context.fetch = response;
    await assert.rejects(() => h.context.api("/test"));
    h.flush();
    assert.equal(h.loading(), false);
  }
});
