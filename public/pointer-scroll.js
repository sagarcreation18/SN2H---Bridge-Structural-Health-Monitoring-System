"use strict";
(() => {
  const progress = document.createElement("div");
  progress.id = "pageScrollProgress";
  progress.setAttribute("aria-hidden", "true");
  document.body.append(progress);
  let scrollFrame = 0;
  function updateScroll() {
    scrollFrame = 0;
    const root = document.scrollingElement || document.documentElement;
    const total = root.scrollHeight - root.clientHeight;
    progress.style.transform = `scaleX(${total > 0 ? Math.max(0, Math.min(1, root.scrollTop / total)) : 0})`;
  }
  function scheduleScroll() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  }
  addEventListener("scroll", scheduleScroll, { passive: true });
  addEventListener("resize", scheduleScroll, { passive: true });
  addEventListener("hashchange", scheduleScroll);
  if (typeof ResizeObserver === "function")
    new ResizeObserver(scheduleScroll).observe(document.body);
  updateScroll();

})();
