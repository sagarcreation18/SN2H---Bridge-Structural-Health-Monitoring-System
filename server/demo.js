import { query } from "./db.js";
import { fail } from "./validation.js";
export const demoSteps = [
  { scenario: "normal", seconds: 12, title: "Normal observation" },
  { scenario: "heavy", seconds: 10, title: "Warning threshold demonstration" },
  { scenario: "critical", seconds: 10, title: "Critical alarm demonstration" },
  { scenario: "normal", seconds: 12, title: "Recovery and normal operation" },
];
export class DemoRunner {
  constructor(monitor) {
    this.monitor = monitor;
    this.state = { state: "idle", step: 0, steps: demoSteps };
  }
  snapshot() {
    return {
      ...this.state,
      remainingSeconds: this.state.deadline
        ? Math.max(0, Math.ceil((this.state.deadline - Date.now()) / 1000))
        : 0,
    };
  }
  emit() {
    this.monitor.io.emit("demo:status", this.snapshot());
  }
  async start() {
    if (this.state.state === "running")
      throw fail("A guided demo is already running", 409);
    if (!this.monitor.simEnabled)
      throw fail("Enable the simulated device first", 409);
    if (this.monitor.settings.samplingMs >= 200)
      throw fail("Set sampling interval below 200 ms before this demo", 409);
    if (this.monitor.settings.critical > 1)
      throw fail(
        "Guided demo supports critical thresholds up to 1 g. Choose suitable demonstration thresholds first.",
        409,
      );
    await this.monitor.control("stop");
    const result = await query(
      "INSERT INTO demo_runs(state) VALUES ('running')",
    );
    this.state = {
      state: "running",
      step: 0,
      steps: demoSteps,
      id: result.insertId,
    };
    try {
      await this.advance();
    } catch (e) {
      await this.stop("failed");
      throw e;
    }
    return this.snapshot();
  }
  async advance() {
    if (this.state.state !== "running") return;
    const step = demoSteps[this.state.step];
    await this.monitor.control("stop");
    if (this.state.state !== "running") return;
    const { warning, critical } = this.monitor.settings;
    const amplitude =
      step.scenario === "normal"
        ? Math.min(0.035, warning * 0.2)
        : step.scenario === "heavy"
          ? (warning + critical) / 1.8
          : Math.min(2, critical * 1.8 + 0.02);
    await this.monitor.control("start", {
      scenario: step.scenario,
      amplitude,
      noise: Math.min(0.008, amplitude * 0.1),
    });
    if (this.state.state !== "running") return;
    this.state.deadline = Date.now() + step.seconds * 1000;
    await query("UPDATE demo_runs SET step=? WHERE id=?", [
      this.state.step,
      this.state.id,
    ]);
    this.emit();
    this.timer = setTimeout(async () => {
      try {
        if (this.state.state !== "running") return;
        if (this.state.step === demoSteps.length - 1) {
          this.state.state = "complete";
          delete this.state.deadline;
          await query(
            "UPDATE demo_runs SET state='complete',ended_at=UTC_TIMESTAMP(3) WHERE id=?",
            [this.state.id],
          );
          this.emit();
        } else {
          this.state.step++;
          await this.advance();
        }
      } catch (e) {
        console.error("Guided demo:", e.message);
        await this.stop("failed");
      }
    }, step.seconds * 1000);
  }
  async stop(reason = "cancelled", stopSimulation = true) {
    clearTimeout(this.timer);
    if (this.state.state === "running") {
      this.state.state = reason;
      delete this.state.deadline;
      await query(
        "UPDATE demo_runs SET state=?,ended_at=UTC_TIMESTAMP(3) WHERE id=?",
        [reason, this.state.id],
      );
      if (stopSimulation) await this.monitor.control("stop");
      this.emit();
    }
    return this.snapshot();
  }
  close() {
    clearTimeout(this.timer);
  }
}
