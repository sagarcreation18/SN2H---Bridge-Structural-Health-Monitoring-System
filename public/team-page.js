// Animation behavior adapted from the supplied template. Loaded only for Our Team.
let cleanup = null,
  mountedRoot = null,
  userPaused = false;
export function deactivate() {
  cleanup?.();
  cleanup = null;
  mountedRoot = null;
}
export function activate(root, members) {
  if (mountedRoot === root && cleanup) return;
  deactivate();
  mountedRoot = root;
  const events = new AbortController(),
    signal = events.signal;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
    fine = matchMedia("(hover:hover) and (pointer:fine)");
  const frames = new Set(),
    resets = [],
    revealEls = [...root.querySelectorAll(".reveal")];
  const previousTitle = document.title;
  document.title = "Meet Our Team — SN²H.";
  root.dataset.teamActive = String(!document.hidden);
  root.dataset.teamPaused = String(userPaused);
  root.removeAttribute("aria-busy");
  const paused = () => userPaused || reduced.matches || document.hidden;
  function schedule(fn) {
    const frame = requestAnimationFrame(() => {
      frames.delete(frame);
      fn();
    });
    frames.add(frame);
    return frame;
  }
  const progress = root.querySelector("#sn2h-scrollProgress");
  let progressFrame = null;
  function updateProgress() {
    progressFrame = null;
    const rect = root.getBoundingClientRect(),
      travel = Math.max(1, root.offsetHeight - innerHeight);
    progress.style.transform = `scaleX(${Math.max(0, Math.min(1, -rect.top / travel))})`;
  }
  const onScroll = () => {
    if (progressFrame === null) progressFrame = schedule(updateProgress);
  };
  window.addEventListener("scroll", onScroll, { passive: true, signal });
  window.addEventListener("resize", onScroll, { passive: true, signal });
  updateProgress();
  let observer = null;
  function reveal() {
    observer?.disconnect();
    if (reduced.matches || !("IntersectionObserver" in window)) {
      revealEls.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08, rootMargin: "0px 0px 30px 0px" },
    );
    revealEls.forEach((el) => observer.observe(el));
  }
  reveal();
  const cards = [...root.querySelectorAll(".member")];
  for (const [index, card] of cards.entries()) {
    const member = members[index],
      front = card.querySelector(".face-front"),
      back = card.querySelector(".face-back"),
      open = card.querySelector(".flip-open"),
      close = card.querySelector(".flip-close");
    front.id = `sn2h-member-${index + 1}-front`;
    back.id = `sn2h-member-${index + 1}-details`;
    card.setAttribute(
      "aria-label",
      `${member.name}${member.knownAs ? " (" + member.knownAs + ")" : ""} profile card`,
    );
    card.querySelector(".avatar").textContent = member.initial;
    // Names remain text nodes; configuration cannot inject markup.
    card.querySelector(".card-details h3").textContent = member.name;
    card.querySelector(".back-top h3").textContent = member.name;
    let alias = card.querySelector(".team-member-alias");
    if (!alias) {
      alias = document.createElement("p");
      alias.className = "team-member-alias";
      card.querySelector(".card-details h3").after(alias);
    }
    alias.textContent = member.knownAs ? `(${member.knownAs})` : "";
    alias.hidden = !member.knownAs;
    let batch = card.querySelector(".team-batch");
    if (!batch) {
      batch = document.createElement("div");
      batch.className = "back-item team-batch";
      const label = document.createElement("span");
      label.className = "team-meta-label";
      label.textContent = "BATCH";
      const value = document.createElement("span");
      value.textContent = "2023–2027";
      batch.append(label, value);
      card.querySelector(".back-list").append(batch);
    }
    const portrait = card.querySelector(".portrait");
    if (member.photo && !portrait.querySelector(".team-member-photo")) {
      const image = document.createElement("img");
      image.className = "team-member-photo";
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 300;
      image.height = 260;
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = member.photo;
      portrait.append(image);
    }
    open.setAttribute("aria-controls", back.id);
    open.setAttribute("aria-label", "More about " + member.name);
    function flip(value, focus = true) {
      card.classList.toggle("flipped", value);
      open.setAttribute("aria-pressed", String(value));
      open.setAttribute("aria-expanded", String(value));
      front.setAttribute("aria-hidden", String(value));
      back.setAttribute("aria-hidden", String(!value));
      front.inert = value;
      back.inert = !value;
      open.tabIndex = value ? -1 : 0;
      close.tabIndex = value ? 0 : -1;
      if (focus) (value ? close : open).focus({ preventScroll: true });
    }
    flip(false, false);
    open.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        flip(true);
      },
      { signal },
    );
    close.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        flip(false);
      },
      { signal },
    );
    card.addEventListener(
      "click",
      (event) => {
        if (!event.target.closest("button,a"))
          flip(!card.classList.contains("flipped"), false);
      },
      { signal },
    );
    card.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && card.classList.contains("flipped")) {
          event.preventDefault();
          flip(false);
        }
      },
      { signal },
    );
    let pointerFrame = null,
      lastPointer = null;
    const reset = () => {
      lastPointer = null;
      if (pointerFrame !== null) {
        cancelAnimationFrame(pointerFrame);
        frames.delete(pointerFrame);
        pointerFrame = null;
      }
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    };
    resets.push(reset);
    card.addEventListener(
      "pointermove",
      (event) => {
        if (paused() || !fine.matches || event.pointerType === "touch") return;
        lastPointer = { x: event.clientX, y: event.clientY };
        if (pointerFrame !== null) return;
        pointerFrame = schedule(() => {
          pointerFrame = null;
          if (!lastPointer || paused()) return;
          const r = card.getBoundingClientRect(),
            x = (lastPointer.x - r.left) / r.width,
            y = (lastPointer.y - r.top) / r.height;
          card.style.setProperty("--rx", ((0.5 - y) * 13).toFixed(2) + "deg");
          card.style.setProperty("--ry", ((x - 0.5) * 15).toFixed(2) + "deg");
          card.style.setProperty("--px", (x * 100).toFixed(1) + "%");
          card.style.setProperty("--py", (y * 100).toFixed(1) + "%");
        });
      },
      { passive: true, signal },
    );
    card.addEventListener("pointerleave", reset, { signal });
  }
  const stage = root.querySelector("#sn2h-heroStage"),
    core = root.querySelector("#sn2h-heroCore");
  let heroFrame = null,
    heroPointer = null;
  function resetHero() {
    heroPointer = null;
    if (heroFrame !== null) {
      cancelAnimationFrame(heroFrame);
      frames.delete(heroFrame);
      heroFrame = null;
    }
    core.style.setProperty("--mx", "0px");
    core.style.setProperty("--my", "0px");
  }
  resets.push(resetHero);
  stage.addEventListener(
    "pointermove",
    (event) => {
      if (paused() || !fine.matches || event.pointerType === "touch") return;
      heroPointer = { x: event.clientX, y: event.clientY };
      if (heroFrame !== null) return;
      heroFrame = schedule(() => {
        heroFrame = null;
        if (!heroPointer || paused()) return;
        const r = stage.getBoundingClientRect();
        core.style.setProperty(
          "--mx",
          (((heroPointer.x - r.left) / r.width) * 23 - 11.5).toFixed(1) + "px",
        );
        core.style.setProperty(
          "--my",
          (((heroPointer.y - r.top) / r.height) * 17 - 8.5).toFixed(1) + "px",
        );
      });
    },
    { passive: true, signal },
  );
  stage.addEventListener("pointerleave", resetHero, { signal });
  const pause = root.querySelector("#sn2h-pauseMotion");
  function updatePause() {
    root.dataset.teamPaused = String(userPaused);
    pause.setAttribute("aria-pressed", String(userPaused));
    pause.textContent = userPaused ? "Resume animations" : "Pause animations";
    if (paused()) resets.forEach((reset) => reset());
  }
  pause.addEventListener(
    "click",
    () => {
      userPaused = !userPaused;
      updatePause();
    },
    { signal },
  );
  updatePause();
  reduced.addEventListener(
    "change",
    () => {
      reveal();
      updatePause();
    },
    { signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      root.dataset.teamActive = String(!document.hidden);
      if (document.hidden) resets.forEach((reset) => reset());
    },
    { signal },
  );
  root.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a[data-team-target]");
      if (!link) return;
      const target = root.querySelector(
        "#" + CSS.escape(link.dataset.teamTarget),
      );
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({
        behavior: paused() ? "instant" : "smooth",
        block: "start",
      });
      root
        .querySelectorAll(".team-subnav [data-team-target]")
        .forEach((item) => {
          if (item === link) item.setAttribute("aria-current", "location");
          else item.removeAttribute("aria-current");
        });
    },
    { signal },
  );
  cleanup = () => {
    events.abort();
    observer?.disconnect();
    for (const frame of frames) cancelAnimationFrame(frame);
    frames.clear();
    resets.forEach((reset) => reset());
    root.dataset.teamActive = "false";
    document.title = previousTitle;
  };
}
