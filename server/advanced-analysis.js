import { fail } from "./validation.js";

export function sensorFaults(rows, lastSeen, offlineMs, now = Date.now()) {
  const faults = [];
  if (!lastSeen || now - +new Date(lastSeen) > offlineMs)
    faults.push({ code: "missing", message: "No recent live measurements" });
  if (rows.length < 50)
    return { faults, samples: rows.length, sufficient: false };
  const recent = rows.slice(0, 100);
  const identical = recent.every((r) =>
    ["x", "y", "z"].every((k) => Math.abs(r[k] - recent[0][k]) < 1e-8),
  );
  if (identical)
    faults.push({
      code: "stuck",
      message:
        "Identical samples: check sensor, mounting and acquisition. Stationary quantized sensors may also produce this pattern.",
    });
  const jumps = recent
    .slice(1)
    .map((r, i) =>
      Math.hypot(r.x - recent[i].x, r.y - recent[i].y, r.z - recent[i].z),
    );
  if (jumps.filter((v) => v > 0.5).length / jumps.length > 0.3)
    faults.push({
      code: "noise",
      message:
        "Frequent changes above 0.5 g: inspect vibration, noise and sensor wiring",
    });
  if (
    recent.some(
      (r) => Math.max(Math.abs(r.x), Math.abs(r.y), Math.abs(r.z)) >= 15.9,
    )
  )
    faults.push({
      code: "saturation",
      message: "Readings approach the ±16 g input limit",
    });
  return { faults, samples: recent.length, sufficient: true };
}

export function validateRemoteSamples(body, now = Date.now()) {
  if (
    !body ||
    typeof body.device_id !== "string" ||
    !/^esp32-[\w-]{1,30}$/.test(body.device_id)
  )
    throw fail("Valid hardware device_id required");
  if (typeof body.boot_id !== "string" || !/^[\w-]{1,64}$/.test(body.boot_id))
    throw fail("boot_id must identify this acquisition boot");
  if (
    !Array.isArray(body.samples) ||
    !body.samples.length ||
    body.samples.length > 100
  )
    throw fail("Send 1–100 samples per batch");
  const seen = new Set();
  return body.samples
    .map((s) => {
      if (
        !s ||
        !Number.isSafeInteger(s.sequence) ||
        s.sequence < 0 ||
        seen.has(s.sequence)
      )
        throw fail("Each sample needs a unique nonnegative integer sequence");
      seen.add(s.sequence);
      if (
        typeof s.measured_at !== "string" ||
        !/^\d{4}-\d\d-\d\dT.*Z$/.test(s.measured_at)
      )
        throw fail("measured_at must be an ISO UTC timestamp ending Z");
      const timestamp = +new Date(s.measured_at);
      if (
        !Number.isFinite(timestamp) ||
        timestamp > now + 5000 ||
        timestamp < now - 30 * 86400000
      )
        throw fail(
          "Sample time must be within the last 30 days and at most 5 seconds ahead",
        );
      for (const k of ["x", "y", "z"])
        if (
          typeof s[k] !== "number" ||
          !Number.isFinite(s[k]) ||
          Math.abs(s[k]) > 16
        )
          throw fail("Acceleration must be finite within ±16 g");
      for (const [k, min, max] of [
        ["temperature", -80, 150],
        ["tilt_x", -180, 180],
        ["tilt_y", -180, 180],
      ])
        if (
          s[k] !== undefined &&
          (typeof s[k] !== "number" ||
            !Number.isFinite(s[k]) ||
            s[k] < min ||
            s[k] > max)
        )
          throw fail("Invalid " + k);
      return { ...s, timestamp: new Date(timestamp) };
    })
    .sort((a, b) => a.sequence - b.sequence);
}

export function liveEligible(
  measuredAt,
  receivedAt,
  latestMeasuredAt,
  freshnessMs,
) {
  return (
    +new Date(measuredAt) >
      +(latestMeasuredAt ? new Date(latestMeasuredAt) : 0) &&
    Math.abs(+new Date(receivedAt) - +new Date(measuredAt)) <= freshnessMs
  );
}

export function baselineChange(baseline, current) {
  return {
    baseline: baseline.mean_rms,
    current,
    delta: current - baseline.mean_rms,
    ratio: baseline.mean_rms > 1e-6 ? current / baseline.mean_rms : null,
  };
}
