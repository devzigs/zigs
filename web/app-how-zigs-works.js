import { el } from "./app-dom.js";
import { render } from "./app-loop.js";
import { chapters, GUIDE_SOURCE } from "./how-zigs-works-content.js";
import { guideDiagram } from "./how-zigs-works-diagrams.js";

// Browser-session reading state only. Reusing this subtree preserves focus, chapter and
// animation through unrelated app redraws. This module never reads or changes wallet state.
let guide;

let open = false, dialog;
export function hasHowZigsWorks() { return open; }
export function closeHowZigsWorks() { open = false; }
export function openHowZigsWorks() {
  open = true; dialog?.classList.add("home-how-enter"); render();
}

// Reuse the app's modal focus, dismissal and background-scroll behavior.
export function howZigsWorksDialog() {
  if (!dialog || dialog.ownerDocument !== document) {
    dialog = el("section", { class: "dialog home-how-dialog home-how-enter", role: "dialog",
      "aria-modal": "true", "aria-labelledby": "home-how-title",
      onanimationend: (event) => {
        if (event.target === dialog && event.animationName === "home-how-rise")
          dialog.classList.remove("home-how-enter");
      } },
      el("header", { class: "home-how-heading" },
        el("h2", { id: "home-how-title" }, "How Zigs works"),
        el("button", { class: "icon-btn", type: "button", "data-first-focus": "",
          "data-key": "home-how-close", "aria-label": "Close How Zigs works",
          onclick: () => { closeHowZigsWorks(); render(); } }, "×")),
      el("div", { class: "home-how-content" }, howZigsWorks(el)));
  }
  return dialog;
}

