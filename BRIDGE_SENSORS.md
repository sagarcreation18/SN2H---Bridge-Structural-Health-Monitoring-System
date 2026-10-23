# Interactive bridge sensors

The demonstration bridge has four conceptual positions, including an east-bearing position. All four explicitly share the simulator stream; they do not represent four independent physical devices. Hardware mode displays registered hardware devices and uses each device's own readings.

Fresh normal, warning and critical readings pulse green, amber and red. Missing, stale, mismatched or disabled streams remain gray. The existing motion pause and reduced-motion preference stop the blinking.

Hover or focus a marker to see location, purpose, readings, thresholds, timestamp and suggested response. Click/tap or Enter pins the panel; Close/Escape dismiss it. Open this stream selects the corresponding monitoring device.

Validation: all 23 regression tests passed, including fresh status, stale/future timestamps, disabled devices and source/device isolation. New assets return HTTP 200. Browser visual interaction verification was unavailable because the existing local tab could not be found by the browser tool.
