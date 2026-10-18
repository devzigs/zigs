// The appearance of the page: the device setting (the default), Dark or Light. The choice stays
// in this browser only. It sets data-theme on the root element, which design-system.css reads;
// no attribute means the device setting.
import { el } from "./app-dom.js";

const KEY = "zf-theme";
const CHOICES = [["device", "Device setting"], ["dark", "Dark"], ["light", "Light"]];
let theme = "device";

function apply() {
  const root = document.documentElement;
  if (theme === "device") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

try { theme = localStorage.getItem(KEY) || "device"; } catch {}
if (!CHOICES.some(([value]) => value === theme)) theme = "device";
apply();

/** The Appearance select: a change applies at once and stays in this browser. */
export function themeChoice() {
  const change = (ev) => {
    theme = ev.target.value;
    apply();
    try { localStorage.setItem(KEY, theme); } catch {}
  };
  return el("label", { class: "field" }, el("span", {}, "Appearance"),
    el("select", { class: "input", onchange: change },
      CHOICES.map(([value, label]) => el("option", { value, selected: theme === value }, label))));
}