export function howZigsWorks(el) {
  if (guide && guide.ownerDocument === document) return guide;
  let selected = 0, paused = false;
  const number = (i) => String(i + 1).padStart(2, "0");
  const tabs = [];
  const panel = el("div", { class: "hw-panel", id: "hw-chapter", role: "tabpanel", tabindex: "0" });
  const position = el("span", { class: "hw-position", "aria-live": "polite", "aria-atomic": "true" });
  const root = el("section", { class: "hw-guide", "aria-label": "How Zigs works: complete guide" });
  const nav = el("div", { class: "hw-tabs", role: "tablist", "aria-label": "Guide chapters" });
  function choose(index, { focus = true, scroll = false } = {}) {
    selected = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    const chapter = chapters[index];
    panel.setAttribute("aria-labelledby", "hw-tab-" + chapter.id);
    panel.replaceChildren(chapterView(chapter, index));
    position.textContent = "Chapter " + number(index) + " of " + chapters.length;
    if (focus) tabs[index].focus({ preventScroll: true });
    // Scroll only this horizontal strip; selecting a chapter must not jump the whole page.
    const tab = tabs[index];
    if (tab.offsetLeft < nav.scrollLeft || tab.offsetLeft + tab.offsetWidth > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = tab.offsetLeft - 8;
    if (scroll) root.querySelector(".hw-navigation").scrollIntoView({ block: "start", behavior: "auto" });
  }
  chapters.forEach((chapter, i) => {
    const tab = el("button", { type: "button", role: "tab", class: "hw-tab",
      id: "hw-tab-" + chapter.id, "aria-controls": "hw-chapter",
      "data-key": "hw-tab-" + chapter.id, "aria-selected": i === 0 ? "true" : "false",
      tabindex: i === 0 ? "0" : "-1", onclick: () => choose(i),
      onkeydown: (event) => {
        const keys = { ArrowRight: (selected + 1) % chapters.length,
          ArrowLeft: (selected + chapters.length - 1) % chapters.length, Home: 0, End: chapters.length - 1 };
        if (!(event.key in keys)) return;
        event.preventDefault(); choose(keys[event.key]);
      },
    }, el("span", { class: "hw-tab-number", "aria-hidden": "true" }, number(i)), chapter.nav);
    tabs.push(tab); nav.append(tab);
  });
  function chapterView(chapter, index) {
    const pause = el("button", { type: "button", class: "hw-pause", "data-key": "hw-pause",
      "aria-pressed": String(paused), onclick: () => {
        paused = !paused; root.dataset.paused = String(paused);
        pause.setAttribute("aria-pressed", String(paused));
        pause.textContent = paused ? "Play illustration" : "Pause illustration";
      } }, paused ? "Play illustration" : "Pause illustration");
    const figure = el("figure", { class: "hw-figure" },
      el("div", { class: "hw-figure-top" }, el("span", { class: "hw-eyebrow" }, "An illustrated explanation"),
        el("span", { class: "hw-figure-index", "aria-hidden": "true" }, number(index) + " / 10")),
      guideDiagram(chapter.diagram),
      el("figcaption", {}, el("strong", {}, chapter.diagramTitle), el("p", {}, chapter.diagramNote)),
      el("ol", { class: "hw-stages" }, chapter.stages.map((stage, i) => el("li", { class: "hw-stage-" + (i + 1) },
        el("span", { "aria-hidden": "true" }, number(i)), stage))),
      el("div", { class: "hw-animation-controls" }, pause,
        el("span", { class: "hw-reduced-label" }, "Animation off · reduced motion"),
        el("span", { class: "hw-illustration-label" }, "Illustration only")));
    const sections = chapter.sections.map((part) => el("section", { class: "hw-text-section" },
      el("h4", {}, part.title),
      (part.paragraphs || []).map((text) => el("p", {}, text)),
      part.items ? el("ul", {}, part.items.map((text) => el("li", {}, text))) : null,
      part.rows ? el("div", { class: "hw-table-wrap" }, el("table", {},
        el("caption", { class: "sr-only" }, part.title),
        el("thead", {}, el("tr", {}, part.headings.map((text) => el("th", { scope: "col" }, text)))),
        el("tbody", {}, part.rows.map(([label, description]) => el("tr", {},
          el("th", { scope: "row" }, label), el("td", {}, description)))))) : null,
      part.terms ? el("dl", { class: "hw-glossary" }, part.terms.flatMap(([term, definition]) => [
        el("dt", {}, term), el("dd", {}, definition),
      ])) : null));
    const sources = el("aside", { class: "hw-sources", "aria-label": "Chapter sources" },
      el("p", { class: "hw-eyebrow" }, "Explore the technical source"),
      el("div", {}, chapter.sources.map(([file, anchor], i) => el("a", {
        href: "https://github.com/devzigs/zigs/blob/" + GUIDE_SOURCE + "/" + file + (anchor ? "#" + anchor : ""),
        target: "_blank", rel: "noopener noreferrer", referrerpolicy: "no-referrer",
      }, (file === "PROTOCOL.md" ? "Protocol" : file === "PRIVACY.md" ? "Privacy model"
        : file === "ZOLANA.md" ? "Solana design" : "Messaging design")
        + (chapter.sources.filter(([name]) => name === file).length > 1 ? " · " + (i + 1) : "") + " ↗"))),
      el("p", { class: "hw-source-note" }, "Opens GitHub. The site can see your IP address and the document you open."));
    const next = el("div", { class: "hw-pagination", "aria-label": "Chapter navigation" },
      el("button", { type: "button", class: "hw-page-button", disabled: index === 0,
        "data-key": "hw-previous", onclick: () => choose(index - 1, { scroll: true }) },
        el("span", { "aria-hidden": "true" }, "←"), "Previous"),
      el("span", { class: "hw-page-count" }, number(index) + " / 10"),
      el("button", { type: "button", class: "hw-page-button hw-next", "data-key": "hw-next",
        onclick: () => choose(index === chapters.length - 1 ? 0 : index + 1, { scroll: true }) },
        index === chapters.length - 1 ? "Back to the basics" : "Next: " + chapters[index + 1].nav,
        el("span", { "aria-hidden": "true" }, "→")));
    return el("div", { class: "hw-layout" }, el("div", { class: "hw-visual-column" }, figure),
      el("article", { class: "hw-article" },
        el("header", { class: "hw-chapter-heading" },
          el("p", { class: "hw-eyebrow" }, "Chapter " + number(index) + " · " + chapter.nav),
          el("h3", {}, chapter.title), el("p", { class: "hw-intro" }, chapter.intro)),
        el("div", { class: "hw-takeaway" }, el("span", { class: "hw-eyebrow" }, "The key idea"),
          el("p", {}, chapter.takeaway)), ...sections, sources, next));
  }
  root.append(el("nav", { class: "hw-navigation", "aria-label": "How Zigs works" },
    el("div", { class: "hw-navigation-meta" }, position, el("span", {}, "Scroll to explore all chapters →")), nav), panel);
  guide = root;
  choose(0, { focus: false });
  return guide;
}
