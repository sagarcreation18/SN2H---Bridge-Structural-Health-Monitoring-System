# SN²H — Bridge Structural Health Monitoring System

See [ADVANCED_FEATURES.md](ADVANCED_FEATURES.md) for inspections/photos, sensor diagnostics, baseline trends, escalation, audit history, phone push, remote timestamped uploads, offline queue preparation, and deployment/backup configuration. No bridge map is included.

Local full-stack demonstration using **Node.js, Express, MySQL 8, mysql2/promise, Socket.IO, plain HTML/CSS/JavaScript, Bootstrap 5, Chart.js and Bootstrap Icons**. Fonts and browser libraries are served locally. No frontend build step, React, TypeScript, or hosted service is required.

Existing workspace applications are untouched. All application files are in this folder.

## Project identity and team

**SN²H.** — **We Sense What Eyes Can't See.**

Developed by **SN²H Team**, Department of Computer Science and Engineering, Rao Bahadur Y. Mahabaleswarappa Engineering College, Ballari (RYMEC).

| Team member       | Initial | Known as |
| ----------------- | ------- | -------- |
| Sagar S Gourimath | S       | Sagar    |
| Nandeswara M      | N       | Nandish  |
| Nagaraja C Y      | N       | Nagaraj  |
| Hemanth Kumar     | H       | Heymanth |

Bachelor of Engineering (B.E.) — Computer Science and Engineering. Final Year, 7th Semester, Batch **2023–2027**. The squared N represents the two team members whose names begin with N. No individual roles are implied.

The shared header, dashboard identity, footer, browser title, favicon and CSV filenames use SN²H branding. The **About Us** view at **http://localhost:3100/#about** follows the existing hash routing and contains four equal profile cards, institution information, Sense/Analyze/Alert blocks, and the brand story.

Official logo: **public/assets/images/sn2h-logo.png**. It is a byte-for-byte copy of the supplied circular emblem, displayed without cropping or distortion. The same original is reused for the favicon/touch icon. No replacement logo or fabricated member photographs are used.

Team details are configured in **public/team.js**. To add a real supplied photo later, place it in **public/assets/images/team/** and set that member's **photo** field to its public URL, e.g. **/assets/images/team/sagar.jpg**. Null or failed images retain the initials avatar. See the team image directory's README for suggested filenames.

Branding changes preserve the existing project directory, API endpoints, MySQL schema, identifiers, recorded measurements, settings and sensor-processing algorithms. Existing bridge names in MySQL are retained as record metadata; new database seeds use the new demonstration display name. Technical package metadata uses the ASCII identifier **sn2h-bridge-monitor**.

## Run this configured workspace

An isolated MySQL instance is initialized under `.runtime/mysql`, on **127.0.0.1:3307**. It does not change the pre-existing MySQL84 service on port 3306. `.env` contains generated admin/device tokens and a dedicated database user's password. These files and runtime data are ignored by Git. Keep them private and back up the database.

Open PowerShell:

```powershell
cd 'C:\Users\SAGAR\OneDrive\Documents\Location-Based Garbage Management System for Smart City\bridge-health-monitor'
powershell -ExecutionPolicy Bypass -File .\start-local-db.ps1
npm.cmd run db:setup
npm.cmd start
```

Allow a few seconds after starting MySQL. Open **http://localhost:3100**. If the server is already running, use that instance rather than starting a second one. Stop Node with Ctrl+C. To shut down the isolated MySQL instance cleanly:

```powershell
mysqladmin --host=127.0.0.1 --port=3307 --user=root --password shutdown
```

Enter the isolated instance's root password from `.runtime/mysql-admin-password.txt` at the password prompt. This password belongs only to the new instance.

Choose **Sign in** to create the first administrator using the local ADMIN_TOKEN from `.env`, then sign in with your chosen username/password. Settings supports additional admin/viewer accounts. The token remains a recovery option. Viewing data remains public on this loopback demo. See [FEATURES.md](FEATURES.md) for all ten new features and email setup.

The simulator starts with a normal signal by default. To demonstrate an alert: unlock controls → Simulation → Stop → select Heavy traffic or Critical vibration → Start. Pause and stop cease new readings; after the configured timeout the sensor becomes offline. Resume restarts a paused session. Reset clears signal state and controls, preserving persisted history. Device disable stops ingestion for that device; re-enable to resume measurements.

