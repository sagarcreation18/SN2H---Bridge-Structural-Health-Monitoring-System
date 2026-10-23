import nodemailer from "nodemailer";
import { query } from "./db.js";
import { fail } from "./validation.js";
export class Notifications {
  constructor() {
    this.busy = false;
  }
  configured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
  }
  transport() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: process.env.SMTP_SECURE !== "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  async config() {
    const [row] = await query(
      "SELECT config FROM notification_config WHERE id=1",
    );
    return typeof row.config === "string" ? JSON.parse(row.config) : row.config;
  }
  async enqueue(alert) {
    const config = await this.config();
    if (!config.enabled || !config[alert.severity]) return;
    await query(
      "INSERT IGNORE INTO notification_deliveries(alert_id,device_id,severity,recipient) VALUES (?,?,?,?)",
      [alert.id, alert.device_id, alert.severity, config.recipient],
    );
  }
  start() {
    this.timer = setInterval(
      () =>
        this.flush().catch((e) =>
          console.error("Notification worker:", e.message),
        ),
      5000,
    );
  }
  async flush() {
    if (this.busy || !this.configured()) return;
    this.busy = true;
    try {
      const config = await this.config();
      if (!config.enabled) return;
      const rows = await query(
        "SELECT n.*,a.message,a.source,a.timestamp FROM notification_deliveries n JOIN alerts a ON a.id=n.alert_id WHERE n.status IN ('queued','retry') AND n.next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY n.id LIMIT 5",
      );
      for (const row of rows) {
        const [last] = await query(
          "SELECT sent_at FROM notification_deliveries WHERE device_id=? AND severity=? AND status='sent' ORDER BY sent_at DESC LIMIT 1",
          [row.device_id, row.severity],
        );
        if (
          last &&
          Date.now() - new Date(last.sent_at).getTime() <
            config.cooldownSeconds * 1000
        ) {
          await query(
            "UPDATE notification_deliveries SET status='suppressed',detail='Device/severity cooldown' WHERE id=?",
            [row.id],
          );
          continue;
        }
        try {
          await this.transport().sendMail({
            from: process.env.SMTP_FROM,
            to: row.recipient,
            subject: `SN²H ${row.severity.toUpperCase()} / ${row.source.toUpperCase()} / ${row.device_id}`,
            text: `${row.message}\nSource: ${row.source}\nDevice: ${row.device_id}\nRecorded: ${new Date(row.timestamp).toISOString()}\nDemonstration thresholds only. Inspect the monitoring dashboard; this email does not certify structural safety.`,
          });
          await query(
            "UPDATE notification_deliveries SET status='sent',attempts=attempts+1,sent_at=UTC_TIMESTAMP(3),detail=NULL WHERE id=?",
            [row.id],
          );
        } catch {
          await query(
            "UPDATE notification_deliveries SET status=?,attempts=attempts+1,detail='SMTP delivery failed; check server configuration',next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE id=?",
            [row.attempts >= 2 ? "failed" : "retry", row.id],
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async verify() {
    if (!this.configured())
      throw fail("Configure SMTP_HOST and SMTP_FROM in .env first", 503);
    await this.transport().verify();
    return { verified: true };
  }
  close() {
    clearInterval(this.timer);
  }
}
