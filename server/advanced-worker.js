import webpush from "web-push";
import { query } from "./db.js";
import { backup } from "../scripts/backup.mjs";
export const decode = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;
export class AdvancedWorker {
  constructor(
    notifications,
    { queryFn = query, sendPush = webpush.sendNotification.bind(webpush) } = {},
  ) {
    this.notifications = notifications;
    this.query = queryFn;
    this.sendPush = sendPush;
    this.busy = false;
  }
  pushConfigured() {
    return Boolean(
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
    );
  }
  start() {
    const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 0);
    if (hours >= 1 && hours <= 168) {
      this.backupTimer = setInterval(async () => {
        if (this.backupBusy) return;
        this.backupBusy = true;
        try {
          const saved = await backup();
          console.log("Database backup saved:", saved.path);
        } catch (e) {
          console.error("Database backup:", e.message);
        } finally {
          this.backupBusy = false;
        }
      }, hours * 3600000);
    }
    this.timer = setInterval(
      () =>
        this.flush().catch((e) =>
          console.error("Advanced delivery:", e.message),
        ),
      10000,
    );
  }
  close() {
    clearInterval(this.timer);
    clearInterval(this.backupTimer);
  }
  async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.escalate();
      if (this.pushConfigured()) await this.push();
    } finally {
      this.busy = false;
    }
  }
  async escalate() {
    const [row] = await this.query(
      "SELECT config FROM escalation_config WHERE id=1",
    );
    const c = decode(row.config);
    if (!c.enabled || !this.notifications.configured()) return;
    await this.query(
      "INSERT IGNORE INTO alert_escalations(alert_id,recipient) SELECT id,? FROM alerts WHERE severity='critical' AND acknowledged=FALSE AND timestamp<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? MINUTE)",
      [c.recipient, c.delayMinutes],
    );
    const rows = await this.query(
      "SELECT e.*,a.message,a.device_id,a.source,a.acknowledged FROM alert_escalations e JOIN alerts a ON a.id=e.alert_id WHERE e.state IN ('queued','retry') AND e.next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY e.alert_id LIMIT 5",
    );
    for (const a of rows) {
      if (a.acknowledged) {
        await this.query(
          "UPDATE alert_escalations SET state='cancelled',detail='Alert acknowledged' WHERE alert_id=?",
          [a.alert_id],
        );
        continue;
      }
      try {
        // Recheck immediately before delivery; acknowledgment cannot retract an email already sent.
        const [fresh] = await this.query(
          "SELECT acknowledged FROM alerts WHERE id=?",
          [a.alert_id],
        );
        if (!fresh || fresh.acknowledged) continue;
        await this.notifications.transport().sendMail({
          from: process.env.SMTP_FROM,
          to: a.recipient,
          subject: `SN²H unacknowledged critical alert / ${a.source} / ${a.device_id}`,
          text: `Alert ${a.alert_id} remains unacknowledged. ${a.message}\nSource: ${a.source}\nDevice: ${a.device_id}\nInspect the dashboard and follow your response procedure.`,
        });
        await this.query(
          "UPDATE alert_escalations SET state='sent',attempts=attempts+1,sent_at=UTC_TIMESTAMP(3) WHERE alert_id=?",
          [a.alert_id],
        );
      } catch {
        await this.query(
          "UPDATE alert_escalations SET state=?,attempts=attempts+1,detail='SMTP failed',next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE alert_id=?",
          [a.attempts >= 2 ? "failed" : "retry", a.alert_id],
        );
      }
    }
  }
  async push() {
    // Only new alerts are eligible; enabling notifications does not replay old alarms.
    await this.query(
      "INSERT IGNORE INTO push_deliveries(alert_id,subscription_id) SELECT a.id,s.id FROM alerts a JOIN push_subscriptions s ON a.timestamp>=s.created_at WHERE a.severity IN ('critical','offline') AND a.timestamp>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE)",
    );
    const rows = await this.query(
      "SELECT p.*,s.subscription,a.message,a.device_id,a.source,a.acknowledged,a.timestamp FROM push_deliveries p JOIN push_subscriptions s ON s.id=p.subscription_id JOIN alerts a ON a.id=p.alert_id WHERE p.state IN ('queued','retry') AND p.next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY p.id LIMIT 10",
    );
    for (const r of rows) {
      if (r.acknowledged || Date.now() - +new Date(r.timestamp) > 300000) {
        await this.query(
          "UPDATE push_deliveries SET state='expired' WHERE id=?",
          [r.id],
        );
        continue;
      }
      try {
        await this.sendPush(
          decode(r.subscription),
          JSON.stringify({
            title: `SN²H / ${r.source} / ${r.device_id}`,
            body: r.message,
            tag: `alert-${r.alert_id}`,
            url: "/#alerts",
          }),
          {
            vapidDetails: {
              subject: process.env.VAPID_SUBJECT,
              publicKey: process.env.VAPID_PUBLIC_KEY,
              privateKey: process.env.VAPID_PRIVATE_KEY,
            },
            TTL: 60,
            timeout: 10000,
            urgency: "high",
          },
        );
        await this.query(
          "UPDATE push_deliveries SET state='sent',attempts=attempts+1 WHERE id=?",
          [r.id],
        );
      } catch (e) {
        if ([404, 410].includes(e.statusCode))
          await this.query("DELETE FROM push_subscriptions WHERE id=?", [
            r.subscription_id,
          ]);
        else
          await this.query(
            "UPDATE push_deliveries SET state=?,attempts=attempts+1,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE id=?",
            [r.attempts >= 2 ? "failed" : "retry", r.id],
          );
      }
    }
  }
}
