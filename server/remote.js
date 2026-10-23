import { createHash } from "node:crypto";
import { query, pool } from "./db.js";
import { equal } from "./auth.js";
import { fail, validateHealth } from "./validation.js";
import { validateRemoteSamples, liveEligible } from "./advanced-analysis.js";
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export async function deviceAccess(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (typeof token !== "string" || token.length < 24 || token.length > 256)
      throw fail("Device authentication required", 401);
    const [credential] = await query(
      "SELECT token_hash FROM device_credentials WHERE device_id=?",
      [req.body?.device_id || ""],
    );
    const valid = credential
      ? equal(tokenHash(token), credential.token_hash)
      : process.env.ALLOW_LEGACY_DEVICE_TOKEN !== "false" &&
        equal(token, process.env.DEVICE_TOKEN);
    if (!valid) throw fail("Device authentication required", 401);
    next();
  } catch (e) {
    next(e);
  }
}
export class RemoteIngest {
  constructor(monitor) {
    this.monitor = monitor;
    this.locks = new Map();
  }
  async accept(body) {
    const samples = validateRemoteSamples(body);
    validateHealth(body.health);
    const prior = this.locks.get(body.device_id) || Promise.resolve();
    const current = prior.catch(() => {}).then(() => this.save(body, samples));
    this.locks.set(body.device_id, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(body.device_id) === current)
        this.locks.delete(body.device_id);
    }
  }
  async save(body, samples) {
    const tx = await pool.getConnection();
    let accepted = 0,
      duplicates = 0;
    try {
      await tx.beginTransaction();
      const [devices] = await tx.execute(
        "SELECT id FROM devices WHERE id=? AND enabled=TRUE AND source='hardware' FOR UPDATE",
        [body.device_id],
      );
      if (!devices.length)
        throw fail("Unknown or disabled hardware device", 403);
      for (const s of samples) {
        const [r] = await tx.execute(
          "INSERT IGNORE INTO remote_samples(device_id,boot_id,sequence_no,measured_at,x,y,z,temperature,tilt_x,tilt_y) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [
            body.device_id,
            body.boot_id,
            s.sequence,
            s.timestamp,
            s.x,
            s.y,
            s.z,
            s.temperature ?? null,
            s.tilt_x ?? null,
            s.tilt_y ?? null,
          ],
        );
        if (r.affectedRows) accepted++;
        else {
          const [[old]] = await tx.execute(
            "SELECT measured_at,x,y,z,temperature,tilt_x,tilt_y FROM remote_samples WHERE device_id=? AND boot_id=? AND sequence_no=?",
            [body.device_id, body.boot_id, s.sequence],
          );
          if (
            +new Date(old.measured_at) !== +s.timestamp ||
            ["x", "y", "z", "temperature", "tilt_x", "tilt_y"].some(
              (k) => (old[k] ?? null) !== (s[k] ?? null),
            )
          )
            throw fail("Sequence already exists with different data", 409);
          duplicates++;
        }
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.release();
    }
    const [last] = await query(
      "SELECT MAX(measured_at) measured_at FROM remote_samples WHERE device_id=? AND disposition='live'",
      [body.device_id],
    );
    let latest = last.measured_at,
      live = 0,
      archived = 0;
    for (const s of samples) {
      const [row] = await query(
        "SELECT * FROM remote_samples WHERE device_id=? AND boot_id=? AND sequence_no=?",
        [body.device_id, body.boot_id, s.sequence],
      );
      if (row.disposition !== "pending") continue;
      const eligible =
        liveEligible(
          row.measured_at,
          row.received_at,
          latest,
          Math.min(this.monitor.settings.offlineMs, 10000),
        ) &&
        Date.now() - +new Date(row.measured_at) <=
          Math.min(this.monitor.settings.offlineMs, 10000);
      if (eligible) {
        await this.monitor.ingest(
          body.device_id,
          { x: row.x, y: row.y, z: row.z, health: body.health },
          "hardware",
          { id: row.id, measuredAt: row.measured_at },
        );
        latest = row.measured_at;
        live++;
      } else archived++;
      if (!eligible)
        await query(
          "UPDATE remote_samples SET disposition='archived' WHERE id=?",
          [row.id],
        );
    }
    return { accepted, duplicates, live, archived };
  }
}