## Install on another machine / use your own MySQL

Requires Node.js 20+ and MySQL 8+. Run `npm.cmd ci`, copy `.env.example` to `.env`, and configure your database host, port, user and password. Generate two distinct secrets:

```powershell
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

Run twice, saving one value as ADMIN_TOKEN and the other as DEVICE_TOKEN. Do not reuse example credentials. Have your MySQL administrator create the database and a dedicated account:

```sql
CREATE DATABASE IF NOT EXISTS bridge_health_monitor;
CREATE USER 'bridge_app'@'localhost' IDENTIFIED BY 'YOUR_UNIQUE_PASSWORD';
GRANT ALL PRIVILEGES ON bridge_health_monitor.* TO 'bridge_app'@'localhost';
```

Then run:

```powershell
npm.cmd run db:setup
npm.cmd start
```

`db:setup` uses idempotent schema/seed scripts and preserves existing rows/settings. The configured database name must remain `bridge_health_monitor`, as declared in schema.sql. `database/secure-local.js` was a one-time provisioning helper for the newly initialized instance, and should not be run against an already-secured instance.

## Application views

| View            | Behavior                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Overview        | Conceptual bridge SVG, live simulation RMS and acceleration cards, chart, latest database alerts           |
| Live Monitoring | X/Y/Z, dynamic magnitude, rolling RMS, sampling information, bounded live chart                            |
| Analytics       | Source/date filters, stored averages/maxima, event counts, hourly/daily aggregates and newest 500 readings |
| Alerts          | Search, severity filter, paginated MySQL history and persistent acknowledgment                             |
| Simulation      | Seven scenarios, amplitude/frequency/noise controls, start/pause/resume/stop/reset                         |
| Devices         | Simulated/hardware identities, connectivity, last update, enable/disable                                   |
| Reports         | Source/date-filtered vibration and alert CSV exports, database count preview                               |
| About Us        | Four team profiles, RYMEC academic details, project explanation and the SN²H identity                      |
| Settings        | Persisted thresholds, sampling, offline timeout, browser audio, startup preference                         |

Date inputs use browser local time and are converted to UTC for MySQL queries. Date filters are fixed to the chosen range; reapply or change the To value for newly recorded data. Reports are limited to 10,000 rows per export; narrow the range if the server returns 413. At 20 Hz, choose a range under about eight minutes for a raw readings export. API history supports page/limit (up to 1,000); UI alert pages use 20 records. CSV text is escaped and spreadsheet formula prefixes are neutralized.

Overview and Live Monitoring support explicit source/device selection. Hardware records stay distinct from simulation. Registered sensor locations appear on the conceptual bridge; no physical readings are fabricated.

## Processing and architecture

`server/index.js` initializes Express, local assets, Socket.IO and the monitor. `routes.js` handles HTTP routes/authentication; `controllers.js` handles historical data, statistics and reports. `validation.js` validates numeric values, dates and pagination. `service.js` coordinates simulation lifecycle, transactional ingestion, alert transitions and offline detection. `sensor-simulator.js` contains deterministic scenarios; `processing.js` maintains independent per-device RMS windows. `db.js` provides the shared mysql2 pool. SQL uses parameterized values and fixed/validated query fragments.

Acceleration is expressed in **g**, with a fixed calibrated baseline `(0,0,1) g`. Dynamic magnitude is `sqrt(x²+y²+(z−1)²)`. Rolling RMS is the square root of the mean of the last 25 squared magnitudes, using the available samples during warmup. At the default 50 ms setting, the nominal window is 1.25 seconds. Scheduler/database delays can reduce actual throughput; this is a demonstration scheduler, not precision acquisition. Frequency must remain below half the configured sample rate. Noise is repeatable high-frequency texture, not a calibrated sensor-noise or anti-aliasing model.

Demonstration thresholds: **normal below 0.15 g RMS**, **warning from 0.15 to below 0.35**, **critical at or above 0.35**. The state labels describe threshold comparisons only. Accelerometer readings alone do not establish structural safety. Alert rows are created on entry into warning/critical and once per offline episode; they are not created for every sample. Sensor state is independent of the Socket.IO connection indicator. Browser audio is optional, can require a prior user interaction, and is not a certified physical alarm.

Readings and associated threshold alerts are persisted transactionally before emission. Restarting closes prior active session records as interrupted. RMS windows restart after process restart and simulator start/reset; history, settings and acknowledgments persist. The active simulator process itself is not resumed after a crash. SQLite/in-memory database fallbacks are not used: startup fails if MySQL is unavailable.

### REST API

Read-only: `GET /api/health`, `/bridges`, `/devices`, `/devices/:id/status`, `/sensor-data/latest`, `/sensor-data/history`, `/sensor-data/statistics`, `/simulation/status`, `/alerts`, `/settings`, `/reports/readings`, `/reports/alerts`.

Admin Bearer token: `POST /api/admin/verify`; `POST /api/simulation/{start,pause,resume,stop,reset}`; `PATCH /api/alerts/:id/acknowledge`; `PATCH /api/devices/:id` with `{"enabled":true}`; `PUT /api/settings`.

Device Bearer token: `POST /api/sensor-data` with `{"device_id":"esp32-01","x":0.01,"y":0.02,"z":1.0}`. Values must be finite within ±16 g. Only registered enabled hardware identities are accepted. The server assigns receive timestamps and source identity.

Historical queries: ISO `from`, `to`, `source=simulation|hardware`, `page`, `limit`. History also accepts `source=all`; statistics and reports require one source to avoid mixing simulated and hardware results. Alerts accept search/severity and date/page filters. Latest returns the latest record from either source; the simulation UI explicitly requests simulation history to synchronize.

Socket.IO events: `sensor:update`, `bridge:status`, `alert:new`, `device:offline`, `simulation:status`, plus settings/acknowledgment/error synchronization. Browser reconnection re-fetches persisted simulation history, device state, alerts and settings, including measurements missed while disconnected.

## Verification

### Site-wide critical alarm

Fresh critical simulation readings activate a red theme across every view, a slow full-screen red pulse every three seconds, a pulsing warning banner, and a repeating rising/falling warning siren when audio is enabled. The alarm clears when readings recover, become stale, or the stream disconnects. Reduced-motion preferences disable pulsing. Mute affects sound while keeping the visual alarm visible.

In Settings, select **Preview critical alarm · 20 seconds** for a temporary visual/audio demonstration. It does not create readings or alert records. **End preview** stops the demonstration early; a continuing real critical condition remains visible. Browsers require a user gesture to enable sound: use **Enable alarm sound** once for the current tab, or the preview button. The saved sound preference can arm playback after a browser interaction. Reloading may require another interaction.

The direct visual preview is `http://localhost:3100/?alarmPreview=1#settings`; click Enable sound in the banner to allow audio. The preview expires after 20 seconds. Alarm behavior is covered by `node --test test/alarm.test.js`, including recovery/staleness/disconnection, preview expiry, audio scheduling and mute. Physical sirens and hardware buzzers are unaffected.

