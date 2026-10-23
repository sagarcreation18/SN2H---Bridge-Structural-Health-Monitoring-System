import { fail } from "./validation.js";
// Radix-2 FFT after timestamp-based linear resampling, DC removal and a Hann window.
export function spectrum(rows, axis = "x") {
  if (!["x", "y", "z"].includes(axis)) throw fail("Axis must be x, y or z");
  const points = rows
    .map((r) => ({ t: +new Date(r.timestamp), v: Number(r[axis]) }))
    .filter(
      (p, i, a) =>
        Number.isFinite(p.v) &&
        Number.isFinite(p.t) &&
        (!i || p.t > a[i - 1].t),
    );
  if (points.length < 32)
    throw fail(
      "At least 32 stored measurements are needed for frequency analysis",
      422,
    );
  const deltas = points.slice(1).map((p, i) => p.t - points[i].t),
    sorted = [...deltas].sort((a, b) => a - b),
    step = sorted[Math.floor(sorted.length / 2)];
  if (step <= 0 || Math.max(...deltas) > step * 8)
    throw fail(
      "This window contains a large data gap. Choose a recent continuous recording.",
      422,
    );
  const available = Math.floor((points.at(-1).t - points[0].t) / step) + 1;
  const n = 2 ** Math.floor(Math.log2(Math.min(available, 1024)));
  if (n < 32) throw fail("Recording duration is too short", 422);
  const start = points.at(-1).t - (n - 1) * step;
  let j = 0;
  const values = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    while (j < points.length - 2 && points[j + 1].t < t) j++;
    const a = points[j],
      b = points[j + 1];
    values.push(
      a.v + (b.v - a.v) * Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))),
    );
  }
  const mean = values.reduce((a, b) => a + b, 0) / n,
    re = values.map(
      (v, i) =>
        (v - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))),
    ),
    im = Array(n).fill(0);
  const windowSum = (n - 1) / 2;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    for (let base = 0; base < n; base += size) {
      for (let k = 0; k < size / 2; k++) {
        const theta = (-2 * Math.PI * k) / size,
          c = Math.cos(theta),
          s = Math.sin(theta),
          a = base + k,
          b = a + size / 2,
          tr = re[b] * c - im[b] * s,
          ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const bins = Array.from({ length: n / 2 + 1 }, (_, i) => ({
    frequency: (i * 1000) / (n * step),
    amplitude:
      (Math.hypot(re[i], im[i]) * (i === 0 || i === n / 2 ? 1 : 2)) / windowSum,
  }));
  const peak = bins
    .slice(1)
    .reduce((a, b) => (b.amplitude > a.amplitude ? b : a));
  return {
    axis,
    samples: n,
    sampleRate: 1000 / step,
    resolution: 1000 / (step * n),
    dominantHz: peak.frequency,
    bins,
    quality:
      "Estimate from receive timestamps; linearly resampled with a Hann window. Not a modal or structural diagnosis.",
  };
}
