# SN²H advanced features

The bridge map is excluded. Existing accounts, calibration, FFT, event replay, PDF export and the critical alarm are retained.

## Dashboard additions

| Feature | Where to use it | Behavior |
|---|---|---|
| Inspection and maintenance records | Maintenance | Create/edit findings, repairs, responsible person, status and next visit. Upload up to eight JPEG/PNG evidence photos, each at most 2 MB. |
| Alert response notes | Alerts | Add/read a response note using the alert ID. Existing acknowledgment remains available. |
| Critical escalation | Settings | A backup email recipient is notified after a configurable 1–1440 minute delay if a critical alert remains unacknowledged. Queued delivery cancels on acknowledgment; failed deliveries retry up to three attempts. Enabling includes existing overdue critical alerts. |
| Sensor diagnostics | Devices | Check missing samples, 50–100-sample stuck-value patterns, frequent changes above 0.5 g and values near the ±16 g input limit. Indicators require inspection and do not assert structural damage. |
| Baseline comparison | Analytics | Save a named interval containing at least 100 normal samples and no warning/critical samples. Compare its mean RMS with the latest 100 stored samples from that same device. Recreate baselines after changing calibration/mounting. |
| Daily trends | Analytics | Daily mean, maximum RMS and sample counts for the last 30 days, per device. This is descriptive analysis, not predictive maintenance. |
| Temperature and tilt | Devices | View optional temperature °C and tilt_x/tilt_y degrees supplied in timestamped remote samples. Missing values stay absent. A compatible sensor and its acquisition code are required; no temperature is fabricated from the ADXL345. |
| Audit history | Settings, admin only | Paginated record of authenticated mutation requests, account name, resource, result and time. Bodies, tokens and passwords are excluded. Entries also record unsuccessful authenticated requests; this is a local audit trail rather than tamper-proof external logging. |
| Extra demos | Simulation | Vehicle crossings with a 12-second envelope, stuck readings, and a connection-loss scenario that stops measurements while keeping the dashboard connection alive. Stop before changing scenarios. Existing guided critical/recovery demo remains available. |
| Phone notifications | Settings | Opt in per signed-in browser. New critical/offline alerts are delivered through Web Push. Includes persistent delivery status, short TTL, retries, expiration and removal of invalid subscriptions. |

## Outside-city sensors

Use **sensor → ESP32 → Wi-Fi or 4G/SIM router → HTTPS backend → MySQL → live dashboard**. A local `localhost` address is not reachable from another city. The server must remain online; the device initiates outbound HTTPS, so the sensor site does not need an inbound port opened.

The implemented transport is HTTPS. MQTT was described as an alternative; an MQTT broker or gateway is not required or installed by this implementation.

1. Register the hardware device in Devices.
2. Select it under Sensor diagnostics and choose Rotate device credential. Copy the token immediately; only its SHA-256 hash is stored. Rotation revokes prior credentials and shared-token fallback for that device.
3. Configure the ESP32 with the HTTPS host, its device ID, its own token and the verified CA certificate.
4. Send `POST /api/remote/batch` with `Authorization: Bearer <device credential>`:

```json
{
  "device_id": "esp32-01",
  "boot_id": "unique-boot-id",
  "samples": [
    {
      "sequence": 0,
      "measured_at": "2026-10-23T07:30:00.000Z",
      "x": 0.01,
      "y": 0.02,
      "z": 1.0,
      "temperature": 28.5,
      "tilt_x": 0.2,
      "tilt_y": -0.1
    }
  ],
  "health": { "rssi": -65, "uptimeMs": 30000, "firmware": "your-version" }
}
```

The date above is illustrative: use the actual acquisition time. Environmental and health fields are optional. Batches contain 1–100 samples and are limited to 64 KB. UTC timestamps ending Z must be within the last 30 days and at most five seconds ahead. Each `(device_id, boot_id, sequence)` identifies one immutable sample. Duplicate retries are accepted; reusing an ID with different data returns 409 and rolls back that batch's archival inserts.

`measured_at` and server `received_at` are both preserved. Fresh, strictly newer samples enter the normal calibrated vibration pipeline; their acquisition time is used in history. A live dispatch and its database reading commit together. Late or reordered samples are archived in `remote_samples`, accessible under Devices; they do not update live status, rolling RMS or live alerts. Freshness is the smaller of the configured offline timeout and ten seconds. An old upload therefore cannot make an offline sensor look live.

Archived remote readings currently appear in their dedicated remote-history view, not in the existing RMS/PDF/FFT dataset. Those analyses use live-dispatched measurements. This avoids computing misleading vibration windows across upload gaps. Register separate device IDs for separate physical sensors.

### ESP32 offline preparation

Open `firmware/remote_monitor/remote_monitor.ino`; copy its `config.example.h` to `config.h`. This separate sketch uses a LittleFS-backed queue of 1,024 samples and a network task that uploads batches of up to 20. It retains unsent records across restart and reuses their IDs on retry. At the nominal 20 Hz rate the queue holds about 51 seconds; a full queue drops new samples and reports a count in Serial output. Increase storage or use SD storage for longer outages after hardware validation.

