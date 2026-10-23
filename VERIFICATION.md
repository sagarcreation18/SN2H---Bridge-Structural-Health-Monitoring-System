# Verification — 22 October 2026

## SN²H branding update

The existing application is now branded SN²H and includes About Us. The four existing automated tests were rerun successfully after the update. Database preservation, read-only API/CSV/Socket.IO smoke checks, logo integrity, keyboard/history navigation, and desktop/laptop/tablet/mobile layouts were also checked. See [REBRANDING.md](REBRANDING.md) for the file manifest, exact checks and the new team preview. The dashboard screenshot below has been refreshed to SN²H branding.

## Original application verification

Passed on this workspace with Node.js 24 and an isolated MySQL 8.4.9 instance on port 3307:

- `npm.cmd test`: 4 tests passed, 0 failed. Includes actual MySQL inserts, deterministic normal/warning/critical scenarios, gravity removal, isolated RMS windows, rolling-window eviction, simulation lifecycle and stale-device alerts.
- `node test/verify-api.js`: passed authentication, invalid request rejection, history pagination, hourly/daily statistics, simulator controls, stale detection, device enable/disable including stopping/resuming simulated ingestion, alert acknowledgment, settings persistence, CSV exports, temporary hardware ingestion fixture, all five required Socket.IO events and reconnection. Fixture records are removed in cleanup. The configured real-hardware device remains unconnected with no readings.
- Node syntax checks passed for application entry point, routes, controllers and browser JavaScript. Source formatting checks passed; no frontend build is needed.
- Browser inspected all eight views. Live readings and charts updated from the backend. Stored analytics returned database aggregates and history. CSV button returned a download confirmation. Settings showed values persisted in MySQL. Captured browser logs showed no errors.
- Responsive checks at 1440 × 1000 and 390 × 844; phone navigation expanded and live view navigation worked. No document-level horizontal overflow at phone width. Tables have intentional horizontal scrolling.
- Saved desktop screenshot: `output/dashboard-desktop.png`.

Limitations: physical components were unavailable; firmware was not compiled/flashed or bench-tested. This is a local demonstration with nominal JavaScript sampling, fixed calibrated gravity baseline, bounded charts/exports and demonstration thresholds. It does not certify bridge safety. Public deployment and a hardware monitoring campaign require additional validation and access controls as described in README.md.
