// The appearance of the page: the device setting (the default), Dark or Light. The choice stays
// in this browser only. It sets data-theme on the root element, which design-system.css reads;
// no attribute means the device setting. theme.js applies a saved choice before the first paint.
import { el } from "./app-dom.js";

const KEY = "zf-theme";
const CHOICES = [["device", "Browser setting"], ["dark", "Dark"], ["light", "Light"]];

function apply(theme) {
  const root = document.documentElement;
  if (theme === "dark" || theme === "light") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** The Appearance select: a change applies at once and stays in this browser. */
export function themeChoice() {
  const now = document.documentElement.dataset.theme || "device";
  const change = (ev) => {
    apply(ev.target.value);
    try { localStorage.setItem(KEY, ev.target.value); } catch {}
  };
  return el("label", { class: "field" }, el("span", {}, "Appearance"),
    el("select", { class: "input", onchange: change },
      CHOICES.map(([value, label]) => el("option", { value, selected: now === value }, label))));
}