### Existing backend verification

With the Node server **stopped**, and MySQL running:

```powershell
npm.cmd test
```

This covers gravity removal, deterministic scenario thresholds, per-device window isolation, RMS eviction/reset, transactional MySQL ingestion, session controls, alerts and offline detection. Integration tests append labeled simulation demonstration data to this local database; do not target a production database.

With the server **running**, from a second terminal:

```powershell
node test/verify-api.js
```

This exercises HTTP authentication and validation, simulation controls, stale detection, paginated history, statistics, acknowledgment, settings, device controls, CSV, all five required Socket.IO events and reconnection. It temporarily changes settings and simulator state, restores settings, and leaves a normal simulation running. The hardware-ingestion check uses a temporary fixture that is deleted in cleanup; no fixture hardware measurements remain in the demonstration history.

No frontend build command is required. Syntax checks can be run with `node --check server/index.js` and `node --check public/app.js`.

## Hardware and deployment boundary

See [firmware/README.md](firmware/README.md) for proposed wiring, calibration, authenticated ingestion and verified TLS preparation. Firmware and physical buzzer/LED operation are **untested** until real components are available.

This is a local demonstration, with read-only APIs open on loopback, a shared device credential, and local admin/viewer accounts. Public deployment still needs HTTPS, per-device credentials, backups, retention capacity and access logging. Use a reverse proxy when enabling future hardware access. Database runtime files should be moved out of a cloud-synchronized directory for sustained operation using a proper MySQL backup/restore; do not copy live InnoDB files. The existing MySQL service and all other workspace applications are preserved.

