# Supplied 3D team template integration

## Result and route

Open **http://localhost:3100/#about**, or choose **Our Team** in the existing navigation. The app's existing hash route, shared navbar, live status strip and footer are retained. Dashboard links use `#overview`; in-page story/team/college links scroll locally without changing the application route. No second server, new framework, database schema or sensor-processing change was introduced.

Source template inspected: `D:/Downloads/SN2H_Meet_Our_Team_Template/SN2H_Meet_Our_Team_Template/index.html`. It contains inline CSS/JavaScript and one logo image. The extracted folder was supplied, so no ZIP extraction was necessary. Its logo's SHA-256 matches the existing official logo; the existing asset is reused without alteration.

## Files

Added:

- `public/team-page.css`: the template's scoped cream/black styling, local Manrope fonts, seven namespaced animation keyframes, responsive adjustments and reduced-motion rules.
- `public/team-page.js`: lazily imported ES module for reveals, progress, parallax, card tilt/flip, pause and cleanup.
- `TEAM_INTEGRATION.md`: this guide.

Modified:

- `public/index.html`: replaced the previous About section with the supplied hero, marquee, four cards, identity and college sections. Inline style attributes were extracted into scoped classes to work with the existing Content Security Policy. Duplicate template page chrome was adapted to the existing shared navbar/footer.
- `public/app.js`: Our Team navigation label and lazy team-page lifecycle; other views retain their existing handlers.
- `public/team.js`: four-member configuration, Nandish/Heymanth aliases and optional photograph paths. The previous ordinary-card renderer is no longer used.
- `package.json`, `package-lock.json`: added `@fontsource/manrope` for the template's typography. No runtime animation library was added.

Assets:

- Official logo: `/assets/images/sn2h-logo.png` (existing original).
- Fonts: `/vendor/fonts/manrope/latin-{400,500,600,700,800}.css` and their package-local WOFF2 files. Existing local DM Sans remains in use.
- Future member photos: place supplied images in `public/assets/images/team/` and set each member's `photo` in `public/team.js`. Null or failed photographs retain the supplied initials placeholders. No photographs or personal roles were fabricated.

## Preserved effects and interaction

- Floating layered bridge hero, orbiting rings/dots, decorative labels and animated typography.
- Original initials portraits, floating halos, lighting, shadows and perspective.
- Pointer-following card tilt with requestAnimationFrame batching and smooth return.
- Flip buttons, whole-card click/tap activation, back-face academic details, focus transfer, inert inactive faces and Escape return.
- Staggered scroll reveals, moving marquee, identity tiles, college section and scroll progress.
- Explicit pause/resume, reduced-motion handling and page visibility pauses. Observers, pointer/scroll listeners and pending animation frames are cleaned up on leaving Our Team. Styles are scoped beneath `.sn2h-team-page`; critical-alarm styling remains available across the site.

Exactly four members are configured: Sagar S Gourimath; Nandeswara M (Nandish); Nagaraja C Y; Hemanth Kumar (Heymanth). The back faces include B.E./CSE, Final Year, 7th Semester, RYMEC Ballari and Batch 2023–2027. The identity story explains S, N² and H and uses the requested FOUR MINDS. ONE IDENTITY. heading. No special member roles or achievements were added.

## Verification — 23 October 2026

Passed:

- Existing application served successfully on port 3100. Team CSS, module, member configuration, official logo, local Manrope stylesheet and WOFF2 assets returned HTTP 200.
- Static checks: exactly four cards, unique document IDs, valid local section targets, namespaced animations, scoped selectors and no CSP-blocked inline styles in the team component.
- Before visiting Our Team, its stylesheet was absent; choosing Our Team loaded it and changed the title/active route correctly.
- Browser visual/layout checks at 1920, 1366, 768 and 390 pixels. No horizontal document overflow was detected. Tablet uses two card columns; phone uses one. The hero, marquee and section reveals were observed.
- Four-card front layout; pointer-induced nonzero tilt; button flipping; front/back accessibility state; focus transfer; Escape return; animation pause/resume. A back-face overflow discovered during testing was corrected and rechecked: all back faces fit at laptop, tablet and 390-pixel widths.
- All **17 existing automated tests passed**, including MySQL persistence, sensor processing, FFT, accounts, critical-alarm behavior and mocked notification workers. Simulation was temporarily stopped for the database test and its prior scenario/configuration was restored afterward. Existing tests append labeled simulation history as documented by the project.
- JavaScript syntax and formatting checks passed. No monitoring routes or database tables were modified for this integration.

Remaining manual checks:

The browser tool timed out while targeting a continuously moving decorative initial, then failed to reconnect with an environment/kernel-assets error. Earlier successful screenshots were displayed during testing, but a final saved screenshot could not be captured after the tool failed. Verify the following on a refreshed page:

1. At **320 pixels**, confirm the smaller hero text, compact counts, card faces and college content fit. Small-phone CSS adjustments are implemented, but this final breakpoint was not visually verified.
2. On a real touch device, tap a card's name/portrait area to flip and use its return control. The shared click/tap handler is implemented; actual touch-device activation was not completed during browser QA.
3. Enable the operating system's Reduce Motion preference. Content should stay visible and the orbital/marquee/portrait animations and pointer tilt should stop.
4. Navigate Our Team → Dashboard and use browser Back/Forward, then re-enter Our Team. The existing route and lifecycle cleanup are implemented; this final browser navigation cycle remains to be checked.
5. After switching views, inspect the browser console. No error banner was present during successful checks; a final console sweep after the browser connection failed was unavailable.

No manual database migration or additional backend startup is required. Refresh the existing application to pick up the new frontend assets.