Provision a LittleFS partition/filesystem before use. The sketch deliberately uses `LittleFS.begin(false)` and never automatically formats existing data. Until the first clock sync, measurements cannot receive a trusted UTC acquisition timestamp and are counted as dropped for upload. A queue with records older than the server's 30-day limit requires operator handling. Flash wear, power-loss recovery, acquisition cadence, electrical behavior and firmware compilation **remain untested on hardware**. The older direct-ingestion sketch remains available separately; use its `/api/sensor-data` URL rather than the batch URL.

## Phone access and push setup

For same-Wi-Fi viewing, set `HOST=0.0.0.0` in `.env`, restart Node, and use the Local phone address shown under Settings → Remote connection. Windows may require a private-network firewall allowance for port 3100. This change does not supply internet hosting. Do not expose MySQL or the development server directly to the public internet.

For phone push, serve through HTTPS and run `node scripts/vapid-keys.mjs` once. It creates private `.runtime/vapid-keys.env` without printing the keys. Copy the values into `.env`, set VAPID_SUBJECT to your real `mailto:` contact, and restart Node. In Settings, sign in and choose Enable on this device. Browser support and notification permission are required; iOS/iPadOS may require adding the app to the Home Screen. Signing out ends dashboard access but does not cancel an explicitly subscribed phone; disable notifications before signing out when appropriate.

The service worker does not cache dashboard/API data. Push permissions are requested only after clicking Enable. Default allowed push endpoints cover Google, Mozilla and Apple; extend PUSH_ALLOWED_HOSTS only for a trusted provider. SMTP and actual phone delivery have not been exercised externally in this workspace.

## Hosting and operations

`Dockerfile`, `compose.yaml`, and `deploy/nginx.conf.example` provide a single-server deployment starting point. Docker is not installed/validated here, and no cloud service has been purchased or deployed. Provision your server/domain/certificate first. The Compose database is a **new volume**; it does not copy your local database. Use logical backup/restore if you need existing history. Compose currently initializes the fixed `bridge_health_monitor` database.

Set strong distinct DB_USER/DB_PASSWORD, MYSQL_ROOT_PASSWORD, ADMIN_TOKEN and DEVICE_TOKEN in the server's private `.env`. Configure real HTTPS certificate paths and PUBLIC_URL. Compose binds the app port to server loopback and leaves MySQL unexposed. Nginx terminates HTTPS and proxies Socket.IO. Compose enables COOKIE_SECURE, REQUIRE_SIGN_IN, TRUST_PROXY=1 and disables legacy shared device-token access. Only use TRUST_PROXY=1 behind the supplied trusted single proxy. Create the first admin through Sign in with the recovery token; then register/rotate each sensor credential. Configure SMTP before enabling mail or escalation. Use one app instance unless acquisition locking and worker claiming are extended for multiple instances.

For backups on a machine with the official MySQL client, run `node scripts/backup.mjs`. Set MYSQLDUMP_PATH if necessary, e.g. the installed MySQL 8.4 mysqldump.exe on Windows. Output is a compressed consistent SQL dump under `output/backups` (ignored by Git). BACKUP_INTERVAL_HOURS=1–168 enables periodic backups while Node is running; 0 disables. Backups include account hashes and device credential hashes, so protect them and copy them off the source disk. The slim app container does not include mysqldump; schedule host-side backups with a MySQL client or provision it in a custom image. A restart begins a new interval. Backup restore has not been exercised against a separate database here.

Retention defaults to a dry run: `node scripts/retention.mjs --days 90`. Only `--apply` deletes old readings, in bounded batches; minimum retention is 30 days. Alerts, audit, inspections and baselines remain. Back up and confirm policy before scheduling an apply run. No stored user readings were deleted during this update. Keep free disk space available for MySQL.

## Verification commands

With Node stopped and MySQL running: `npm.cmd test`.

With Node running: `node test/verify-features.js`, `node test/verify-advanced.js`, `node test/verify-demo.js`. These use temporary labeled fixtures; the demo creates simulation history and returns to normal operation. SMTP/push workers are tested using mock transports, not real recipients. New feature tests verify credential rotation, duplicate rejection, batch rollback, delayed-data isolation, telemetry, baselines, inspection photos, response notes and authorization.

## Verified in this workspace — 23 October 2026

- All 17 automated tests passed, including mocked escalation and Web Push delivery.
- Existing feature integration, advanced feature integration and the complete guided critical/recovery demo passed.
- `node test/verify-secure.js` passed protected HTTP reads, anonymous socket rejection, viewer permissions, logout stream revocation and disabled shared-token ingestion. Run this script with the main server stopped; it manages its own protected server.
- Browser verification passed temporary admin sign-in and saving an inspection. Analytics was checked at 390-pixel phone width; its table overflow was corrected. Temporary UI accounts, inspections and hardware fixtures were removed. The existing administrator account and physical-device history were preserved.
- A compressed SQL backup was created and preserved with matching SHA-256 at `D:\SN2H-Backups\sn2h-2026-10-23T07-27-02-106Z.sql.gz`. Retention was exercised in dry-run mode only.
- C: became full during verification. The simulator was stopped to limit writes; the app remains available. Automatic approval review rejected purging database recovery logs, and those logs were left intact. Free disk space before restarting sustained acquisition. No automatic retention/deletion was enabled.
- Actual cloud deployment, Docker startup, external SMTP/push delivery, backup restore, and physical firmware operation remain configuration-dependent or untested.
