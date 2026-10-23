# SN²H rebranding and team update

The existing application at http://localhost:3100 is updated in place. About Us is available at http://localhost:3100/#about, using the existing hash navigation. No duplicate application was created.

## Identity and pages

- Official title: **SN²H — Bridge Structural Health Monitoring System**.
- Brand: **SN²H.** Tagline: **We Sense What Eyes Can't See.**
- Shared header, hero, browser metadata, favicon and academic footer now appear across Overview, Live Monitoring, Analytics, Alerts, Simulation, Devices, Reports, About Us and Settings.
- About Us includes four equally sized, equally prominent initials profiles, the institution/department/academic information, Sense/Analyze/Alert blocks and the S / N² / H identity explanation. Names are exactly Sagar S Gourimath, Nandeswara M, Nagaraja C Y and Hemanth Kumar. The supplied known-as names and 2023–2027 academic details are preserved. No roles, portraits or institutional logos were invented.

## Modified files

| File                                | Change                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `public/index.html`                 | Official branding, original logo integration, metadata/favicon, full About Us view and shared footer                                   |
| `public/styles.css`                 | Responsive identity, team, institution, innovation, brand-story and footer styles; subtle card hover effects respecting reduced motion |
| `public/app.js`                     | About Us hash navigation, one-time team rendering, branded device display label and CSV download filename                              |
| `server/index.js`                   | Startup log brand only                                                                                                                 |
| `server/controllers.js`             | Branded CSV attachment filename only                                                                                                   |
| `database/seed.sql`                 | Branded demonstration bridge display name for new databases; existing records are not renamed                                          |
| `package.json`, `package-lock.json` | ASCII technical package name `sn2h-bridge-monitor`; application description                                                            |
| `README.md`, `VERIFICATION.md`      | Updated identity, team/photo instructions and verification notes                                                                       |
| `output/dashboard-desktop.png`      | Refreshed screenshot of the branded monitoring dashboard                                                                               |

## New files

- `public/team.js` — four-member configuration and semantic profile rendering with initials/photo fallback.
- `public/assets/images/sn2h-logo.png` — unmodified original supplied emblem.
- `public/assets/images/team/README.md` — instructions for optional future photographs.
- `output/sn2h-about-team.png` — verified About Us and four-profile preview.
- `REBRANDING.md` — this change report.

## Logo and future photographs

The original image is copied to **public/assets/images/sn2h-logo.png** and used in the header, hero, About Us and footer. It also supplies the favicon/touch icon. Each display uses `object-fit: contain`; the border and original image quality are preserved. No replacement image was generated. Original and copied SHA-256 hashes match:

```text
B297DA063B1CF830EE7D1486938E5280C63A4AD0247A8B98C3331B87D5899DB9
```

Initials avatars are intentional. To add genuine photographs later, put files in `public/assets/images/team/` and change the corresponding `photo` field in `public/team.js`. A missing or failed photo keeps the initials visible. No upload service or new dependencies are needed.

## Checks completed — 22 October 2026

- `npm.cmd test`: **4 passed, 0 failed**, covering vibration processing, scenarios, MySQL persistence, session controls, alert creation and offline detection. These existing integration tests append simulation records as documented.
- JavaScript syntax and Prettier checks passed for changed source files.
- Database preservation check: every pre-existing reading and alert remained present by its recorded ID range/count; saved monitoring settings were unchanged.
- Read-only smoke checks passed for health, devices, settings, alert history, sensor history, statistics and CSV exports. The CSV attachment has its SN²H technical filename. Socket.IO supplied distinct new simulation readings and bridge/simulator status events.
- Browser showed all four correct names, loaded all official emblems with contain sizing, and showed four equal cards at desktop width. No captured warning/error console messages.
- Layouts inspected at **1440, 1280, 768 and 390 pixels**. Team grid was **4 / 4 / 2 / 1 columns** respectively, with no document-level horizontal overflow. Mobile menu, active links, browser back/forward and keyboard Enter activation of About Us passed. Temporary viewport changes were reset.
- Live dashboard continued to receive simulation measurements after the update. A normal simulation is left running.

## Preservation and manual attention

No database tables, API endpoints, device IDs, existing project paths, hardware payloads or processing algorithms were renamed or changed. Existing bridge names in database records are retained as historical metadata. The only backend changes are branding strings.

No blocking manual action is required. Team photographs are optional future additions. ESP32 firmware and physical sensor/buzzer/LED operation remain untested, as before; the application continues to identify simulated data and demonstration thresholds explicitly.
