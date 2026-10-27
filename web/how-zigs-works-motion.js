// Motion lifecycle only. It does not access wallet state, storage or services.
export function guideMotion(root) {
  if (typeof MutationObserver !== "function" || typeof window === "undefined") return;
  const figures = new Set();
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.dataset.motionSuspended = String(!entry.isIntersecting);
  }, { threshold: 0 }) : null;
  const update = () => {
    for (const figure of figures) if (!root.contains(figure)) { observer?.unobserve(figure); figures.delete(figure); }
    root.querySelectorAll(".hw-figure,.hw-journey-figure").forEach(figure => {
      if (!figures.has(figure)) { figures.add(figure); observer?.observe(figure); }
    });
  };
  const visibility = () => { root.dataset.documentHidden = String(document.hidden); };
  document.addEventListener("visibilitychange", visibility);
  const changes = new MutationObserver(update);
  changes.observe(root, { childList: true, subtree: true });
  visibility(); update();
  // A document owns one cached guide. Release observers when that document is discarded.
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    observer?.disconnect(); changes.disconnect(); document.removeEventListener("visibilitychange", visibility);
  }, { once: true });
}
