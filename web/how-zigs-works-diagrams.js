// Fixed synthetic artwork only. No wallet state, keys or network access.
import { docsDiagramSvg } from "./how-zigs-works-art.js";
import { flowArtwork } from "./how-zigs-works-flow-art.js";

export function guideDiagram(id, { prefix = "reference", flow = false, phase = "" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "hw-art";
  let markup = flow ? flowArtwork(id, phase) : docsDiagramSvg(id);
  // The reference and journey may coexist while one is hidden. Scope every SVG definition.
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const name of new Set(ids)) markup = markup.replaceAll(`id="${name}"`, `id="${prefix}-${name}"`)
    .replaceAll(`url(#${name})`, `url(#${prefix}-${name})`);
  wrapper.innerHTML = markup;
  return wrapper;
}
