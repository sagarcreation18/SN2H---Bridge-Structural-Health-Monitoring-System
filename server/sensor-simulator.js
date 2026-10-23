export const scenarios = {
  normal: { amplitude: 0.035, frequency: 1.1, noise: 0.008 },
  light: { amplitude: 0.12, frequency: 1.6, noise: 0.015 },
  heavy: { amplitude: 0.29, frequency: 2.2, noise: 0.025 },
  wind: { amplitude: 0.18, frequency: 0.5, noise: 0.035 },
  seismic: { amplitude: 0.55, frequency: 3, noise: 0.04 },
  critical: { amplitude: 0.7, frequency: 2.5, noise: 0.03 },
  custom: { amplitude: 0.1, frequency: 1, noise: 0.01 },
  vehicle: { amplitude: 0.2, frequency: 1.6, noise: 0.01 },
  sensor_fault: { amplitude: 0, frequency: 1, noise: 0 },
  connection_loss: { amplitude: 0, frequency: 1, noise: 0 },
};
export function signal(t, { amplitude: a, frequency: f, noise: n, scenario }) {
  if (scenario === "sensor_fault") return { x: 0, y: 0, z: 1 };
  if (scenario === "vehicle")
    a *= Math.pow(Math.sin((Math.PI * (t % 12)) / 12), 4);
  const w = 2 * Math.PI * f * t;
  return {
    x: a * Math.sin(w) + n * Math.sin(t * 71),
    y: a * 0.65 * Math.sin(w * 0.87 + 1) + n * Math.cos(t * 53),
    z: 1 + a * 0.45 * Math.cos(w * 1.13) + n * Math.sin(t * 97),
  };
}
