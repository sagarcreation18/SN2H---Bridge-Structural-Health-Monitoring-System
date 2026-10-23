# Dashboard motion

Refresh the existing application to load `public/motion.css` and `public/motion.js`.

- Page entrances and staggered section reveals apply to monitoring, analytics, alerts, simulation, devices, maintenance, reports and settings.
- Text arrivals add a staggered rise/rotation to heading words, plus soft slide/fade entrances for descriptions and section labels, including the team hero. Text content and inline emphasis are preserved. Metric values, clocks, profile-card faces and critical warnings are excluded. Dashboard pause/reduced-motion preferences apply; the team pause control also cancels its active text arrivals. These additions passed syntax and existing motion tests; browser visual verification is still pending.
- New alerts, inspection records and newly registered device cards get bounded entrance animations. Replacing an existing device card during background polling does not repeatedly animate it.
- Sensor state changes receive a short badge accent. Significant RMS changes can receive a subtle underline accent, limited to once per 1.8 seconds. Values remain exact; there is no interpolated or fabricated reading.
- Metric card elements are retained between updates instead of being rebuilt on every refresh.
- Historical and FFT canvases fade in after loading. Live Chart.js data updates remain immediate.
- Navigation underline, mobile menu, forms, buttons, dialogs, error notices, toasts and slower API requests receive feedback. Fast API requests do not flash a loading indicator; overlapping requests keep it active until all have finished. Failed requests clear it too.
- Settings → **Dashboard motion** pauses these additions and saves the preference locally. System Reduce Motion takes priority. Hidden-page animations are cancelled or paused. The bridge and supplied Our Team page keep their existing separate pause controls and animation lifecycles. Critical warning visuals and sound are not disabled by the dashboard motion preference.

Only frontend files were changed: added `motion.js`/`motion.css`, loaded them in `index.html`, and added small presentation hooks in `app.js` and `features.js`. No backend, schema, thresholds or sensor algorithm changes were made.

Verification: all 20 automated tests passed, including three tests for concurrent/fast/failed request feedback; JavaScript syntax and formatting checks passed. Team integration structure and local assets also passed their existing checks. The prior simulation mode and configuration were restored after regression testing.

The browser tool could not initialize during this update, so the new motion still requires a visual check after refreshing. Check section entry, modal/toast behavior, the pause control, system Reduce Motion and phone navigation. The supplied team's earlier visual checks are recorded separately in `TEAM_INTEGRATION.md`.
