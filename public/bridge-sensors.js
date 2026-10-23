"use strict";
window.SN2HBridgeSensors = (() => {
  const positions = [
    {
      id: "concept-01",
      name: "Sensor 01",
      location: "West span",
      position: 0.17,
      purpose:
        "Observe vibration near the west span and compare changes over time.",
    },
    {
      id: "concept-02",
      name: "Sensor 02",
      location: "Midspan",
      position: 0.43,
      purpose: "Observe deck vibration near the middle of the span.",
    },
    {
      id: "concept-03",
      name: "Sensor 03",
      location: "East span",
      position: 0.69,
      purpose:
        "Observe vibration near the east span and compare with the other mounting locations.",
    },
    {
      id: "concept-04",
      name: "Sensor 04",
      location: "East bearing",
      position: 0.88,
      purpose:
        "Proposed extra mounting point for observing local vibration near the east bearing.",
    },
  ];
  const advice = {
    normal:
      "Continue monitoring and compare trends with a recorded normal baseline.",
    warning:
      "Check the trend and sensor mounting; arrange an inspection using your response procedure.",
    critical:
      "Verify the live measurement and follow your bridge response procedure. The dashboard raises its critical visual/audio warning when enabled.",
    offline:
      "Check sensor power, network access and the last upload. Old measurements cannot indicate the current condition.",
    disabled:
      "An administrator must enable this device before it can receive new measurements.",
  };
  let ready = false,
    group,
    detail,
    signature = "",
    items = [],
    active = null,
    pinned = false,
    hideTimer = null;
  let returningFocus = false;
  function statusFor(device, reading, settings, now = Date.now()) {
    if (!device) return "offline";
    if (!device.enabled) return "disabled";
    if (
      !reading ||
      reading.device_id !== device.id ||
      reading.source !== device.source
    )
      return "offline";
    const age = now - +new Date(reading.timestamp);
    if (
      !Number.isFinite(age) ||
      age < -5000 ||
      age >= (settings.offlineMs || 5000)
    )
      return "offline";
    return ["normal", "warning", "critical"].includes(reading.status)
      ? reading.status
      : "offline";
  }
  function attr(node, key, value) {
    if (node.getAttribute(key) !== String(value))
      node.setAttribute(key, String(value));
  }
  function svgElement(name, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    return node;
  }
  function dataFor(item) {
    const device = state.devices.find((d) => d.id === item.deviceId),
      reading = state.readingsByDevice[item.deviceId] || device?.latest;
    return {
      device,
      reading,
      status: statusFor(device, reading, state.settings),
    };
  }
  function show(item, pin = false) {
    clearTimeout(hideTimer);
    active = item;
    pinned = pin || pinned;
    refreshDetails();
    refreshStates();
  }
  function close(returnFocus = false) {
    clearTimeout(hideTimer);
    const id = active?.id;
    active = null;
    pinned = false;
    detail.hidden = true;
    refreshStates();
    if (returnFocus && id) {
      returningFocus = true;
      group
        .querySelector(`[data-marker-id="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true });
      returningFocus = false;
    }
  }
  function laterHide() {
    clearTimeout(hideTimer);
    if (!pinned)
      hideTimer = setTimeout(() => {
        if (
          !detail.matches(":hover") &&
          !detail.contains(document.activeElement)
        )
          close();
      }, 180);
  }
  function refreshDetails() {
    if (!active || !detail) return;
    const { device, reading, status } = dataFor(active),
      fresh = status !== "offline" && status !== "disabled";
    detail.hidden = false;
    const values = {
      "#bridgeSensorTitle": `${active.name} · ${active.location}`,
      "#bridgeSensorSummary": `${status.toUpperCase()} / ${active.conceptual ? "CONCEPTUAL POSITION · SHARED SIMULATION" : device?.source.toUpperCase() + " DEVICE"} / ${active.deviceId}`,
      "#bridgeSensorPurpose": active.purpose,
      "#bridgeSensorAction": advice[status],
      "#bridgeSensorReading": reading
        ? `${fresh ? "Live" : "Last stored"}: X ${fmt(reading.x)} g · Y ${fmt(reading.y)} g · Z ${fmt(reading.z)} g · RMS ${fmt(reading.rms)} g`
        : "No measurements received. No values are fabricated.",
      "#bridgeSensorTime": `Last sample: ${reading ? date(reading.timestamp) : "Never"} · Warning ≥ ${fmt(state.settings.warning)} g RMS · Critical ≥ ${fmt(state.settings.critical)} g RMS`,
      "#bridgeSensorOrigin": active.conceptual
        ? "All four positions illustrate the same ADXL345 simulator stream. They are not four independent sensors. Register real hardware in Devices for independent measurements."
        : `Registered hardware location: ${device?.location || "Unassigned"}. Only this device’s received readings determine its light.`,
      "#bridgeSensorPin": pinned ? "Unpin details" : "Pin details",
    };
    for (const [selector, text] of Object.entries(values)) {
      const node = detail.querySelector(selector);
      if (node.textContent !== text) node.textContent = text;
    }
    attr(detail, "data-status", status);
    attr(detail.querySelector("#bridgeSensorPin"), "aria-pressed", pinned);
  }
  function refreshStates() {
    const counts = {
      normal: 0,
      warning: 0,
      critical: 0,
      offline: 0,
      disabled: 0,
    };
    for (const item of items) {
      const { status } = dataFor(item);
      counts[status]++;
      const node = group.querySelector(
        `[data-marker-id="${CSS.escape(item.id)}"]`,
      );
      if (!node) continue;
      attr(node, "data-status", status);
      attr(
        node,
        "aria-label",
        `${item.name}, ${item.location}, ${status}. ${item.conceptual ? "Shared simulation illustration." : "Registered hardware."} Press Enter for details.`,
      );
      attr(node, "aria-expanded", active?.id === item.id);
      node.classList.toggle("is-selected", active?.id === item.id);
    }
    const counter = document.querySelector("#bridgeSensorCounts");
    if (counter)
      counter.textContent =
        Object.entries(counts)
          .filter(([, n]) => n)
          .map(([s, n]) => `${n} ${s}`)
          .join(" · ") +
        (state.source === "simulation" ? " · shared simulated signal" : "");
  }
  function build() {
    items =
      state.source === "simulation"
        ? positions.map((p) => ({
            ...p,
            deviceId: "sim-adxl345",
            conceptual: true,
          }))
        : state.devices
            .filter((d) => d.source === "hardware")
            .map((d, index) => ({
              id: d.id,
              deviceId: d.id,
              name: d.name,
              location: d.location || "Unassigned",
              position: d.position ?? 0.5,
              purpose:
                "Measure local acceleration and vibration at this registered mounting location. Use calibration and baseline trends to interpret changes.",
              conceptual: false,
              index,
            }));
    const next = JSON.stringify(items);
    if (next === signature) return;
    signature = next;
    if (active) {
      const match = items.find((i) => i.id === active.id);
      if (match) active = match;
      else close();
    }
    group.replaceChildren();
    for (const [index, item] of items.entries()) {
      const x = 10 + 900 * item.position,
        y = 250,
        above = index % 2 === 0,
        labelY = above ? 207 : 304;
      const node = svgElement("g", {
        class: "bridge-sensor-marker",
        "data-marker-id": item.id,
        role: "button",
        tabindex: 0,
        "aria-controls": "bridgeSensorDetails",
        "aria-describedby": "bridgeSensorHelp",
      });
      node.append(
        svgElement("circle", { cx: x, cy: y, r: 23, class: "sensor-hit" }),
        svgElement("circle", {
          cx: x,
          cy: y,
          r: 17,
          class: "sensor-status-ring",
        }),
        svgElement("circle", { cx: x, cy: y, r: 12, class: "sensor-shell" }),
        svgElement("circle", { cx: x, cy: y, r: 5, class: "sensor-light" }),
        svgElement("path", {
          d: `M${x} ${above ? 232 : 268}v${above ? -14 : 21}`,
          class: "sensor-callout",
        }),
      );
      const label = svgElement("text", {
        x,
        y: labelY,
        "text-anchor": "middle",
        class: "sensor-location-label",
      });
      label.textContent = item.conceptual
        ? `${item.name.toUpperCase()} · ${item.location.toUpperCase()}`
        : item.name;
      node.append(label);
      const title = svgElement("title");
      title.textContent = `${item.name} / ${item.location} / ${item.conceptual ? "shared simulation illustration" : "registered hardware"}`;
      node.append(title);
      node.addEventListener("pointerenter", () => show(item));
      node.addEventListener("pointerleave", laterHide);
      node.addEventListener("focus", () => {
        if (!returningFocus) show(item);
      });
      node.addEventListener("blur", (event) => {
        if (!detail.contains(event.relatedTarget)) laterHide();
      });
      node.addEventListener("click", () => {
        if (active?.id === item.id && pinned) close();
        else {
          pinned = false;
          show(item, true);
        }
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pinned = false;
          show(item, true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      });
      group.append(node);
    }
    document.querySelector(".panel-top span:last-child").textContent =
      state.source === "simulation"
        ? "04 CONCEPTUAL SENSOR POSITIONS"
        : `${items.length} REGISTERED HARDWARE LOCATIONS`;
    document.querySelector(".panel-bottom span:first-child").textContent =
      state.source === "simulation"
        ? "SIMULATION / FOUR POSITIONS · ONE SHARED STREAM"
        : "HARDWARE / REGISTERED MOUNTING POSITIONS";
  }
  function refresh() {
    if (!ready) return;
    build();
    refreshStates();
    refreshDetails();
  }
  function init() {
    if (ready) return;
    ready = true;
    const svg = document.querySelector("svg.bridge");
    svg.classList.add("registered-locations");
    document.querySelector("#registeredSensors")?.remove();
    group = svgElement("g", { id: "bridgeSensorMarkers" });
    svg.append(group);
    const panel = document.querySelector(".bridge-panel");
    const help = document.createElement("p");
    help.id = "bridgeSensorHelp";
    help.className = "fineprint bridge-sensor-help";
    help.textContent =
      "Hover or focus a sensor for its purpose, live values and suggested next step. Click/tap or press Enter to pin details; Escape closes them.";
    const legend = document.createElement("div");
    legend.className = "bridge-sensor-legend";
    legend.innerHTML =
      '<span><i class="legend-light normal"></i> Normal · green pulse</span><span><i class="legend-light warning"></i> Warning · amber pulse</span><span><i class="legend-light critical"></i> Critical · red pulse</span><span><i class="legend-light offline"></i> Offline / disabled · steady gray</span><small id="bridgeSensorCounts"></small>';
    detail = document.createElement("section");
    detail.id = "bridgeSensorDetails";
    detail.className = "bridge-sensor-details";
    detail.hidden = true;
    detail.setAttribute("aria-labelledby", "bridgeSensorTitle");
    detail.innerHTML =
      '<div class="button-row"><h3 id="bridgeSensorTitle"></h3><button id="bridgeSensorPin" class="button small" type="button">Pin details</button><button id="bridgeSensorClose" class="button small" type="button" aria-label="Close sensor details">Close</button></div><p id="bridgeSensorSummary" class="eyebrow"></p><p id="bridgeSensorPurpose"></p><p id="bridgeSensorReading"></p><p id="bridgeSensorTime" class="fineprint"></p><p><strong>Suggested response: </strong><span id="bridgeSensorAction"></span></p><p id="bridgeSensorOrigin" class="fineprint"></p><a href="#monitoring" id="bridgeSensorMonitor" class="button small">Open this stream ↗</a>';
    svg.after(help, legend, detail);
    detail.querySelector("#bridgeSensorClose").onclick = () => close(true);
    detail.querySelector("#bridgeSensorPin").onclick = () => {
      pinned = !pinned;
      refreshDetails();
    };
    detail.querySelector("#bridgeSensorMonitor").onclick = () => {
      if (active) task(() => window.SN2HFeatures.selectDevice(active.deviceId));
    };
    detail.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    detail.addEventListener("pointerleave", laterHide);
    detail.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(true);
    });
    document.addEventListener("visibilitychange", refresh);
    refresh();
  }
  return { init, refresh, statusFor };
})();
