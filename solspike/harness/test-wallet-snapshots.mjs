// Development-only presentation snapshots. The delivered pages never load the wallet runtime.
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const SAMPLE_PAGES = Object.freeze([
  ["overview", "Overview"], ["approvals", "Approvals"], ["activity", "Activity"],
  ["recipients", "Address book"], ["swap", "Swap"], ["chats", "Chats"],
  ["recovery", "Security"], ["settings", "Settings"],
  ["send", "Send preview"], ["receive", "Receive preview"],
]);
const BANNER = "Test wallet · Sample data · 2 of 3 · No real funds or signing";
const SAMPLE_CSS = (
  "\n.sample-banner{position:relative;z-index:100;margin:0;"
  + "padding:12px 24px;\nbackground:var(--panel);border-botto"
  + "m:2px solid var(--accent);display:grid;\ngrid-template-c"
  + "olumns:minmax(0,1fr) auto;gap:4px "
  + "24px;align-items:center}\n.sample-banner "
  + "p{margin:0}.sample-nav{display:flex;flex-wrap:wrap;gap:"
  + "8px}\n.sample-banner>strong,.sample-banner>p{grid-column"
  + ":1}.sample-banner>details{grid-column:2;\ngrid-row:1/3}."
  + "sample-banner>details[open]{grid-column:1/-1;grid-row:3"
  + "}\n.sample-nav a{min-height:48px;padding:10px "
  + "14px}.sample-themes{display:flex;gap:16px;flex-wrap:wra"
  + "p}\n.sample-themes a{display:inline-flex;align-items:cen"
  + "ter;min-height:48px;padding:10px 12px}\n.sample-banner "
  + "strong{font-size:18px}.sample-placeholder{overflow-wrap"
  + ":anywhere}\n.sample-banner~.shell{min-height:calc(100dvh"
  + " - 82px)}\nbody:has(.dialog),body:has(.drawer){overflow:"
  + "auto}\n.sample-banner summary{min-height:48px;padding-bl"
  + "ock:10px;cursor:pointer}\n.sample-banner details[open] "
  + ".sample-nav{margin-block:8px 16px}\nbody:has(.dialog) "
  + ".scrim,body:has(.drawer) .scrim{display:none}\nbody:has("
  + ".dialog) .shell,body:has(.drawer) "
  + ".shell{display:none}\n.dialog,.drawer{position:relative;"
  + "top:auto;right:auto;bottom:auto;left:auto;transform:non"
  + "e;\nmargin:24px auto;width:min(620px,calc(100% - "
  + "32px));height:auto;max-height:none}\n@media(max-width:76"
  + "0px){.sample-banner{padding:12px "
  + "16px;grid-template-columns:minmax(0,1fr)}\n.sample-banne"
  + "r>details{grid-column:1;grid-row:auto}.sample-nav "
  + "a{flex:1 1 7rem}}\n"
);

// Executed only in the fresh harness context. Copy strings for the export audit, never to disk.
async function sensitiveStrings(page) {
  return page.evaluate(async () => {
    const k = await import("/app-keystore.js"), { state } = await import("/app-state.js");
    const strings = (v) => typeof v === "string" ? [v]
      : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
    return [...new Set(strings([k.secrets, k.gkeys, k.vault, state.wallet]))]
      .filter((s) => s.length >= 8);
  });
}

