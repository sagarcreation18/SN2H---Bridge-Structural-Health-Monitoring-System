"use strict";
// Motion is presentation only: values and alarm decisions always use the real samples.
window.SN2HMotion = (() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const seen = new WeakSet(),
    known = new Map(),
    animations = new Set(),
    deviceStates = new Map();
  const textSeen = new WeakSet();
  let textObserver = null;
  let paused = false,
    observer = null,
    pending = 0,
    loadingTimer = null,
    lastStatus = null,
    lastRms = null,
    lastAccent = 0,
    ready = false;
  try {
    paused = localStorage.getItem("sn2h-ui-motion") === "paused";
  } catch {}
  const allowed = () => !paused && !reduced.matches && !document.hidden;
  function animate(el, frames, options = {}) {
    if (!el || !allowed() || typeof el.animate !== "function") return;
    const a = el.animate(frames, {
      duration: 360,
      easing: "cubic-bezier(.22,1,.36,1)",
      ...options,
    });
    animations.add(a);
    const clear = () => animations.delete(a);
    a.addEventListener("finish", clear, { once: true });
    a.addEventListener("cancel", clear, { once: true });
  }
  function preferences() {
    document.documentElement.dataset.uiMotion = paused ? "paused" : "on";
    document.documentElement.dataset.uiVisibility = document.hidden
      ? "hidden"
      : "visible";
    const button = document.querySelector("#toggleDashboardMotion");
    if (button) {
      button.textContent = paused
        ? "Resume dashboard motion"
        : "Pause dashboard motion";
      button.setAttribute("aria-pressed", String(paused));
    }
    if (!allowed()) {
      for (const a of animations) a.cancel();
      animations.clear();
      document
        .querySelectorAll(".ui-reveal")
        .forEach((el) => el.classList.add("ui-revealed"));
    }
  }
  function reveal(root) {
    if (!root || root.id === "view-about") return;
    const targets = root.querySelectorAll(
      ":scope > .section-heading,:scope > .view-title,:scope > .hero-grid,:scope > .chart-card,:scope > .two-columns,:scope > .filters,:scope > .form-card,:scope > .feature-section,:scope > .notice",
    );
    let index = 0;
    for (const el of targets) {
      if (seen.has(el)) continue;
      seen.add(el);
      el.style.setProperty("--ui-delay", Math.min(index++, 5) * 35 + "ms");
      if (!observer || !allowed()) {
        el.classList.add("ui-revealed");
        continue;
      }
      el.classList.add("ui-reveal");
      observer.observe(el);
    }
  }
  function playText(el) {
    if (!allowed() || el.closest('[data-team-paused="true"]')) return;
    if (el.matches("h1,h2")) {
      let words = [...el.querySelectorAll(".ui-arrival-word")];
      if (!words.length) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          if (!node.textContent.trim()) continue;
          const fragment = document.createDocumentFragment();
          for (const token of node.textContent.split(/(\s+)/)) {
            if (!token) continue;
            if (/^\s+$/.test(token))
              fragment.append(document.createTextNode(token));
            else {
              const span = document.createElement("span");
              span.className = "ui-arrival-word";
              span.textContent = token;
              fragment.append(span);
            }
          }
          node.replaceWith(fragment);
        }
        words = [...el.querySelectorAll(".ui-arrival-word")];
      }
      words.slice(0, 16).forEach((word, index) =>
        animate(
          word,
          [
            { opacity: 0.12, transform: "translateY(.45em) rotateX(-14deg)" },
            { opacity: 1, transform: "translateY(0) rotateX(0deg)" },
          ],
          { duration: 650, delay: Math.min(index, 8) * 48 },
        ),
      );
    } else
      animate(
        el,
        [
          { opacity: 0.25, transform: "translateY(9px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 560, delay: 60 },
      );
  }
  function textArrival(root) {
    if (!ready || !root) return;
    const targets = root.querySelectorAll(
      "h1,h2,.section-heading > span,:scope > p,.feature-section > h3,.feature-section > p",
    );
    for (const el of targets) {
      if (textSeen.has(el) || el.closest(".metric,.member,#criticalAlarm"))
        continue;
      textSeen.add(el);
      if (!allowed()) continue;
      if (textObserver) textObserver.observe(el);
      else playText(el);
    }
  }
  function identity(el, parent) {
    const action = el.querySelector(
      "[data-replay],[data-edit-inspection],[data-device]",
    );
    if (action)
      return (
        action.dataset.replay ||
        action.dataset.editInspection ||
        action.dataset.device
      );
    return (
      el.querySelector("h3")?.textContent || el.textContent.trim().slice(0, 160)
    );
  }
  function changed(parent) {
    if (!ready || parent.closest(".view")?.hidden) return;
    const rows = [
      ...parent.querySelectorAll(
        ":scope > .form-card,:scope > article,tbody > tr",
      ),
    ];
    const keys = known.get(parent) || new Set();
    let count = 0;
    for (const el of rows) {
      const key = identity(el, parent);
      if (parent.id === "devices") {
        const badge = el.querySelector(".badge-state"),
          status = badge?.textContent;
        if (deviceStates.has(key) && deviceStates.get(key) !== status)
          animate(
            badge,
            [
              { opacity: 0.4, transform: "scale(.94)" },
              { opacity: 1, transform: "scale(1)" },
            ],
            { duration: 280 },
          );
        deviceStates.set(key, status);
      }
      if (keys.has(key)) continue;
      keys.add(key);
      if (count < 8)
        animate(
          el,
          [
            { opacity: 0.35, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 320, delay: count++ * 30 },
        );
    }
    if (keys.size > 1000) keys.clear();
    known.set(parent, keys);
    reveal(parent.closest(".view"));
  }
  function pageChanged(view) {
    if (!ready) return;
    const root = document.querySelector("#view-" + view);
    if (!root) return;
    textArrival(root);
    if (view === "overview")
      textArrival(document.querySelector("#projectIdentity"));
    if (view === "about") return;
    // Entry moves once per navigation, never once per sensor reading.
    animate(
      root,
      [
        { opacity: 0.55, transform: "translateY(9px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 300 },
    );
    reveal(root);
    root
      .querySelectorAll(
        "#devices,#alertsTable,#recentAlerts,#inspectionRecords",
      )
      .forEach(changed);
  }
  function metricsUpdated(reading, status) {
    if (!ready) return;
    const now = Date.now(),
      rms = reading?.rms;
    if (status !== lastStatus) {
      animate(
        document.querySelector("#healthBadge"),
        [
          { transform: "scale(.94)", opacity: 0.6 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 280 },
      );
      lastStatus = status;
    }
    if (
      typeof rms === "number" &&
      lastRms !== null &&
      Math.abs(rms - lastRms) >= 0.03 &&
      now - lastAccent > 1800
    ) {
      for (const s of ["#metrics", "#liveMetrics"]) {
        const group = document.querySelector(s);
        if (!group || group.closest(".view")?.hidden) continue;
        animate(
          group.children[4],
          [
            { boxShadow: "inset 0 -2px 0 rgba(164,120,94,.6)" },
            { boxShadow: "inset 0 -2px 0 rgba(164,120,94,0)" },
          ],
          { duration: 650 },
        );
      }
      lastAccent = now;
    }
    lastRms = rms;
  }
  function beginRequest() {
    pending++;
    if (!loadingTimer)
      loadingTimer = setTimeout(() => {
        loadingTimer = null;
        if (pending > 0)
          document
            .querySelector("#uiRequestActivity")
            ?.classList.add("is-loading");
      }, 180);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      pending = Math.max(0, pending - 1);
      if (!pending) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
        document
          .querySelector("#uiRequestActivity")
          ?.classList.remove("is-loading");
      }
    };
  }
  function chartReady(canvas) {
    animate(canvas, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 400 });
  }
  function init() {
    if (ready) return;
    ready = true;
    const strip = document.createElement("div");
    strip.id = "uiRequestActivity";
    strip.setAttribute("aria-hidden", "true");
    document.body.append(strip);
    if ("IntersectionObserver" in window)
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              entry.target.classList.add("ui-revealed");
              observer.unobserve(entry.target);
            }
        },
        { threshold: 0.04, rootMargin: "0px 0px 24px 0px" },
      );
    if ("IntersectionObserver" in window)
      textObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              textObserver.unobserve(entry.target);
              playText(entry.target);
            }
        },
        { threshold: 0.15 },
      );
    const settings = document.querySelector("#view-settings");
    const section = document.createElement("section");
    section.className = "feature-section";
    section.innerHTML =
      '<h3>Dashboard motion</h3><p class="fineprint">Subtle page entrances, update accents and interaction feedback. Live numbers stay exact. Your system’s reduced-motion preference takes priority. Bridge and Our Team animations retain their own pause controls; critical warnings remain active.</p><button id="toggleDashboardMotion" type="button" class="button" aria-pressed="false"></button>';
    settings.append(section);
    section.querySelector("button").addEventListener("click", () => {
      paused = !paused;
      try {
        localStorage.setItem("sn2h-ui-motion", paused ? "paused" : "on");
      } catch {}
      preferences();
    });
    for (const selector of [
      "#devices",
      "#alertsTable",
      "#recentAlerts",
      "#inspectionRecords",
      "#auditHistory",
      "#escalationHistory",
    ]) {
      const parent = document.querySelector(selector);
      if (!parent) continue;
      const watch = new MutationObserver(() => changed(parent));
      watch.observe(parent, { childList: true });
    }
    document.addEventListener("visibilitychange", preferences);
    reduced.addEventListener("change", preferences);
    document.addEventListener("click", (event) => {
      if (
        event.target
          .closest("#sn2h-pauseMotion")
          ?.getAttribute("aria-pressed") === "true"
      ) {
        for (const animation of animations)
          if (animation.effect?.target?.closest("#view-about"))
            animation.cancel();
      }
      const button = event.target.closest(".button");
      if (!button || button.disabled || button.closest("#view-about")) return;
      animate(
        button,
        [{ filter: "brightness(.9)" }, { filter: "brightness(1)" }],
        { duration: 180 },
      );
    });
    preferences();
    pageChanged(location.hash.slice(1) || "overview");
  }
  return {
    init,
    pageChanged,
    metricsUpdated,
    beginRequest,
    chartReady,
    textArrival,
  };
})();
