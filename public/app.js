"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const pages = [
  ["overview", "Overview"],
  ["monitoring", "Live Monitoring"],
  ["analytics", "Analytics"],
  ["alerts", "Alerts"],
  ["simulation", "Simulation"],
  ["devices", "Devices"],
  ["maintenance", "Maintenance"],
  ["reports", "Reports"],
  ["about", "Our Team"],
  ["settings", "Settings"],
];
const state = {
  token: "",
  settings: {},
  sim: { state: "stopped" },
  latest: null,
  devices: [],
  alerts: [],
  alertPage: 1,
  alertTotal: 0,
  stream: false,
  view: "overview",
  chart: null,
  historyChart: null,
  bridgeMotionPaused: false,
  user: null,
  csrf: "",
  source: "simulation",
  deviceId: "sim-adxl345",
  readingsByDevice: {},
};
const presets = {
  normal: [0.035, 1.1, 0.008],
  light: [0.12, 1.6, 0.015],
  heavy: [0.29, 2.2, 0.025],
  wind: [0.18, 0.5, 0.035],
  seismic: [0.55, 3, 0.04],
  critical: [0.7, 2.5, 0.03],
  custom: [0.1, 1, 0.01],
  vehicle: [0.2, 1.6, 0.01],
  sensor_fault: [0, 1, 0],
  connection_loss: [0, 1, 0],
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v, d = 3) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(d);
const date = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Never";
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
function showError(error) {
  $("#error").textContent = error.message || String(error);
  $("#error").hidden = false;
}
function clearError() {
  $("#error").hidden = true;
}
async function api(path, options = {}) {
  const finishMotion = window.SN2HMotion?.beginRequest();
  try {
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    if (state.csrf) headers["X-CSRF-Token"] = state.csrf;
    const res = await fetch("/api" + path, { ...options, headers });
    if (!res.ok) {
      let message;
      try {
        message = (await res.json()).error;
      } catch {
        message = "Request failed (" + res.status + ")";
      }
      throw new Error(message);
    }
    return await res.json();
  } finally {
    finishMotion?.();
  }
}
async function task(fn) {
  clearError();
  try {
    return await fn();
  } catch (e) {
    showError(e);
    if ($("#authDialog").open) $("#authError").textContent = e.message;
  }
}
function needsAdmin() {
  if (isAdmin()) return true;
  $("#authDialog").showModal();
  return false;
}
function isAdmin() {
  return Boolean(state.token || state.user?.role === "admin");
}
function table(headers, rows, empty = "No records in this range.") {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div class="empty">${escape(empty)}</div>`;
}
function badge(status) {
  return `<span class="badge-state ${escape(status)}">${escape(status)}</span>`;
}
function alertRows(rows, action = true) {
  return table(
    ["TIME", "SEVERITY / SOURCE", "OBSERVATION", "STATUS"],
    rows.map(
      (a) =>
        `<tr><td>${escape(date(a.timestamp))}</td><td>${badge(a.severity)}<br><small>${escape(a.source.toUpperCase())}</small></td><td>${escape(a.message)}<br><small>${escape(a.device_id)}</small></td><td>${a.acknowledged ? "Acknowledged" : action ? `<button class="button small" data-ack="${Number(a.id)}">Acknowledge ↗</button>` : "Open"} <button class="button small" data-replay="${Number(a.id)}">Replay ↗</button></td></tr>`,
    ),
    "No events recorded. New threshold and offline events will appear here.",
  );
}
function metric(label, value, unit, sub) {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}<small>${unit}</small></div><div class="sub">${sub}</div></div>`;
}
function patchMetrics(selector, markup) {
  const root = $(selector);
  if (root.dataset.metricMarkup === markup) return;
  const template = document.createElement("template");
  template.innerHTML = markup;
  if (root.children.length !== template.content.children.length)
    root.replaceChildren(template.content);
  else
    [...template.content.children].forEach((next, index) => {
      for (const selector of [".label", ".value", ".sub"]) {
        const old = root.children[index].querySelector(selector),
          value = next.querySelector(selector);
        if (old.innerHTML !== value.innerHTML) old.innerHTML = value.innerHTML;
      }
    });
  root.dataset.metricMarkup = markup;
}
function sensorOnline() {
  const d = state.devices.find((d) => d.id === state.deviceId);
  return Boolean(
    d?.enabled &&
    state.latest &&
    Date.now() - new Date(state.latest.timestamp).getTime() <
      (state.settings.offlineMs || 5000),
  );
}
function renderMetrics() {
  const alarmReading =
    Object.values(state.readingsByDevice).find(
      (r) =>
        r.status === "critical" &&
        Date.now() - new Date(r.timestamp).getTime() <
          (state.settings.offlineMs || 5000),
    ) || state.latest;
  window.SN2HAlarm?.sync(alarmReading, state.settings, state.stream);
  const r = state.latest,
    online = sensorOnline(),
    status = online ? r.status : "offline";
  $(".bridge-panel").dataset.motion =
    online &&
    (state.source === "hardware" || state.sim.state === "running") &&
    state.view === "overview" &&
    !document.hidden &&
    !state.bridgeMotionPaused
      ? "running"
      : "paused";
  const content =
    metric("ACCELERATION X", fmt(r?.x), "g", "X / longitudinal") +
    metric("ACCELERATION Y", fmt(r?.y), "g", "Y / lateral") +
    metric("ACCELERATION Z", fmt(r?.z), "g", "Z / includes gravity") +
    metric(
      "DYNAMIC MAGNITUDE",
      fmt(r?.magnitude),
      "g",
      "Gravity baseline removed",
    ) +
    metric("ROLLING RMS", fmt(r?.rms), "g", "25-sample window") +
    metric(
      "SENSOR CONNECTION",
      online ? "Online" : "Offline",
      "",
      state.source.toUpperCase() + " / " + escape(state.deviceId),
    );
  patchMetrics("#metrics", content);
  patchMetrics("#liveMetrics", content);
  window.SN2HMotion?.metricsUpdated(r, status);
  window.SN2HBridgeSensors?.refresh();
  $$('[data-value="rms"]').forEach((e) => (e.textContent = fmt(r?.rms)));
  $("#healthBadge").className = "badge-state " + status;
  $("#healthBadge").textContent = online
    ? status === "normal"
      ? "Below demo thresholds"
      : status === "warning"
        ? "Warning threshold reached"
        : "Critical threshold reached"
    : "Sensor offline";
  $("#lastUpdate").textContent = date(r?.timestamp);
  $("#connectivity").textContent = online
    ? state.source.toUpperCase() + " SENSOR CONNECTED"
    : state.source.toUpperCase() + " SENSOR OFFLINE";
  $(".sim-label").textContent = state.source.toUpperCase();
  $(".health-line .tiny").textContent = state.source.toUpperCase();
  $("#view-monitoring .section-heading span:last-child").textContent =
    state.source.toUpperCase();
  $("#liveChart")
    .closest(".chart-card")
    .querySelector(".chart-title .tiny").textContent =
    state.source.toUpperCase() + " · LAST 120 SAMPLES";
  $("#sampling").textContent =
    state.source === "simulation"
      ? `SIMULATION · ${1000 / (state.settings.samplingMs || 50)} Hz nominal sampling · ${((25 * (state.settings.samplingMs || 50)) / 1000).toFixed(2)} s nominal RMS window · ${state.sim.state}`
      : `HARDWARE · ${state.deviceId} · 25 received readings per RMS window · raw acceleration / saved calibration for vibration`;
}
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: {
      position: "bottom",
      align: "start",
      labels: {
        usePointStyle: true,
        pointStyle: "line",
        boxWidth: 24,
        padding: 20,
        color: "#69665c",
        font: { size: 10 },
      },
    },
    tooltip: {
      backgroundColor: "#151515",
      titleFont: { size: 10 },
      bodyFont: { size: 11 },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { maxTicksLimit: 7, color: "#777469", font: { size: 9 } },
      border: { color: "#d9d4c8" },
    },
    y: {
      title: {
        display: true,
        text: "Acceleration (g)",
        color: "#777469",
        font: { size: 9 },
      },
      grid: { color: "#e9e5da" },
      ticks: { color: "#777469", font: { size: 9 } },
      border: { display: false },
    },
  },
};
function initChart() {
  Chart.defaults.font.family = "'DM Sans', Arial, sans-serif";
  state.chart = new Chart($("#liveChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "RMS", borderColor: "#151515", borderWidth: 2, data: [] },
        { label: "X", borderColor: "#9b7851", data: [] },
        { label: "Y", borderColor: "#718779", data: [] },
        { label: "Z (gravity included)", borderColor: "#9c9a8e", data: [] },
      ].map((d) => ({
        ...d,
        pointRadius: 0,
        borderWidth: d.borderWidth || 1,
        tension: 0.2,
      })),
    },
    options: chartOptions,
  });
}
function addReading(r, draw = true) {
  const c = state.chart;
  if (!c) return;
  c.data.labels.push(new Date(r.timestamp).toLocaleTimeString());
  [r.rms, r.x, r.y, r.z].forEach((v, i) => c.data.datasets[i].data.push(v));
  if (c.data.labels.length > 120) {
    c.data.labels.shift();
    c.data.datasets.forEach((d) => d.data.shift());
  }
  if (draw && Date.now() - (addReading.last || 0) > 200) {
    c.update("none");
    addReading.last = Date.now();
  }
}
function renderSim() {
  const s = state.sim;
  $("#simulationAccessText").textContent = isAdmin()
    ? "Administrator session unlocked. Simulator controls are available."
    : "Live simulation is visible to everyone. Unlock admin access to start, pause, resume, stop, or reset it.";
  $("#unlockSimulation").hidden = isAdmin();
  $("#simulationHelp").textContent =
    s.state === "running"
      ? "Start is disabled because a simulation is already running. Stop it before choosing a new scenario, then press Start. View live measurements below."
      : s.state === "paused"
        ? "The simulation is paused. Resume continues this session; Stop allows you to choose and start another scenario."
        : "Choose a scenario and press Start. Admin access is required. Reset restores the controls without deleting database history.";
  $("#simState").textContent = s.state[0].toUpperCase() + s.state.slice(1);
  $("#simDetails").innerHTML = [
    ["SCENARIO", s.scenario],
    ["AMPLITUDE", fmt(s.amplitude) + " g"],
    ["FREQUENCY", fmt(s.frequency, 2) + " Hz"],
    ["NOISE", fmt(s.noise) + " g"],
    ["SIGNAL TIME", fmt(s.elapsed, 1) + " s"],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${escape(v)}</dd>`)
    .join("");
  $$("[data-control]").forEach(
    (b) =>
      (b.disabled =
        b.dataset.control === "pause"
          ? s.state !== "running"
          : b.dataset.control === "resume"
            ? s.state !== "paused"
            : false),
  );
  $("#simulationForm button[type=submit]").disabled = s.state !== "stopped";
}
function renderSettings() {
  for (const [key, value] of Object.entries(state.settings)) {
    const input = $(`#settingsForm [name="${key}"]`);
    if (input) {
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    }
  }
}
function rangeForm(id) {
  const now = new Date(),
    from = new Date(Date.now() - (id === "reportFilters" ? 300000 : 86400000));
  const local = (d) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  return `<form id="${id}Form" class="filters"><label>From<input name="from" type="datetime-local" value="${local(from)}" required></label><label>To<input name="to" type="datetime-local" value="${local(now)}" required></label><label>Data source<select name="source"><option value="simulation">SIMULATION</option><option value="hardware">HARDWARE (untested)</option></select></label><button class="button dark">Apply range ↗</button></form>`;
}
function filterQuery(id) {
  const data = new FormData($("#" + id + "Form"));
  const q = new URLSearchParams();
  for (const [k, v] of data) {
    if (k === "from" || k === "to") {
      const d = new Date(v);
      if (!Number.isFinite(+d)) throw new Error("Select valid dates");
      q.set(k, d.toISOString());
    } else q.set(k, v);
  }
  return q;
}
async function loadAnalytics() {
  const q = filterQuery("analyticsFilters");
  const [stats, history] = await Promise.all([
    api("/sensor-data/statistics?" + q),
    api("/sensor-data/history?" + q + "&limit=500"),
  ]);
  const s = stats.summary,
    events = Object.fromEntries(stats.events.map((e) => [e.severity, e.count]));
  $("#statistics").innerHTML =
    metric(
      "SAMPLES",
      Number(s.samples).toLocaleString(),
      "",
      "Stored observations",
    ) +
    metric("AVERAGE RMS", fmt(s.avg_rms), "g", "Selected source") +
    metric("MAXIMUM RMS", fmt(s.max_rms), "g", "Selected source") +
    metric("PEAK MAGNITUDE", fmt(s.peak), "g", "Baseline corrected") +
    metric("WARNING EVENTS", events.warning || 0, "", "Threshold transitions") +
    metric(
      "CRITICAL EVENTS",
      events.critical || 0,
      "",
      "Threshold transitions",
    );
  $("#historyCount").textContent =
    `${stats.source.toUpperCase()} · NEWEST ${history.rows.length} OF ${history.total} RECORDS`;
  const rows = [...history.rows].reverse();
  const config = {
    type: "line",
    data: {
      labels: rows.map((r) => date(r.timestamp)),
      datasets: [
        {
          label: "RMS / " + stats.source.toUpperCase(),
          data: rows.map((r) => r.rms),
          borderColor: "#151515",
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: chartOptions,
  };
  if (state.historyChart) state.historyChart.destroy();
  state.historyChart = new Chart($("#historyChart"), config);
  window.SN2HMotion?.chartReady($("#historyChart"));
  for (const key of ["hourly", "daily"])
    $("#" + key).innerHTML = table(
      ["PERIOD", "AVG RMS", "MAX RMS"],
      stats[key].map(
        (r) =>
          `<tr><td>${escape(r.period)}</td><td>${fmt(r.average)} g</td><td>${fmt(r.maximum)} g</td></tr>`,
      ),
    );
}
async function loadAlerts() {
  const data = new FormData($("#alertFilters"));
  const q = new URLSearchParams({
    from: new Date(0).toISOString(),
    page: state.alertPage,
    limit: 20,
  });
  for (const [k, v] of data) if (v) q.set(k, v);
  const result = await api("/alerts?" + q);
  state.alertTotal = result.total;
  $("#alertsTable").innerHTML = alertRows(result.rows);
  $("#alertPage").textContent =
    `Page ${state.alertPage} · ${result.total} events`;
  $("#previousAlerts").disabled = state.alertPage <= 1;
  $("#nextAlerts").disabled = state.alertPage * 20 >= result.total;
}
async function loadRecent() {
  const r = await api("/alerts?from=" + new Date(0).toISOString() + "&limit=4");
  state.alerts = r.rows;
  $("#recentAlerts").innerHTML = alertRows(r.rows);
}
async function loadDevices() {
  state.devices = await api("/fleet");
  for (const d of state.devices)
    if (d.latest) state.readingsByDevice[d.id] = d.latest;
  $("#devices").innerHTML = state.devices
    .map(
      (d) =>
        `<div class="form-card"><div class="device-status"><span class="eyebrow">${escape(d.source.toUpperCase())}</span>${badge(d.status)}</div><h3>${escape(d.name)}</h3><dl><dt>DEVICE ID</dt><dd>${escape(d.id)}</dd><dt>LAST UPDATE</dt><dd>${escape(date(d.last_seen))}</dd><dt>BRIDGE</dt><dd>SN²H Demonstration / 01</dd></dl><button class="button" data-device="${escape(d.id)}" data-enabled="${!d.enabled}">${d.enabled ? "Disable" : "Enable"} device ↗</button></div>`,
    )
    .join("");
  renderMetrics();
  window.SN2HFeatures?.devicesUpdated();
  window.SN2HAdvanced?.devicesUpdated();
}
async function loadReports() {
  const q = filterQuery("reportFilters");
  const s = await api("/sensor-data/statistics?" + q);
  $("#reportPreview").innerHTML =
    `<div class="notice">${Number(s.summary.samples).toLocaleString()} ${escape(s.source.toUpperCase())} readings in the selected period. Average RMS: ${fmt(s.summary.avg_rms)} g.</div>`;
}
async function refresh() {
  const [settings, sim, latest] = await Promise.all([
    api("/settings"),
    api("/simulation/status"),
    api(
      "/sensor-data/history?limit=120&source=" +
        state.source +
        "&device_id=" +
        encodeURIComponent(state.deviceId),
    ),
  ]);
  state.settings = settings;
  state.sim = sim;
  state.latest = latest.rows[0] || null;
  renderSettings();
  renderSim();
  if (state.chart) {
    state.chart.data.labels = [];
    state.chart.data.datasets.forEach((d) => (d.data = []));
    [...latest.rows].reverse().forEach((r) => addReading(r, false));
    state.chart.update("none");
  }
  await Promise.all([loadRecent(), loadDevices()]);
  renderMetrics();
}
let teamPageModule = null,
  teamPageAssets = null,
  teamPageNavigation = 0;
async function syncTeamPage() {
  const ticket = ++teamPageNavigation;
  if (state.view !== "about") {
    teamPageModule?.deactivate();
    return;
  }
  const root = $("#view-about");
  root.setAttribute("aria-busy", "true");
  if (!teamPageAssets) {
    const stylesheet = new Promise((resolve, reject) => {
      let link = document.querySelector("#sn2h-team-styles");
      if (link?.sheet) return resolve();
      if (!link) {
        link = document.createElement("link");
        link.id = "sn2h-team-styles";
        link.rel = "stylesheet";
        link.href = "/team-page.css";
        document.head.append(link);
      }
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener(
        "error",
        () => {
          link.remove();
          reject(
            new Error("Our Team stylesheet could not load. Please retry."),
          );
        },
        { once: true },
      );
    });
    teamPageAssets = Promise.all([stylesheet, import("/team-page.js")])
      .then(([, module]) => (teamPageModule = module))
      .catch((error) => {
        teamPageAssets = null;
        throw error;
      });
  }
  try {
    const module = await teamPageAssets;
    if (ticket === teamPageNavigation && state.view === "about")
      module.activate(root, SN2H_TEAM);
  } catch (error) {
    root
      .querySelectorAll(".reveal")
      .forEach((el) => el.classList.add("is-visible"));
    throw error;
  } finally {
    root.removeAttribute("aria-busy");
  }
}
function navigate() {
  const key = location.hash.slice(1) || "overview";
  state.view = pages.some(([k]) => k === key) ? key : "overview";
  $("#projectIdentity").hidden = state.view !== "overview";
  $(".masthead").classList.toggle(
    "masthead-compact",
    state.view !== "overview",
  );
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + state.view));
  $$("nav a").forEach((a) => {
    a.classList.toggle("active", a.hash === "#" + state.view);
    a.setAttribute(
      "aria-current",
      a.hash === "#" + state.view ? "page" : "false",
    );
  });
  $("#navigation").classList.remove("open");
  $("#menu").setAttribute("aria-expanded", "false");
  const chartCard = $("#liveChart").closest(".chart-card");
  if (state.view === "monitoring") $("#liveChartTarget").append(chartCard);
  else if (!$("#view-overview").contains(chartCard))
    $("#chartHome").after(chartCard);
  if (state.chart) state.chart.resize();
  if (state.view === "analytics") task(loadAnalytics);
  if (state.view === "alerts") task(loadAlerts);
  if (state.view === "devices") task(loadDevices);
  if (state.view === "reports") task(loadReports);
  window.SN2HFeatures?.navigated(state.view);
  window.SN2HAdvanced?.navigated(state.view);
  syncTeamPage().catch(showError);
  window.SN2HMotion?.pageChanged(state.view);
}
async function boot() {
  $("#toggleBridgeMotion").onclick = () => {
    state.bridgeMotionPaused = !state.bridgeMotionPaused;
    const button = $("#toggleBridgeMotion");
    button.setAttribute("aria-pressed", String(state.bridgeMotionPaused));
    button.innerHTML = state.bridgeMotionPaused
      ? 'Resume motion <i class="bi bi-play" aria-hidden="true"></i>'
      : 'Pause motion <i class="bi bi-pause" aria-hidden="true"></i>';
    renderMetrics();
  };
  $("#navigation").innerHTML = pages
    .map(([key, label]) => `<a href="#${key}">${label}</a>`)
    .join("");
  $("#analyticsFilters").innerHTML = rangeForm("analyticsFilters");
  $("#reportFilters").innerHTML = rangeForm("reportFilters");
  // Cable hangers follow the conceptual suspension curve; the SVG is not an engineering model.
  for (let x = 35; x < 900; x += 25) {
    let y;
    if (x < 219) y = 249 - (x / 219) ** 1.5 * 163;
    else if (x < 652) {
      const t = (x - 219) / 433;
      y = 86 + 140 * 4 * t * (1 - t);
    } else y = 86 + 163 * ((x - 652) / 258) ** 0.6;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("y1", Math.min(y, 249));
    line.setAttribute("y2", 250);
    $("#hangers").append(line);
  }
  initChart();
  $("#menu").onclick = () => {
    const open = $("#navigation").classList.toggle("open");
    $("#menu").setAttribute("aria-expanded", String(open));
  };
  $("#unlock").onclick = () => {
    if (state.token) {
      state.token = "";
      $("#unlock").textContent = "Admin access ↗";
      toast("Admin session locked");
      renderSim();
    } else $("#authDialog").showModal();
  };
  $("#unlockSimulation").onclick = () => $("#authDialog").showModal();
  $("#cancelAuth").onclick = () => $("#authDialog").close();
  $("#authForm").onsubmit = (e) => {
    e.preventDefault();
    task(async () => {
      const token = $("#adminToken").value;
      const response = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error("Invalid admin token");
      state.token = token;
      $("#adminToken").value = "";
      $("#authDialog").close();
      $("#unlock").textContent = "Lock session ↗";
      toast("Controls unlocked");
      renderSim();
    });
  };
  window.addEventListener("hashchange", navigate);
  $("#analyticsFiltersForm").onsubmit = (e) => {
    e.preventDefault();
    task(loadAnalytics);
  };
  $("#reportFiltersForm").onsubmit = (e) => {
    e.preventDefault();
    task(loadReports);
  };
  $("#alertFilters").onsubmit = (e) => {
    e.preventDefault();
    state.alertPage = 1;
    task(loadAlerts);
  };
  $("#previousAlerts").onclick = () => {
    state.alertPage--;
    task(loadAlerts);
  };
  $("#nextAlerts").onclick = () => {
    state.alertPage++;
    task(loadAlerts);
  };
  function sliders() {
    ["amplitude", "frequency", "noise"].forEach(
      (key, i) =>
        ($("#" + key + "Value").textContent =
          $("#" + key).value + (i === 1 ? " Hz" : " g")),
    );
  }
  $("#scenario").onchange = () => {
    presets[$("#scenario").value].forEach(
      (v, i) => ($("#" + ["amplitude", "frequency", "noise"][i]).value = v),
    );
    sliders();
  };
  ["amplitude", "frequency", "noise"].forEach(
    (k) => ($("#" + k).oninput = sliders),
  );
  sliders();
  $("#simulationForm").onsubmit = (e) => {
    e.preventDefault();
    if (!needsAdmin()) return;
    task(async () => {
      const body = { scenario: $("#scenario").value };
      ["amplitude", "frequency", "noise"].forEach(
        (k) => (body[k] = Number($("#" + k).value)),
      );
      state.sim = await api("/simulation/start", {
        method: "POST",
        body: JSON.stringify(body),
      });
      renderSim();
      toast("Simulation started");
    });
  };
  $("#settingsForm").onsubmit = (e) => {
    e.preventDefault();
    if (!needsAdmin()) return;
    task(async () => {
      const form = e.target,
        body = {};
      ["warning", "critical", "samplingMs", "offlineMs"].forEach(
        (k) => (body[k] = Number(form.elements[k].value)),
      );
      ["sound", "autoStart"].forEach(
        (k) => (body[k] = form.elements[k].checked),
      );
      state.settings = await api("/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      renderMetrics();
      toast("Settings saved to MySQL");
    });
  };
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    if (button.dataset.control) {
      if (!needsAdmin()) return;
      task(async () => {
        state.sim = await api("/simulation/" + button.dataset.control, {
          method: "POST",
        });
        renderSim();
        if (button.dataset.control === "reset") {
          $("#scenario").value = "normal";
          $("#scenario").dispatchEvent(new Event("change"));
        }
        toast("Simulation " + state.sim.state);
      });
    }
    if (button.dataset.ack) {
      if (!needsAdmin()) return;
      task(async () => {
        await api("/alerts/" + button.dataset.ack + "/acknowledge", {
          method: "PATCH",
        });
        await loadRecent();
        if (state.view === "alerts") await loadAlerts();
        toast("Alert acknowledged");
      });
    }
    if (button.dataset.device) {
      if (!needsAdmin()) return;
      task(async () => {
        await api("/devices/" + button.dataset.device, {
          method: "PATCH",
          body: JSON.stringify({ enabled: button.dataset.enabled === "true" }),
        });
        await loadDevices();
        toast("Device updated");
      });
    }
    if (button.dataset.report)
      task(async () => {
        const q = filterQuery("reportFilters"),
          res = await fetch("/api/reports/" + button.dataset.report + "?" + q);
        if (!res.ok) throw new Error((await res.json()).error);
        const url = URL.createObjectURL(await res.blob()),
          a = document.createElement("a");
        a.href = url;
        a.download = `sn2h-${button.dataset.report}-${q.get("source")}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Report downloaded");
      });
  });
  const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  window.SN2HLiveSocket = socket;
  socket.on("connect", () => {
    state.stream = true;
    $("#stream").textContent = "LIVE STREAM";
    $("#streamDot").className = "dot normal";
    task(async () => {
      await refresh();
      if (state.view === "alerts") await loadAlerts();
    });
  });
  socket.on("disconnect", () => {
    state.stream = false;
    $("#stream").textContent = "RECONNECTING";
    $("#streamDot").className = "dot offline";
  });
  socket.on("connect_error", () => {
    $("#stream").textContent = "SERVER UNAVAILABLE";
  });
  socket.on("sensor:update", (r) => {
    state.readingsByDevice[r.device_id] = r;
    if (r.source !== state.source || r.device_id !== state.deviceId) return;
    state.latest = r;
    const d = state.devices.find((d) => d.id === r.device_id);
    if (d) d.last_seen = r.timestamp;
    addReading(r);
  });
  socket.on("simulation:status", (s) => {
    state.sim = s;
    renderSim();
  });
  socket.on("settings:update", (s) => {
    state.settings = s;
    renderSettings();
    renderMetrics();
  });
  socket.on("device:offline", () => {
    renderMetrics();
    if (state.view === "devices") task(loadDevices);
  });
  socket.on("device:update", () => task(loadDevices));
  socket.on("alert:new", (a) => {
    toast(a.source.toUpperCase() + " / " + a.message);
    task(async () => {
      await loadRecent();
      if (state.view === "alerts") await loadAlerts();
    });
  });
  socket.on("alert:acknowledged", () =>
    task(async () => {
      await loadRecent();
      if (state.view === "alerts") await loadAlerts();
    }),
  );
  socket.on("system:error", showError);
  socket.on("demo:status", (s) => window.SN2HFeatures?.demoStatus(s));
  function updateClock() {
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString(undefined, {
      hour12: false,
    });
    $("#calendar").textContent = now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    $("#clock").dateTime = now.toISOString();
    $("#calendar").dateTime = now.toISOString();
  }
  updateClock();
  setInterval(() => {
    updateClock();
    renderMetrics();
  }, 1000);
  setInterval(() => {
    if (state.view === "devices") task(loadDevices);
  }, 5000);
  setInterval(renderMetrics, 250);
  navigate();
  await task(refresh);
  await task(() => window.SN2HFeatures.init());
  window.SN2HBridgeSensors?.init();
  await task(() => window.SN2HAdvanced.init());
  window.SN2HMotion?.init();
}
boot().catch(showError);
