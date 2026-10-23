export class VibrationProcessor {
  constructor() {
    this.windows = new Map();
  }
  process(deviceId, { x, y, z }, settings) {
    const magnitude = Math.hypot(x, y, z - 1); // Fixed calibrated baseline: (0, 0, 1) g.
    const window = this.windows.get(deviceId) || [];
    window.push(magnitude * magnitude);
    if (window.length > 25) window.shift();
    this.windows.set(deviceId, window);
    const rms = Math.sqrt(window.reduce((a, b) => a + b, 0) / window.length);
    return {
      x,
      y,
      z,
      magnitude,
      rms,
      status:
        rms >= settings.critical
          ? "critical"
          : rms >= settings.warning
            ? "warning"
            : "normal",
    };
  }
  reset(id) {
    this.windows.delete(id);
  }
}
export { scenarios, signal } from "./sensor-simulator.js";
