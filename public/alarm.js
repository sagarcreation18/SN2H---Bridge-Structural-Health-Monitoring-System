"use strict";
// Presentation alarm only. Sensor processing and persisted alerts remain on the server.
(() => {
  let reading = null,
    settings = {},
    stream = false,
    previewUntil = 0;
  let context,
    soundEnabled = false,
    muted = false,
    active = false,
    lastTone = 0;
  let previousPreference,
    lastMode = "";
  const voices = new Set();
  const $ = (id) => document.getElementById(id);
  async function armAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) {
      $("alarmAudioStatus").textContent =
        "Audio is unavailable in this browser; visual alerts remain active.";
      return;
    }
    context ||= new Audio();
    try {
      await context.resume();
      soundEnabled = true;
      muted = false;
      lastTone = 0;
      render();
    } catch {
      $("alarmAudioStatus").textContent =
        "Audio was blocked. Click Enable alarm sound to try again.";
    }
  }
  function tone() {
    if (!context || context.state !== "running" || !soundEnabled || muted)
      return;
    const now = context.currentTime;
    for (let i = 0; i < 2; i++) {
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      const start = now + i * 0.72;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(i ? 1000 : 500, start);
      oscillator.frequency.linearRampToValueAtTime(
        i ? 500 : 1000,
        start + 0.64,
      );
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.035);
      gain.gain.setValueAtTime(0.06, start + 0.62);
      gain.gain.linearRampToValueAtTime(0, start + 0.7);
      oscillator.connect(gain);
      gain.connect(context.destination);
      voices.add(oscillator);
      oscillator.start(start);
      oscillator.stop(start + 0.72);
      oscillator.onended = () => {
        voices.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }
  function render() {
    const preview = Date.now() < previewUntil;
    const fresh =
      reading &&
      Date.now() - new Date(reading.timestamp).getTime() <
        (settings.offlineMs || 5000);
    const critical = Boolean(stream && fresh && reading.status === "critical");
    active = preview || critical;
    if (!active || muted || !soundEnabled) {
      for (const voice of voices) {
        try {
          voice.stop(context.currentTime);
        } catch {
          /* Already ended. */
        }
      }
      voices.clear();
    }
    const mode = preview ? "preview" : critical ? "critical" : "normal";
    document.body.classList.toggle("critical-mode", active);
    $("criticalAlarm").hidden = !active;
    $("endAlarmPreview").hidden = !preview;
    if (mode !== lastMode) {
      $("criticalAlarmTitle").textContent = preview
        ? "PREVIEW — CRITICAL ALARM DEMONSTRATION"
        : "CRITICAL VIBRATION — DEMONSTRATION THRESHOLD";
      if (active) lastTone = 0;
      lastMode = mode;
    }
    $("criticalAlarmDetail").textContent = preview
      ? `Test only · returns to live monitoring in ${Math.ceil((previewUntil - Date.now()) / 1000)} seconds. No sensor data is changed.`
      : `${(reading?.source || "simulation").toUpperCase()} / ${reading?.device_id || "sensor"} · RMS ${Number(reading?.rms || 0).toFixed(3)} g · check the Alerts page. This is not a certified structural safety alarm.`;
    $("muteCriticalAlarm").textContent =
      muted || !soundEnabled ? "Enable sound" : "Mute sound";
    $("alarmAudioStatus").textContent =
      soundEnabled && !muted
        ? "Alarm sound enabled for this tab. It repeats during a fresh critical condition."
        : "Alarm sound is muted or not enabled. Visual alerts still work; click Enable alarm sound to hear them.";
    $("enableAlarmSound").textContent =
      soundEnabled && !muted ? "Mute alarm sound" : "Enable alarm sound";
    if (active && Date.now() - lastTone >= 2200) {
      tone();
      lastTone = Date.now();
    }
  }
  window.SN2HAlarm = {
    sync(nextReading, nextSettings, connected) {
      reading = nextReading;
      settings = nextSettings;
      stream = connected;
      if (previousPreference !== settings.sound) {
        if (previousPreference !== undefined) {
          soundEnabled = Boolean(settings.sound);
          muted = !settings.sound;
        }
        previousPreference = settings.sound;
      }
      render();
    },
  };
  $("previewCriticalAlarm").onclick = () => {
    previewUntil = Date.now() + 20000;
    armAudio();
    render();
  };
  $("endAlarmPreview").onclick = () => {
    previewUntil = 0;
    render();
  };
  $("muteCriticalAlarm").onclick = () => {
    if (!soundEnabled || muted) armAudio();
    else {
      muted = true;
      render();
    }
  };
  $("enableAlarmSound").onclick = () => {
    if (soundEnabled && !muted) {
      muted = true;
      render();
    } else armAudio();
  };
  // A saved sound preference can arm audio only after a real browser gesture.
  document.addEventListener("pointerdown", () => {
    if (settings.sound && !context) armAudio();
  });
  if (new URLSearchParams(location.search).get("alarmPreview") === "1") {
    previewUntil = Date.now() + 20000;
  }
  render();
  setInterval(render, 250);
})();
