"use strict";
// Additional UI modules share the existing REST helpers and hash navigation.
window.SN2HFeatures = (() => {
  let ready = false,
    setupRequired = false,
    fftChart = null,
    replayChart = null,
    replayRows = [],
    replayIndex = 0,
    replayTimer = null,
    replayTime = 0,
    demo = null;
  const select = (s) => document.querySelector(s),
    selectAll = (s) => [...document.querySelectorAll(s)];
  const html = (target, markup) =>
    select(target).insertAdjacentHTML("beforeend", markup);
  const adminTask = (fn) => {
    if (needsAdmin()) return task(fn);
  };
  function sessionUI() {
    select("#unlock").textContent = state.user
      ? `${state.user.role === "admin" ? "Admin" : "Viewer"} · Sign out`
      : state.token
        ? "Lock recovery session"
        : "Sign in ↗";
    select("#unlock").title = state.user
      ? `${state.user.username} (${state.user.role})`
      : "Account access";
    select("#featureAccountStatus").textContent = state.user
      ? `Signed in as ${state.user.username} / ${state.user.role.toUpperCase()}`
      : state.token
        ? "Recovery administrator session unlocked"
        : "Viewer mode. Sign in as an administrator to change devices, demo controls, or accounts.";
    renderSim();
    select("#setupAccountForm").hidden = !setupRequired;
    select("#loginAccountForm").hidden = setupRequired;
    window.dispatchEvent(new Event("sn2h:account"));
    select("#createUserForm").hidden = !isAdmin();
    select("#notificationForm").hidden = !isAdmin();
    select("#changePasswordForm").hidden = !state.user;
    if (!isAdmin()) {
      select("#userList").textContent =
        "Administrator access required to manage accounts.";
      select("#deliveryHistory").replaceChildren();
      select("#smtpStatus").textContent =
        "Sign in as an administrator to configure email notifications.";
    }
  }
  async function loadSession() {
    const result = await api("/auth/status");
    state.user = result.user;
    state.csrf = result.csrf || "";
    setupRequired = result.setupRequired;
    sessionUI();
  }
  async function signIn(e) {
    e.preventDefault();
    await task(async () => {
      const form = e.target,
        values = Object.fromEntries(new FormData(form)),
        result = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify(values),
        });
      state.user = result.user;
      state.csrf = result.csrf;
      state.token = "";
      form.reset();
      select("#authDialog").close();
      sessionUI();
      toast("Signed in as " + result.user.role);
      await loadAdminPanels();
      window.SN2HLiveSocket?.connect();
      await refresh();
    });
  }
  async function setupAccount(e) {
    e.preventDefault();
    await task(async () => {
      const form = e.target,
        values = Object.fromEntries(new FormData(form));
      await api("/auth/setup", {
        method: "POST",
        headers: { Authorization: "Bearer " + values.token },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      });
      form.reset();
      setupRequired = false;
      sessionUI();
      select("#loginAccountForm [name=username]").value = values.username;
      toast("Administrator created. Sign in with your new password.");
    });
  }
  function buildUI() {
    const legacy = select("#authForm"),
      details = document.createElement("details");
    details.className = "recovery-access";
    details.innerHTML = "<summary>Local recovery token access</summary>";
    legacy.before(details);
    details.append(legacy);
    details.insertAdjacentHTML(
      "beforebegin",
      `<form id="loginAccountForm"><span class="eyebrow">SN²H ACCOUNT ACCESS</span><h2>Sign in<span class="serif">.</span></h2><p>Viewer accounts can inspect data. Administrator accounts control monitoring.</p><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="64"></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128"></label><button class="button dark">Sign in ↗</button><button class="button" type="button" data-close-auth>Cancel</button></form><form id="setupAccountForm" hidden><span class="eyebrow">ONE-TIME ACCOUNT SETUP</span><h2>Create administrator.</h2><p>Use ADMIN_TOKEN from the local .env file once to establish the first administrator. Passwords are stored as salted scrypt hashes.</p><label>Local ADMIN_TOKEN<input name="token" type="password" autocomplete="off" required></label><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="64"></label><label>Password (12–128 characters)<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><button class="button dark">Create administrator ↗</button><button class="button" type="button" data-close-auth>Cancel</button></form><p id="accountError" class="muted" role="alert"></p>`,
    );
    const toolbar = document.createElement("div");
    toolbar.id = "sourceToolbar";
    toolbar.className = "source-toolbar";
    toolbar.innerHTML =
      '<label>Live data source<select id="liveSource"><option value="simulation">SIMULATION</option><option value="hardware">HARDWARE</option></select></label><label>Sensor / location<select id="liveDevice"></select></label><span class="fineprint">Hardware is shown only when actual measurements arrive.</span>';
    select(".masthead").after(toolbar);
    html(
      "#view-simulation",
      `<section class="form-card feature-section"><span class="eyebrow">GUIDED DEMONSTRATION</span><h3>Normal. Warning. Critical. Recovery.</h3><p>A 44-second server-controlled walkthrough of real simulator scenarios. It creates labelled simulation readings and alerts. It can trigger the site-wide alarm.</p><ol id="demoSteps" class="demo-steps"></ol><p id="demoProgress" role="status">Loading demo status…</p><div class="button-row"><button id="startGuidedDemo" class="button dark" type="button">Start guided demo ↗</button><button id="stopGuidedDemo" class="button" type="button">Stop demo</button></div></section>`,
    );
    html(
      "#view-devices",
      `<section class="form-card feature-section"><span class="eyebrow">REGISTER HARDWARE / BRIDGE 01</span><h3>Add a sensor location.</h3><form id="registerDeviceForm" class="settings-grid"><label>Device ID (esp32-...)<input name="id" placeholder="esp32-west" pattern="esp32-[a-zA-Z0-9-]{1,30}" required maxlength="36"></label><label>Device name<input name="name" required maxlength="100" placeholder="West span ADXL345"></label><label>Mounting location<input name="location" required maxlength="120" placeholder="West span"></label><label>Position along bridge (0 to 1)<input name="position" type="number" min="0" max="1" step="0.01" value="0.25" required></label><div><button class="button dark">Register sensor ↗</button></div></form><p class="fineprint">Registration does not fabricate readings. New devices remain offline until authenticated hardware sends measurements. Use a distinct device_id in each firmware configuration.</p></section>`,
    );
    html(
      "#view-analytics",
      `<section class="chart-card feature-section"><div class="chart-title"><h2>Frequency spectrum.</h2><span class="tiny">STORED SAMPLE TIMESTAMPS / HANN WINDOW</span></div><form id="spectrumForm" class="filters"><label>Device<select id="spectrumDevice"></select></label><label>Axis<select id="spectrumAxis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label><button class="button dark">Analyze stored window ↗</button></form><p id="spectrumSummary" class="muted">Select a sensor and analyze at least 32 stored measurements.</p><div class="chart-wrap"><canvas id="spectrumChart" role="img" aria-label="Stored acceleration frequency spectrum"></canvas></div><p class="fineprint">Frequency estimates use stored sample times and linear resampling, with DC removal and a Hann window. They are not a structural diagnosis or certified modal analysis.</p></section>`,
    );
    html(
      "#view-reports",
      `<div class="form-card feature-section"><span class="eyebrow">BRANDED PDF / DATABASE RESULTS</span><h3>Take the observations with you.</h3><p>The current report date range and source are used for a PDF containing summary statistics, a vector RMS chart and an alert register.</p><button id="downloadPdfReport" class="button dark" type="button">Download SN²H PDF ↓</button></div>`,
    );
    html(
      "#view-settings",
      `<section class="form-card feature-section"><span class="eyebrow">ACCOUNT & ROLES</span><p id="featureAccountStatus"></p><div id="userList"></div><form id="createUserForm" class="settings-grid"><label>New username<input name="username" autocomplete="off" minlength="3" maxlength="64" required></label><label>New password (12–128 characters)<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Role<select name="role"><option value="viewer">Viewer (read only)</option><option value="admin">Administrator</option></select></label><div><button class="button dark">Create account</button></div></form><details><summary>Change my password</summary><form id="changePasswordForm"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button class="button">Change password & sign out</button></form></details></section><section class="form-card feature-section"><span class="eyebrow">EMAIL NOTIFICATIONS</span><p id="smtpStatus">Administrator sign-in required to inspect notification configuration.</p><form id="notificationForm" class="settings-grid"><label>Recipient email<input name="recipient" type="email" maxlength="254"></label><label>Cooldown per device / severity (seconds)<input name="cooldownSeconds" type="number" min="30" max="3600" value="120" required></label><label class="check-label"><input name="enabled" type="checkbox"> Enable email delivery</label><label class="check-label"><input name="critical" type="checkbox" checked> Critical events</label><label class="check-label"><input name="offline" type="checkbox" checked> Offline events</label><label class="check-label"><input name="warning" type="checkbox"> Warning events</label><div class="button-row"><button class="button dark">Save email preferences</button><button id="verifySmtp" class="button" type="button">Verify SMTP connection</button></div></form><p class="fineprint">SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM and optional SMTP_USER / SMTP_PASSWORD belong in the server .env file. Credentials never enter browser files. Delivery is disabled until a real SMTP service is configured.</p><div id="deliveryHistory"></div></section>`,
    );
    html(
      "body",
      `<dialog id="deviceProfileDialog"><form id="deviceProfileForm"><span class="eyebrow">SENSOR LOCATION</span><h2>Edit mounting location.</h2><input name="id" type="hidden"><label>Location<input name="location" maxlength="120" required></label><label>Position (0 to 1)<input name="position" type="number" min="0" max="1" step="0.01" required></label><div class="button-row"><button class="button dark">Save location</button><button type="button" class="button" data-close-profile>Cancel</button></div></form></dialog><dialog id="playbackDialog" class="playback-dialog"><div class="button-row"><h2>Event playback.</h2><button class="button small" id="closePlayback" type="button">Close</button></div><p id="playbackEvent"></p><div class="chart-wrap"><canvas id="playbackChart" role="img" aria-label="Recorded event RMS playback"></canvas></div><label>Recorded sample<input id="playbackPosition" type="range" min="0" value="0" step="1"></label><p id="playbackReading" class="playback-reading"></p><div class="button-row"><button id="playPlayback" type="button" class="button dark">Play</button><label>Playback speed<select id="playbackSpeed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div><p class="fineprint">Replay is historical and does not alter live monitoring, simulation or alert state. A bounded 30-second window on each side of the event is used.</p></dialog>`,
    );
  }
  function devicesUpdated() {
    if (!ready) return;
    const source = select("#liveSource");
    source.value = state.source;
    const options = state.devices.filter((d) => d.source === state.source);
    select("#liveDevice").innerHTML = options.length
      ? options
          .map(
            (d) =>
              `<option value="${escape(d.id)}">${escape(d.name)} / ${escape(d.location || "Unassigned")}</option>`,
          )
          .join("")
      : '<option value="">No registered sensors</option>';
    select("#liveDevice").value = state.deviceId;
    const spectrum = select("#spectrumDevice"),
      prior = spectrum.value;
    spectrum.innerHTML = state.devices
      .map(
        (d) =>
          `<option value="${escape(d.id)}">${escape(d.source.toUpperCase() + " / " + d.name)}</option>`,
      )
      .join("");
    spectrum.value = state.devices.some((d) => d.id === prior)
      ? prior
      : state.deviceId;
    selectAll("#devices .form-card").forEach((card) => {
      const d = state.devices.find(
        (d) => d.id === card.querySelector("[data-device]")?.dataset.device,
      );
      if (!d) return;
      card.querySelector(".device-feature-details")?.remove();
      const details = document.createElement("div");
      details.className = "device-feature-details";
      const telemetryFresh =
        d.telemetry_at &&
        Date.now() - new Date(d.telemetry_at).getTime() <
          (state.settings.offlineMs || 5000);
      details.innerHTML = `<dl><dt>MOUNTING LOCATION / POSITION</dt><dd>${escape(d.location || "Unassigned")} / ${fmt(d.position ?? 0.5, 2)}</dd><dt>WIFI SIGNAL / UPTIME</dt><dd>${d.rssi === null || d.rssi === undefined ? "Not reported" : fmt(d.rssi, 0) + " dBm"} / ${d.uptime_ms === null || d.uptime_ms === undefined ? "Not reported" : fmt(d.uptime_ms / 3600000, 2) + " hours"}</dd><dt>FIRMWARE / BATTERY</dt><dd>${escape(d.firmware || "Not reported")} / ${d.battery === null || d.battery === undefined ? "Not reported" : fmt(d.battery, 0) + "%"}${d.telemetry_at && !telemetryFresh ? " (last reported; stale)" : ""}</dd><dt>CALIBRATION OFFSETS (g)</dt><dd>X ${fmt(d.offset_x || 0)} / Y ${fmt(d.offset_y || 0)} / Z ${fmt(d.offset_z || 0)}<br><small>${d.calibration_at ? escape(date(d.calibration_at)) : "Not calibrated; fixed +Z gravity baseline"}</small></dd></dl><div class="button-row"><button class="button small" data-profile="${escape(d.id)}">Edit location</button><button class="button small" data-calibrate="${escape(d.id)}">Calibrate stationary sensor</button><button class="button small" data-reset-calibration="${escape(d.id)}">Reset calibration</button></div>`;
      card.append(details);
    });
    window.SN2HBridgeSensors?.refresh();
  }
  async function selectDevice(id) {
    const d = state.devices.find((d) => d.id === id);
    if (!d) {
      state.latest = null;
      renderMetrics();
      return;
    }
    state.deviceId = id;
    state.source = d.source;
    await refresh();
    devicesUpdated();
  }
  function navigated(view) {
    if (!ready) return;
    select("#sourceToolbar").hidden = !["overview", "monitoring"].includes(
      view,
    );
    if (view === "settings") task(loadAdminPanels);
    if (view === "simulation")
      api("/demo/status").then(demoStatus).catch(showError);
  }
  async function loadAdminPanels() {
    sessionUI();
    if (!isAdmin()) {
      select("#userList").textContent =
        "Administrator access required to manage accounts.";
      select("#deliveryHistory").textContent = "";
      return;
    }
    const [users, mail] = await Promise.all([
      api("/auth/users"),
      api("/notifications"),
    ]);
    select("#userList").innerHTML = table(
      ["USERNAME", "ROLE", "CREATED"],
      users.map(
        (u) =>
          `<tr><td>${escape(u.username)}</td><td>${escape(u.role)}</td><td>${escape(date(u.created_at))}</td></tr>`,
      ),
    );
    select("#smtpStatus").textContent = mail.configured
      ? "SMTP environment is configured. Verify the connection before enabling delivery."
      : "SMTP is not configured. Add your real SMTP settings to .env, restart the server, then verify.";
    const f = select("#notificationForm");
    for (const [k, v] of Object.entries(mail.config)) {
      const input = f.elements[k];
      if (input)
        input.type === "checkbox" ? (input.checked = v) : (input.value = v);
    }
    select("#deliveryHistory").innerHTML = table(
      ["EVENT", "DEVICE", "STATE", "ATTEMPTS"],
      mail.deliveries.map(
        (d) =>
          `<tr><td>${escape(d.severity)}</td><td>${escape(d.device_id)}</td><td>${escape(d.status)}<br><small>${escape(d.detail || "")}</small></td><td>${d.attempts}</td></tr>`,
      ),
      "No email deliveries have been queued.",
    );
  }
  async function analyzeSpectrum(e) {
    e.preventDefault();
    select("#spectrumSummary").textContent = "Analyzing stored timestamps…";
    try {
      const data = await api(
        "/analysis/spectrum?device_id=" +
          encodeURIComponent(select("#spectrumDevice").value) +
          "&axis=" +
          select("#spectrumAxis").value,
      );
      select("#spectrumSummary").textContent =
        `Dominant frequency ${fmt(data.dominantHz, 3)} Hz · ${data.samples} samples · estimated ${fmt(data.sampleRate, 2)} samples/s · resolution ${fmt(data.resolution, 3)} Hz`;
      fftChart?.destroy();
      fftChart = new Chart(select("#spectrumChart"), {
        type: "line",
        data: {
          labels: data.bins.map((b) => b.frequency.toFixed(2)),
          datasets: [
            {
              label: "Amplitude (g)",
              data: data.bins.map((b) => b.amplitude),
              borderColor: "#151515",
              borderWidth: 1.5,
              pointRadius: 0,
            },
          ],
        },
        options: chartOptions,
      });
      window.SN2HMotion?.chartReady(select("#spectrumChart"));
    } catch (e) {
      select("#spectrumSummary").textContent = e.message;
    }
  }
  async function downloadPDF() {
    const q = filterQuery("reportFilters"),
      r = await fetch("/api/reports/pdf?" + q);
    if (!r.ok) throw new Error((await r.json()).error);
    const url = URL.createObjectURL(await r.blob()),
      link = document.createElement("a");
    link.href = url;
    link.download = `sn2h-${q.get("source")}-report.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("PDF report downloaded");
  }
  function stopPlayback() {
    clearInterval(replayTimer);
    replayTimer = null;
    select("#playPlayback").textContent = "Play";
  }
  function drawPlayback() {
    if (!replayRows.length) return;
    const r = replayRows[replayIndex];
    select("#playbackPosition").value = replayIndex;
    select("#playbackReading").textContent =
      `${r.source.toUpperCase()} / ${r.device_id} · ${date(r.timestamp)} · RMS ${fmt(r.rms)} g · X ${fmt(r.x)} / Y ${fmt(r.y)} / Z ${fmt(r.z)} g`;
    replayChart.data.datasets[1].data = replayRows.map((r, i) =>
      i === replayIndex ? r.rms : null,
    );
    replayChart.update("none");
  }
  async function openReplay(id) {
    const result = await api("/alerts/" + id + "/playback");
    stopPlayback();
    replayRows = result.rows;
    replayIndex = 0;
    select("#playbackEvent").textContent =
      `${result.event.source.toUpperCase()} / ${result.event.device_id} / ${result.event.severity.toUpperCase()} · ${date(result.event.timestamp)}${result.truncated ? " · window limited to first 2,000 readings" : ""}${!replayRows.length ? " · No stored readings near this event." : ""}`;
    select("#playbackPosition").max = Math.max(0, replayRows.length - 1);
    select("#playPlayback").disabled = !replayRows.length;
    select("#playbackReading").textContent = "";
    select("#playbackDialog").showModal();
    replayChart?.destroy();
    replayChart = new Chart(select("#playbackChart"), {
      type: "line",
      data: {
        labels: replayRows.map((r) => date(r.timestamp)),
        datasets: [
          {
            label: "Recorded RMS (g)",
            data: replayRows.map((r) => r.rms),
            borderColor: "#151515",
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: "Playback cursor",
            data: [],
            borderColor: "#b54b3f",
            backgroundColor: "#b54b3f",
            pointRadius: 5,
            showLine: false,
          },
        ],
      },
      options: chartOptions,
    });
    drawPlayback();
  }
  function demoStatus(value) {
    demo = value;
    if (!ready) return;
    select("#demoSteps").innerHTML = value.steps
      .map(
        (step, i) =>
          `<li class="${value.step === i && value.state === "running" ? "current" : ""}">${escape(step.title)}<small>${step.seconds} seconds</small></li>`,
      )
      .join("");
    select("#demoProgress").textContent =
      value.state === "running"
        ? `Step ${value.step + 1} of ${value.steps.length}: ${value.steps[value.step].title}. ${Math.max(0, Math.ceil((value.deadline - Date.now()) / 1000))} seconds remaining.`
        : `Demo ${value.state}. ${value.state === "complete" ? "Normal simulation continues." : ""}`;
    select("#startGuidedDemo").disabled = value.state === "running";
    select("#stopGuidedDemo").disabled = value.state !== "running";
  }
  async function init() {
    buildUI();
    ready = true;
    select("#loginAccountForm").onsubmit = signIn;
    select("#setupAccountForm").onsubmit = setupAccount;
    selectAll("[data-close-auth]").forEach(
      (b) => (b.onclick = () => select("#authDialog").close()),
    );
    selectAll("[data-close-profile]").forEach(
      (b) => (b.onclick = () => select("#deviceProfileDialog").close()),
    );
    select("#unlock").onclick = () =>
      task(async () => {
        if (state.user || state.token) {
          await api("/auth/logout", { method: "POST" });
          state.user = null;
          state.csrf = "";
          state.token = "";
          sessionUI();
          toast("Signed out");
          window.location.reload();
        } else {
          await loadSession();
          select("#authDialog").showModal();
        }
      });
    select("#liveSource").onchange = () =>
      task(async () => {
        state.source = select("#liveSource").value;
        const d = state.devices.find((d) => d.source === state.source);
        if (d) await selectDevice(d.id);
        else {
          state.deviceId = "";
          state.latest = null;
          devicesUpdated();
          renderMetrics();
        }
      });
    select("#liveDevice").onchange = () =>
      task(() => selectDevice(select("#liveDevice").value));
    select("#registerDeviceForm").onsubmit = (e) => {
      e.preventDefault();
      adminTask(async () => {
        const b = Object.fromEntries(new FormData(e.target));
        b.position = Number(b.position);
        await api("/devices", { method: "POST", body: JSON.stringify(b) });
        e.target.reset();
        await loadDevices();
        toast("Hardware sensor registered; awaiting real measurements");
      });
    };
    select("#deviceProfileForm").onsubmit = (e) => {
      e.preventDefault();
      adminTask(async () => {
        const b = Object.fromEntries(new FormData(e.target));
        await api("/devices/" + encodeURIComponent(b.id) + "/profile", {
          method: "PATCH",
          body: JSON.stringify({
            location: b.location,
            position: Number(b.position),
          }),
        });
        select("#deviceProfileDialog").close();
        await loadDevices();
        toast("Sensor location saved");
      });
    };
    document.addEventListener("click", (e) => {
      const b = e.target.closest(
        "[data-profile],[data-calibrate],[data-reset-calibration],[data-replay]",
      );
      if (!b) return;
      if (b.dataset.replay) return task(() => openReplay(b.dataset.replay));
      if (!needsAdmin()) return;
      if (b.dataset.profile) {
        const d = state.devices.find((d) => d.id === b.dataset.profile),
          f = select("#deviceProfileForm");
        f.elements.id.value = d.id;
        f.elements.location.value = d.location || "";
        f.elements.position.value = d.position ?? 0.5;
        select("#deviceProfileDialog").showModal();
      }
      if (b.dataset.calibrate) {
        if (
          !window.confirm(
            "Keep this sensor stationary with +Z pointing upward. Use its most recent 100–200 raw readings to save calibration?",
          )
        )
          return;
        task(async () => {
          await api(
            "/devices/" +
              encodeURIComponent(b.dataset.calibrate) +
              "/calibration",
            { method: "POST", body: JSON.stringify({ stationary: true }) },
          );
          await loadDevices();
          toast("Calibration saved; RMS window restarted");
        });
      }
      if (b.dataset.resetCalibration)
        task(async () => {
          await api(
            "/devices/" +
              encodeURIComponent(b.dataset.resetCalibration) +
              "/calibration",
            { method: "DELETE" },
          );
          await loadDevices();
          toast("Calibration reset");
        });
    });
    select("#spectrumForm").onsubmit = analyzeSpectrum;
    select("#downloadPdfReport").onclick = () => task(downloadPDF);
    select("#createUserForm").onsubmit = (e) => {
      e.preventDefault();
      adminTask(async () => {
        await api("/auth/users", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
        });
        e.target.reset();
        await loadAdminPanels();
        toast("Account created");
      });
    };
    select("#changePasswordForm").onsubmit = (e) => {
      e.preventDefault();
      task(async () => {
        await api("/auth/password", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
        });
        e.target.reset();
        state.user = null;
        state.csrf = "";
        state.token = "";
        sessionUI();
        toast("Password changed. Sign in again.");
        window.location.reload();
      });
    };
    select("#notificationForm").onsubmit = (e) => {
      e.preventDefault();
      adminTask(async () => {
        const f = e.target,
          b = {
            recipient: f.elements.recipient.value,
            cooldownSeconds: Number(f.elements.cooldownSeconds.value),
          };
        for (const k of ["enabled", "critical", "offline", "warning"])
          b[k] = f.elements[k].checked;
        await api("/notifications", { method: "PUT", body: JSON.stringify(b) });
        await loadAdminPanels();
        toast("Email preferences saved");
      });
    };
    select("#verifySmtp").onclick = () =>
      adminTask(async () => {
        await api("/notifications/verify", { method: "POST" });
        toast("SMTP connection verified; no email was sent");
      });
    select("#startGuidedDemo").onclick = () =>
      adminTask(async () =>
        demoStatus(await api("/demo/start", { method: "POST" })),
      );
    select("#stopGuidedDemo").onclick = () =>
      adminTask(async () =>
        demoStatus(await api("/demo/stop", { method: "POST" })),
      );
    select("#closePlayback").onclick = () => select("#playbackDialog").close();
    select("#playbackDialog").addEventListener("close", stopPlayback);
    select("#playbackPosition").oninput = () => {
      stopPlayback();
      replayIndex = Number(select("#playbackPosition").value);
      drawPlayback();
    };
    select("#playPlayback").onclick = () => {
      if (replayTimer) return stopPlayback();
      if (replayIndex >= replayRows.length - 1) replayIndex = 0;
      replayTime = +new Date(replayRows[replayIndex].timestamp);
      let last = performance.now();
      select("#playPlayback").textContent = "Pause";
      replayTimer = setInterval(() => {
        const now = performance.now();
        replayTime += (now - last) * Number(select("#playbackSpeed").value);
        last = now;
        while (
          replayIndex < replayRows.length - 1 &&
          +new Date(replayRows[replayIndex + 1].timestamp) <= replayTime
        )
          replayIndex++;
        drawPlayback();
        if (replayIndex >= replayRows.length - 1) stopPlayback();
      }, 150);
    };
    const originalError = showError;
    showError = function (error) {
      originalError(error);
      if (select("#authDialog").open)
        select("#accountError").textContent = error.message;
    };
    await loadSession();
    devicesUpdated();
    demoStatus(await api("/demo/status"));
    navigated(state.view);
    setInterval(() => {
      if (demo?.state === "running") demoStatus(demo);
    }, 1000);
  }
  return { init, devicesUpdated, navigated, demoStatus, selectDevice };
})();