// This function is serialized into an isolated Playwright context, never a delivered page.
export function sanitizedSnapshot({ screen, pages, banner, sensitive }) {
  const root = document.body.cloneNode(true);
  const asset = /^\/(?:logo\.png(?:\?v=[a-z0-9]+)?|assets\/(?:zcash|solana|usdc)\.svg)$/;
  const tags = new Set(("a article aside b br button circle dd details div dl dt em fieldset "
    + "footer form figure figcaption g h1 h2 h3 h4 h5 h6 header hr i image img input label legend "
    + "li line main nav ol option p path polygon polyline rect section select small span strong "
    + "summary svg textarea time ul").split(" "));
  const attrs = new RegExp("^(?:class|id|role|lang|dir|tabindex|aria-[a-z-]+|type|width|height|alt|"
    + "viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|d|points|cx|cy|r|x|y|"
    + "x1|x2|y1|y2|rx|ry|focusable|placeholder|rows|cols)$", "i");
  const removed = "script,style,base,meta,link,iframe,object,embed,canvas,noscript,template,"
    + "[hidden],input[type=hidden],.technical,.secret-link,.qr,.qr-toggle,.safety,#banner";
  root.querySelectorAll(removed).forEach((n) => n.remove());
  root.querySelectorAll("details").forEach((n) => {
    if (/technical|viewing key/i.test(n.querySelector("summary")?.textContent || "")) n.remove();
  });
  root.querySelectorAll("h3").forEach((n) => {
    if (n.textContent.trim() === "Invite link") n.closest("section")?.remove();
  });
  root.querySelectorAll(".addr-full,.addr-box,.hex").forEach((n) => {
    n.textContent = "Sample address hidden · do not deposit";
    n.classList.add("sample-placeholder");
  });
  const cleanAttributes = (n) => {
    const dropped = Array.from(n.attributes).filter((a) => {
      if (/url\s*\(|(?:https?|javascript|vbscript|data|blob):/i.test(a.value)) return true;
      const artwork = ["img", "image"].includes(n.localName)
        && ["src", "href"].includes(a.name) && asset.test(a.value);
      return !artwork && !attrs.test(a.name);
    });
    dropped.forEach((a) => n.removeAttribute(a.name));
  };
  const cleanControl = (n) => {
    if (n.matches("button,input,select,textarea,fieldset")) n.setAttribute("disabled", "");
    if (n.matches("input,textarea,select")) { n.value = ""; n.removeAttribute("value"); }
    if (n.localName === "textarea") n.textContent = "";
    if (n.localName === "a") { n.setAttribute("aria-disabled", "true"); n.tabIndex = -1; }
    if (n.getAttribute("role") === "dialog") n.removeAttribute("aria-modal");
  };
  root.querySelectorAll("*").forEach((n) => {
    if (!tags.has(n.localName)) { n.remove(); return; }
    cleanAttributes(n); cleanControl(n);
  });
  const link = (label, to, cls = "btn") => {
    const a = document.createElement("a"); a.className = cls;
    a.href = to + ".html"; a.textContent = label; return a;
  };
  for (const [id, label] of pages) {
    const old = root.querySelector("#tab-" + id);
    if (!old) continue;
    const a = link(label, id, old.className); a.id = old.id;
    a.replaceChildren(...old.childNodes);
    if (id === screen) a.setAttribute("aria-current", "page");
    old.replaceWith(a);
  }
  const logo = root.querySelector(".logo");
  if (logo) {
    logo.href = "overview.html"; logo.removeAttribute("aria-disabled"); logo.tabIndex = 0;
  }
  root.querySelectorAll(".dialog .icon-btn,.drawer .icon-btn").forEach((n) => {
    const a = link("Close preview", "overview", "btn"); n.replaceWith(a);
  });
  root.querySelectorAll(".dialog,.drawer").forEach((n) => root.replaceChildren(n));
  const box = document.createElement("header"); box.className = "sample-banner";
  const title = document.createElement("strong"); title.textContent = banner; box.append(title);
  const note = document.createElement("p");
  note.textContent = "Read-only snapshots. All wallet actions are disabled."; box.append(note);
  const chooser = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "Sample screens and appearance"; chooser.append(summary);
  const nav = document.createElement("nav"); nav.className = "sample-nav";
  nav.setAttribute("aria-label", "Sample screens");
  pages.forEach(([id, label]) => nav.append(link(label, id))); chooser.append(nav);
  const themes = document.createElement("nav"); themes.className = "sample-themes";
  themes.setAttribute("aria-label", "Sample appearance");
  for (const theme of ["dark", "light", "system"]) {
    const a = link(theme[0].toUpperCase() + theme.slice(1), screen, "");
    a.href = screen + ".html?theme=" + theme; themes.append(a);
  }
  chooser.append(themes); box.append(chooser); root.prepend(box);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) walker.currentNode.textContent = walker.currentNode.textContent
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "[external address omitted]")
    .replace(/\b(?:[a-f0-9]{20,}|[A-Za-z0-9]{48,})\b/gi, "[sample identifier omitted]");
  const html = root.innerHTML, visible = root.textContent.replace(/\s/g, "");
  if (sensitive.some((s) => html.includes(s) || visible.includes(s.replace(/\s/g, "")))) {
    throw new Error("Sample export contains wallet material; no page was written.");
  }
  return html;
}

