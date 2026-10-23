# SN²H feature guide

All ten additions are implemented locally. Refresh the application at http://localhost:3100.

1. **Accounts:** choose Sign in. For the first administrator, supply the local `.env` ADMIN_TOKEN and choose a username and password (12–128 characters). There is no default password. Administrators can create admin or viewer accounts in Settings. Sessions use HttpOnly cookies; changes require CSRF protection. The recovery token remains available for local administration. Read-only data remains accessible on this loopback demonstration.
2. **Source selection:** Overview and Live Monitoring have simulation/hardware and device selectors. Hardware views show received data only.
3. **Sensor locations:** administrators register hardware devices in Devices and edit their location and normalized bridge position. Registered devices appear on the conceptual bridge.
4. **Calibration:** keep a sensor stationary with +Z upward, collect at least 100 recent readings, and use Calibrate in Devices. Offsets persist per device; raw acceleration remains stored. Reset removes the correction. Avoid applying the same offsets in firmware and the backend.
5. **FFT:** Analytics provides axis selection and a timestamp-resampled, DC-removed, Hann-windowed spectrum. At least 32 samples are required; large gaps are rejected. Frequency estimates depend on actual acquisition cadence.
6. **Event replay:** choose Replay on an alert to inspect readings around that event at 1×, 2× or 4× speed. Replay does not trigger live alarms.
7. **PDF reports:** Reports exports a branded PDF using its source/date filters, with summary, a bounded RMS chart and event history. Chart and event limits are identified in the report.
8. **Email:** configure SMTP_HOST, SMTP_PORT, SMTP_SECURE and SMTP_FROM in `.env`, plus SMTP_USER and SMTP_PASSWORD when required. Restart Node, then enable recipients/severities in Settings. Connection verification does not send mail. Deliveries have persistent status, retries and cooldown. No external email has been sent or verified in this environment.
9. **Device health:** Devices displays reported RSSI, uptime, firmware and optional battery percentage. Missing telemetry displays Not reported. Firmware preparation includes RSSI, uptime and firmware metadata.
10. **Guided demo:** Simulation runs 44 seconds through normal, warning, critical and recovery. Enable alarm sound with a browser gesture to hear the critical siren. The demo requires an enabled simulator, sampling below 200 ms and a critical threshold at most 1 g. Stop cancels the sequence; completion leaves normal simulation running.

## Verification

`npm.cmd test` passes all 10 automated tests. Run it with the app stopped and the local MySQL instance running.

With the app running, `node test/verify-features.js` checks roles, CSRF, calibration, device telemetry, FFT, replay, PDF output, password/session revocation and a mocked SMTP delivery. Temporary accounts and hardware fixtures are removed afterward. `node test/verify-demo.js` checks the complete guided sequence and cancellation.

Latest local verification: all 10 automated tests passed; the feature integration script passed; the full guided demo reached measured normal, warning and critical states, recovered to normal, and passed cancellation. Temporary account and hardware fixtures were cleaned up.

The generated PDF was rendered and visually inspected. Browser automation is unavailable in this session, so the new interface has not received browser visual QA. Physical sensor firmware remains untested. SMTP requires your real configuration before external delivery can be verified.

Keep free disk space available: the local MySQL server cannot persist readings when C: is full. Use database-supported log maintenance and backups; do not delete live database files.
