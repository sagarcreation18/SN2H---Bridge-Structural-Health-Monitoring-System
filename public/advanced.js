"use strict";
window.SN2HAdvanced = (() => {
  let ready = false,
    trendChart = null,
    inspectionRows = [],
    auditPage = 1;
  const el = (s) => document.querySelector(s),
    add = (s, v) => el(s).insertAdjacentHTML("beforeend", v);
  const admin = (fn) => {
    if (needsAdmin()) task(fn);
  };
  const result = (s, value) => {
    el(s).textContent = value;
  };
  const values = (f) => Object.fromEntries(new FormData(f));
  function build() {
    add(
      "#maintenanceContent",
      `<form id="inspectionForm" class="form-card advanced-grid"><h3>Inspection record</h3><input name="id" type="hidden"><label>Bridge<select name="bridge_id" id="inspectionBridge"></select></label><label>Title<input name="title" maxlength="160" required></label><label>Responsible person<input name="responsible" maxlength="120" required></label><label>Status<select name="status"><option value="open">Open</option><option value="in-progress">In progress</option><option value="completed">Completed</option></select></label><label>Inspection time<input name="inspected_at" type="datetime-local" required></label><label>Next inspection<input name="next_inspection" type="date"></label><label class="wide">Findings, damage and repair notes<textarea name="notes" rows="4" maxlength="10000" required></textarea></label><div class="button-row wide"><button class="button dark">Save record</button><button type="button" id="clearInspection" class="button">New record</button></div></form><p id="maintenanceAccess" class="fineprint"></p><div id="inspectionRecords" class="advanced-list"></div>`,
    );
    add(
      "#view-devices",
      `<section class="feature-section"><h3>Sensor diagnostics & remote readings</h3><form id="diagnosticsForm" class="filters"><label>Device<select id="diagnosticsDevice"></select></label><button class="button">Refresh diagnostics</button><button type="button" id="rotateCredential" class="button">Rotate device credential</button></form><div id="diagnosticsResult" class="notice" role="status">Select a device to check.</div><p id="credentialResult" class="credential-result" hidden></p><div class="table-wrap" id="remoteReadings"></div><p class="fineprint">Fault indicators suggest checks; a stationary sensor may produce identical values. Temperature and tilt appear only when supplied by a compatible device. Delayed uploads are archived separately and cannot activate the live alarm.</p></section>`,
    );
    add(
      "#view-analytics",
      `<section class="feature-section"><h3>Baseline & 30-day trends</h3><form id="baselineForm" class="advanced-grid"><label>Device<select id="baselineDevice"></select></label><label>Baseline name<input name="label" maxlength="100" required></label><label>From<input name="from" type="datetime-local" required></label><label>To<input name="to" type="datetime-local" required></label><div class="button-row wide"><button class="button">Save normal baseline</button><button type="button" id="refreshBaseline" class="button">Compare & refresh trends</button></div></form><p class="fineprint">A baseline needs 100 normal samples and no warning/critical samples. Comparison uses the latest 100 samples from the same device; it is descriptive, not a prediction of structural safety.</p><p id="baselineComparison" role="status"></p><div class="chart-wrap"><canvas id="trendChart" aria-label="Daily mean and maximum RMS over the last 30 days" role="img"></canvas></div><div id="baselineList"></div></section>`,
    );
    add(
      "#view-alerts",
      `<section class="feature-section"><h3>Response notes</h3><form id="alertNoteForm" class="filters"><label>Alert ID<input name="alert_id" type="number" min="1" step="1" required></label><label>Response or inspection note<input name="note" maxlength="1000" required></label><button class="button">Save note</button><button type="button" id="loadAlertNotes" class="button">Read notes</button></form><div id="alertNotes"></div></section>`,
    );
    add(
      "#view-settings",
      `<section class="feature-section"><h3>Unacknowledged critical alert escalation</h3><form id="escalationForm" class="advanced-grid"><label><input name="enabled" type="checkbox"> Enable escalation</label><label>Backup recipient<input name="recipient" type="email" maxlength="254"></label><label>Wait in minutes<input name="delayMinutes" type="number" min="1" max="1440" value="10" required></label><button class="button">Save escalation</button></form><p class="fineprint">Requires SMTP configuration. Existing unacknowledged critical alerts become eligible when enabled. Acknowledgment cancels queued delivery; an already sent email cannot be recalled.</p><div id="escalationHistory"></div></section><section class="feature-section"><h3>Phone notifications</h3><p>Subscribe this browser for new critical and offline alerts. HTTPS, server VAPID keys, account sign-in and browser permission are required. On iPhone/iPad, use a supported browser and add the app to your Home Screen where required.</p><div class="button-row"><button id="enablePhonePush" class="button">Enable on this device</button><button id="disablePhonePush" class="button">Disable on this device</button></div><p id="pushStatus" role="status"></p></section><section class="feature-section"><h3>Remote connection</h3><div id="remoteConnection"></div><p class="fineprint">For phone access over Wi-Fi, start with HOST=0.0.0.0 and allow port 3100 on your private network. Outside-city sensors require an always-on HTTPS server or a secure gateway. A SIM/4G router can provide Wi-Fi to the ESP32.</p></section><section class="feature-section"><h3>Administration history</h3><p class="fineprint">Records account and configuration requests without saving passwords or tokens.</p><div id="auditHistory"></div><div class="button-row"><button id="auditPrevious" class="button">Previous</button><span id="auditPage"></span><button id="auditNext" class="button">Next</button></div></section>`,
    );
    for (const [value, label] of [
      ["vehicle", "Vehicle crossing"],
      ["sensor_fault", "Sensor fault / stuck values"],
      ["connection_loss", "Connection loss / no readings"],
    ])
      el("#scenario").add(new Option(label, value));
  }
  function table(headers, rows) {
    return `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function devices() {
    for (const selector of ["#diagnosticsDevice", "#baselineDevice"]) {
      const s = el(selector),
        old = s.value;
      s.replaceChildren(
        ...state.devices.map(
          (d) => new Option(`${d.name} / ${d.source}`, d.id),
        ),
      );
      if ([...s.options].some((o) => o.value === old)) s.value = old;
    }
  }
  async function maintenance() {
    const [rows, bridges] = await Promise.all([
      api("/inspections"),
      api("/bridges"),
    ]);
    inspectionRows = rows;
    el("#inspectionBridge").replaceChildren(
      ...bridges.map((b) => new Option(b.name, b.id)),
    );
    el("#inspectionForm").hidden = !isAdmin();
    result(
      "#maintenanceAccess",
      isAdmin()
        ? "Select Edit to update a record or upload evidence."
        : "Sign in as an administrator to add inspections or photos.",
    );
    el("#inspectionRecords").innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<article class="form-card"><div class="eyebrow">${escape(r.bridge_name)} / ${escape(r.status)}</div><h3>${escape(r.title)}</h3><p class="preserve-lines">${escape(r.notes)}</p><p>${escape(r.responsible)} · ${escape(date(r.inspected_at))}</p><p>Next inspection: ${escape(r.next_inspection ? String(r.next_inspection).slice(0, 10) : "Not scheduled")}</p><div class="button-row">${isAdmin() ? `<button class="button" data-edit-inspection="${r.id}">Edit</button><label class="button">Add photo<input class="photo-input" data-photo-inspection="${r.id}" type="file" accept="image/png,image/jpeg"></label>` : ""}<button class="button" data-inspection-photos="${r.id}">View photos (${r.photos})</button></div><div id="inspectionPhotos${r.id}" class="inspection-photos"></div></article>`,
          )
          .join("")
      : "<p>No inspections recorded yet.</p>";
  }
  async function diagnostics() {
    const id = el("#diagnosticsDevice").value;
    if (!id) return;
    const [d, history] = await Promise.all([
      api(`/devices/${encodeURIComponent(id)}/diagnostics`),
      api(`/devices/${encodeURIComponent(id)}/remote-history`),
    ]);
    result(
      "#diagnosticsResult",
      `${d.source.toUpperCase()} / ${d.enabled ? "Enabled" : "Disabled"} · ${d.samples} checked samples. ${d.faults.length ? d.faults.map((f) => f.message).join(" · ") : d.sufficient ? "No listed fault indicators detected." : "Collect at least 50 samples for pattern checks."} ${d.environment ? ` Latest measured: ${date(d.environment.measured_at)} (${d.environment.disposition}). Temperature ${fmt(d.environment.temperature, 1)} °C; tilt X ${fmt(d.environment.tilt_x, 1)}°, Y ${fmt(d.environment.tilt_y, 1)}°.` : ""}`,
    );
    el("#remoteReadings").innerHTML = history.length
      ? table(
          [
            "Measured",
            "Received",
            "Sequence",
            "Disposition",
            "Temp °C",
            "Tilt X / Y °",
          ],
          history
            .slice(0, 50)
            .map((r) => [
              date(r.measured_at),
              date(r.received_at),
              `${r.boot_id} / ${r.sequence_no}`,
              r.disposition,
              fmt(r.temperature, 1),
              `${fmt(r.tilt_x, 1)} / ${fmt(r.tilt_y, 1)}`,
            ]),
        )
      : "<p>No timestamped remote uploads yet.</p>";
  }
  async function baseline() {
    const id = el("#baselineDevice").value;
    if (!id) return;
    const [b, trend] = await Promise.all([
      api(`/devices/${encodeURIComponent(id)}/baselines`),
      api(`/devices/${encodeURIComponent(id)}/trends`),
    ]);
    result(
      "#baselineComparison",
      b.comparison
        ? `Baseline ${fmt(b.comparison.baseline, 4)} g → latest mean ${fmt(b.current, 4)} g. Change ${fmt(b.comparison.delta, 4)} g; ratio ${b.comparison.ratio === null ? "unavailable near zero" : fmt(b.comparison.ratio, 2) + "×"}.`
        : "Save a baseline to compare with recent measurements.",
    );
    el("#baselineList").innerHTML = table(
      ["Baseline", "Samples", "Mean RMS", "Created"],
      b.rows.map((r) => [
        r.label,
        r.sample_count,
        fmt(r.mean_rms, 4) + " g",
        date(r.created_at),
      ]),
    );
    trendChart?.destroy();
    trendChart = new Chart(el("#trendChart"), {
      type: "line",
      data: {
        labels: trend.map((r) => String(r.day).slice(0, 10)),
        datasets: [
          {
            label: "Daily mean RMS (g)",
            data: trend.map((r) => r.mean_rms),
            borderColor: "#1c1c1c",
            tension: 0,
          },
          {
            label: "Daily max RMS (g)",
            data: trend.map((r) => r.max_rms),
            borderColor: "#a14732",
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }
  async function audit() {
    if (!isAdmin()) {
      result("#auditHistory", "Administrator access required.");
      result("#escalationHistory", "Administrator access required.");
      return;
    }
    const [a, e] = await Promise.all([
      api("/audit?page=" + auditPage),
      api("/escalation"),
    ]);
    el("#auditHistory").innerHTML = table(
      ["Time", "Account", "Action", "Resource", "Result"],
      a.rows.map((r) => [
        date(r.created_at),
        r.actor,
        r.action,
        r.resource,
        r.status_code,
      ]),
    );
    result(
      "#auditPage",
      `Page ${a.page} / ${Math.max(1, Math.ceil(a.total / 50))}`,
    );
    el("#auditPrevious").disabled = auditPage <= 1;
    el("#auditNext").disabled = auditPage * 50 >= a.total;
    const f = el("#escalationForm");
    f.elements.enabled.checked = e.config.enabled;
    f.elements.recipient.value = e.config.recipient;
    f.elements.delayMinutes.value = e.config.delayMinutes;
    el("#escalationHistory").innerHTML = table(
      ["Alert", "Recipient", "Status", "Attempts"],
      e.deliveries.map((d) => [d.alert_id, d.recipient, d.state, d.attempts]),
    );
  }
  async function settings() {
    el("#escalationForm").hidden = !isAdmin();
    await audit();
    const s = await api("/remote/status");
    el("#remoteConnection").innerHTML =
      `<p>Listening interface: <strong>${escape(s.host)}</strong>. Public URL: ${escape(s.publicUrl || "Not configured")}. Per-device credentials: rotate in Devices. Shared credential fallback: ${s.legacyDeviceToken ? "enabled" : "disabled"}.</p>${s.host === "0.0.0.0" ? s.localAddresses.map((v) => `<p>Local phone address: <a href="${escape(v)}">${escape(v)}</a></p>`).join("") : "<p>Localhost-only mode is active; phone access needs HOST=0.0.0.0.</p>"}`;
    result(
      "#pushStatus",
      s.pushConfigured
        ? "Server push keys configured. Enable this browser to subscribe."
        : "Phone notifications are implemented; server VAPID keys and HTTPS are not configured yet.",
    );
  }
  async function enablePush() {
    if (!state.user) throw new Error("Sign in with an account first.");
    if (
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    )
      throw new Error("This browser needs HTTPS and Web Push support.");
    const config = await api("/push/config");
    if (!config.configured)
      throw new Error("Configure VAPID keys on the server first.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted")
      throw new Error("Notification permission was not granted.");
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(
      atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const sub =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));
    await api("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub.toJSON()),
    });
    result(
      "#pushStatus",
      "Subscribed on this device for new critical and offline alerts.",
    );
  }
  async function disablePush() {
    if (!state.user)
      throw new Error("Sign in with the subscribed account first.");
    if (!("serviceWorker" in navigator))
      throw new Error("Service workers are unavailable in this browser.");
    const registration = await navigator.serviceWorker.getRegistration("/"),
      sub = await registration?.pushManager.getSubscription();
    if (sub) {
      await api("/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    result("#pushStatus", "Notifications disabled for this browser.");
  }
  async function notes() {
    const id = el("#alertNoteForm").elements.alert_id.value;
    if (!id) return;
    const rows = await api(`/alerts/${encodeURIComponent(id)}/notes`);
    el("#alertNotes").innerHTML = table(
      ["Time", "Account", "Response"],
      rows.map((r) => [date(r.created_at), r.actor, r.note]),
    );
  }
  function resetInspection() {
    el("#inspectionForm").reset();
    el("#inspectionForm").elements.id.value = "";
    el("#inspectionForm").elements.inspected_at.value = localDate(new Date());
  }
  function localDate(date) {
    return new Date(+date - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  function navigated(view) {
    if (!ready) return;
    devices();
    if (view === "maintenance") task(maintenance);
    if (view === "settings") task(settings);
    if (view === "devices") task(diagnostics);
    if (view === "analytics") task(baseline);
  }
  async function init() {
    build();
    ready = true;
    devices();
    resetInspection();
    const now = new Date();
    el("#baselineForm").elements.to.value = localDate(now);
    el("#baselineForm").elements.from.value = localDate(
      new Date(+now - 3600000),
    );
    el("#inspectionForm").onsubmit = (e) => {
      e.preventDefault();
      admin(async () => {
        const b = values(e.target),
          id = b.id;
        delete b.id;
        b.bridge_id = Number(b.bridge_id);
        b.inspected_at = new Date(b.inspected_at).toISOString();
        await api("/inspections" + (id ? "/" + id : ""), {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify(b),
        });
        resetInspection();
        await maintenance();
        toast("Inspection saved");
      });
    };
    el("#clearInspection").onclick = resetInspection;
    el("#inspectionRecords").onclick = (e) =>
      task(async () => {
        const edit = e.target.closest("[data-edit-inspection]"),
          photos = e.target.closest("[data-inspection-photos]");
        if (edit) {
          const r = inspectionRows.find(
              (v) => String(v.id) === edit.dataset.editInspection,
            ),
            f = el("#inspectionForm");
          for (const k of [
            "id",
            "bridge_id",
            "title",
            "notes",
            "responsible",
            "status",
          ])
            f.elements[k].value = r[k];
          f.elements.inspected_at.value = localDate(new Date(r.inspected_at));
          f.elements.next_inspection.value = r.next_inspection
            ? String(r.next_inspection).slice(0, 10)
            : "";
          f.scrollIntoView({ block: "start" });
        }
        if (photos) {
          const id = photos.dataset.inspectionPhotos,
            rows = await api(`/inspections/${id}/photos`);
          el("#inspectionPhotos" + id).innerHTML =
            rows
              .map(
                (r) =>
                  `<a href="/api/inspection-photos/${r.id}" target="_blank" rel="noopener"><img src="/api/inspection-photos/${r.id}" alt="Inspection evidence ${r.id}" loading="lazy"></a>`,
              )
              .join("") || "<p>No evidence photos uploaded.</p>";
        }
      });
    el("#inspectionRecords").onchange = (e) => {
      if (e.target.dataset.photoInspection)
        admin(async () => {
          const file = e.target.files[0];
          if (!file) return;
          if (
            file.size > 2 * 1024 * 1024 ||
            !["image/jpeg", "image/png"].includes(file.type)
          )
            throw new Error("Choose a JPEG or PNG up to 2 MB.");
          await api(`/inspections/${e.target.dataset.photoInspection}/photos`, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          await maintenance();
          toast("Photo uploaded");
        });
    };
    el("#diagnosticsForm").onsubmit = (e) => {
      e.preventDefault();
      task(diagnostics);
    };
    el("#rotateCredential").onclick = () =>
      admin(async () => {
        const id = el("#diagnosticsDevice").value;
        if (
          !confirm(
            "Rotate this device credential? Its previous credential will stop working.",
          )
        )
          return;
        const r = await api(`/devices/${encodeURIComponent(id)}/credential`, {
          method: "POST",
        });
        el("#credentialResult").hidden = false;
        result(
          "#credentialResult",
          `${r.device_id}: ${r.token} — copy into the device configuration now; shown once.`,
        );
      });
    el("#diagnosticsDevice").onchange = () => {
      el("#credentialResult").hidden = true;
      result("#credentialResult", "");
      task(diagnostics);
    };
    el("#baselineForm").onsubmit = (e) => {
      e.preventDefault();
      admin(async () => {
        const b = values(e.target);
        b.from = new Date(b.from).toISOString();
        b.to = new Date(b.to).toISOString();
        await api(
          `/devices/${encodeURIComponent(el("#baselineDevice").value)}/baselines`,
          { method: "POST", body: JSON.stringify(b) },
        );
        await baseline();
        toast("Baseline saved");
      });
    };
    el("#refreshBaseline").onclick = () => task(baseline);
    el("#baselineDevice").onchange = () => task(baseline);
    el("#alertNoteForm").onsubmit = (e) => {
      e.preventDefault();
      admin(async () => {
        const b = values(e.target);
        await api(`/alerts/${encodeURIComponent(b.alert_id)}/notes`, {
          method: "POST",
          body: JSON.stringify({ note: b.note }),
        });
        e.target.elements.note.value = "";
        await notes();
      });
    };
    el("#loadAlertNotes").onclick = () => task(notes);
    el("#escalationForm").onsubmit = (e) => {
      e.preventDefault();
      admin(async () => {
        const f = e.target;
        await api("/escalation", {
          method: "PUT",
          body: JSON.stringify({
            enabled: f.elements.enabled.checked,
            recipient: f.elements.recipient.value,
            delayMinutes: Number(f.elements.delayMinutes.value),
          }),
        });
        await audit();
        toast("Escalation settings saved");
      });
    };
    el("#auditPrevious").onclick = () => {
      auditPage = Math.max(1, auditPage - 1);
      task(audit);
    };
    el("#auditNext").onclick = () => {
      auditPage++;
      task(audit);
    };
    el("#enablePhonePush").onclick = () => task(enablePush);
    el("#disablePhonePush").onclick = () => task(disablePush);
    window.addEventListener("sn2h:account", () => {
      el("#credentialResult").hidden = true;
      result("#credentialResult", "");
      navigated(state.view);
    });
    navigated(state.view);
  }
  return {
    init,
    navigated,
    devicesUpdated: () => {
      if (ready) devices();
    },
  };
})();