// An independent fail-closed output check. Do not log the offending text or secret values.
export function assertInertSnapshot(html) {
  if (/<(?:script|style|link|base|meta|iframe|object|embed|canvas)\b/i.test(html)
    || /\s(?:on[a-z]+|srcdoc|action|formaction|srcset|download)\s*=/i.test(html)
    || /(?:javascript|vbscript|data|blob):/i.test(html)) {
    throw new Error("Sample export contains an executable or unsupported element.");
  }
  Array.from(html.matchAll(/\b(href|src)="([^"]*)"/g)).forEach(([, attribute, href]) => {
    if (attribute === "src") {
      if (!/^\/(?:logo\.png(?:\?v=[a-z0-9]+)?|assets\/(?:zcash|solana|usdc)\.svg)$/.test(href)) {
        throw new Error("Sample export contains an unsupported image source.");
      }
      return;
    }
    const page = href.replace(/\.html(?:\?theme=(?:dark|light|system))?$/, "");
    const asset = /^\/assets\/(?:zcash|solana|usdc)\.svg$/.test(href);
    if (!asset && !SAMPLE_PAGES.some(([id]) => id === page)) {
      throw new Error("Sample export contains a non-sample link.");
    }
  });
  if (/<(?:input|button|select|textarea|fieldset)\b(?![^>]*\bdisabled(?:[\s=>]))/i.test(html)) {
    throw new Error("Sample export contains an enabled wallet control.");
  }
}

const documentOf = (html) => "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
  + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
  + "<title>Test wallet · UI sample</title><link rel=\"stylesheet\" href=\"/design-system.css\">"
  + "<link rel=\"stylesheet\" href=\"/app.css\"><link rel=\"stylesheet\" href=\"/sample.css\">"
  + "<link rel=\"icon\" href=\"/logo.png\"></head><body>" + html + "</body></html>";

async function capturePage(page, screen, sensitive) {
  const html = await page.evaluate(sanitizedSnapshot,
    { screen, pages: SAMPLE_PAGES, banner: BANNER, sensitive });
  assertInertSnapshot(html);
  return documentOf(html);
}

async function captureDialog(page, kind, sensitive, stable) {
  const label = kind === "send" ? "Send" : "Receive";
  const picker = page.locator(".overview-action-picker").filter({
    has: page.locator("summary").filter({ hasText: new RegExp("^" + label + "$") }),
  });
  await picker.locator("summary").click();
  await picker.locator('[aria-describedby="choose-' + kind + '-zec"]').click();
  await page.getByRole("dialog").waitFor(); await stable(page);
  const html = await capturePage(page, kind, sensitive);
  await page.keyboard.press("Escape"); await stable(page);
  return html;
}

/** Capture actual renderers only after the existing fresh, unfunded wallet journey completes. */
export async function exportTestWallet(page, { directory, nav, stable, check }) {
  if (!isAbsolute(directory)) throw new Error("Test-wallet output must be an absolute path.");
  const sensitive = await sensitiveStrings(page), snapshots = new Map();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [id] of SAMPLE_PAGES.slice(0, 8)) {
    await nav(page, id); await stable(page);
    snapshots.set(id, await capturePage(page, id, sensitive));
  }
  await nav(page, "overview");
  for (const id of ["send", "receive"]) {
    snapshots.set(id, await captureDialog(page, id, sensitive, stable));
  }
  check(snapshots.size === 10, "ten inert sample screens contain no wallet material");
  mkdirSync(directory, { recursive: true });
  for (const [id, html] of snapshots) writeFileSync(join(directory, id + ".html"), html);
  writeFileSync(join(directory, "sample.css"), SAMPLE_CSS);
}
