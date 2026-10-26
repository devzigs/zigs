// Educational UI only: fixed examples and document-local reading progress.
import { flows } from "./how-zigs-works-journey-content.js";
import { guideDiagram } from "./how-zigs-works-diagrams.js";
import { icon } from "./how-zigs-works-icons.js";

const numbers = index => String(index + 1).padStart(2, "0");
const diagrams = { create: "dkg", verify: "verify", approve: "payment", recover: "recovery" };

export function reliefIcon(index, prefix) {
  const node = document.createElement("span");
  node.className = "hw-relief";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = icon(index, prefix);
  return node;
}

export function journeyView(el, openChapter) {
  let selected = 0;
  const root = el("section", { class: "hw-journeys", id: "hw-journeys", "aria-label": "Animated overview" });
  const position = el("span", { class: "hw-position", "aria-live": "polite" });
  const panel = el("section", { class: "hw-journey-panel", id: "hw-journey-panel", tabindex: "-1" });
  const tabs = [];
  const track = el("div", { class: "hw-journey-choices", role: "group", "aria-label": "Choose a journey" });
  const icons = [0, 1, 3, 4, 7];
  const stepPositions = new Map();

  function choose(index, focus = false) {
    selected = (index + flows.length) % flows.length;
    tabs.forEach((tab, i) => tab.setAttribute("aria-pressed", String(i === selected)));
    const flow = flows[selected];
    position.textContent = numbers(selected) + " / " + numbers(flows.length - 1);
    panel.setAttribute("aria-label", flow.label + " journey");
    const progress = stepPositions.get(flow.id) || 0;
    const artHost = el("div", { class: "hw-journey-art-host" });
    const stageLabel = el("span", { class: "hw-position", "aria-live": "polite" });
    const caption = el("p", { class: "hw-journey-caption" });
    const stageButtons = [];
    const copy = el("div", { class: "hw-step-copy" });
    const illustration = el("figure", { class: "hw-journey-figure" },
      el("div", { class: "hw-figure-top" }, el("span", { class: "hw-eyebrow" }, "An illustrated explanation"), stageLabel),
      artHost, el("figcaption", {}, caption));
    const stages = el("div", { class: "hw-step-controls", role: "group", "aria-label": flow.label + " steps" });
    const steps = flow.steps;
    const previous = el("button", { type: "button", class: "hw-page-button", "data-key": "hw-step-previous",
      onclick: () => pick(current - 1) }, "← Previous step");
    const next = el("button", { type: "button", class: "hw-page-button hw-next", "data-key": "hw-step-next",
      onclick: () => pick(current + 1) }, "Next step →");
    let current = progress;
    function pick(index, focusStep = false) {
      current = Math.max(0, Math.min(index, steps.length - 1));
      stepPositions.set(flow.id, current);
      const step = steps[current];
      stageButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === current)));
      stageLabel.textContent = "Step " + numbers(current) + " / " + numbers(steps.length - 1);
      caption.textContent = step.caption;
      const art = diagrams[step.art];
      artHost.replaceChildren(guideDiagram(art || step.art, { flow: !art, phase: step.id, prefix: "journey-" + flow.id + "-" + step.id }));
      copy.replaceChildren(el("p", { class: "hw-eyebrow" }, numbers(current) + " / " + (flow.status ? "Design preview" : flow.label)),
        el("h4", {}, step.title + "."), el("p", { class: "hw-step-description" }, step.copy),
        el("button", { type: "button", class: "hw-read-more", "data-key": "hw-step-reference",
          onclick: () => openChapter(step.docs) }, step.link, el("span", { "aria-hidden": "true" }, "↗")));
      previous.disabled = current === 0;
      next.disabled = current === steps.length - 1;
      if (focusStep) stageButtons[current].focus({ preventScroll: true });
    }
    steps.forEach((step, i) => {
      const button = el("button", { type: "button", class: "hw-step-choice", "aria-pressed": "false",
        "data-key": "hw-step-" + flow.id + "-" + step.id, onclick: () => pick(i),
        onkeydown: event => {
          const keys = { ArrowRight: (i + 1) % steps.length, ArrowLeft: (i + steps.length - 1) % steps.length,
            Home: 0, End: steps.length - 1 };
          if (!(event.key in keys)) return;
          event.preventDefault(); pick(keys[event.key], true);
        } }, el("span", {}, numbers(i)), step.title);
      stageButtons.push(button); stages.append(button);
    });
    panel.replaceChildren(el("header", { class: "hw-journey-heading" },
      el("div", {}, el("p", { class: "hw-eyebrow" }, numbers(selected) + " / " + flow.label), el("h3", {}, flow.title)),
      el("div", {}, flow.status ? el("span", { class: "hw-preview-label" }, flow.status) : null,
        el("p", {}, flow.description))), stages,
      el("div", { class: "hw-journey-stage" }, illustration,
        el("div", { class: "hw-journey-story" }, copy, el("div", { class: "hw-step-pagination" }, previous, next))),
      el("p", { class: "hw-journey-disclaimer" }, flow.status
        ? "Preview · Unavailable. These illustrations do not execute swaps, collect approvals or connect to a wallet."
        : "Illustration only. These examples never inspect a wallet, collect approvals or change your setup."));
    pick(progress);
    if (focus) tabs[selected].focus({ preventScroll: true });
  }
  flows.forEach((flow, i) => {
    const tab = el("button", { type: "button", class: "hw-journey-choice", "aria-pressed": "false",
      "aria-controls": "hw-journey-panel", "data-key": "hw-journey-" + flow.id,
      onclick: () => choose(i), onkeydown: event => {
        const keys = { ArrowRight: (i + 1) % flows.length, ArrowLeft: (i + flows.length - 1) % flows.length,
          Home: 0, End: flows.length - 1 };
        if (!(event.key in keys)) return;
        event.preventDefault(); choose(keys[event.key], true);
      } }, reliefIcon(icons[i], "journey-icon-" + i),
      el("span", {}, el("strong", {}, flow.label), el("small", {}, flow.status ? "Preview · Unavailable" : flow.summary)),
      el("span", { class: "hw-choice-number", "aria-hidden": "true" }, numbers(i)));
    tabs.push(tab); track.append(tab);
  });
  root.append(el("header", { class: "hw-overview-intro" },
    el("div", {}, el("p", { class: "hw-eyebrow" }, "The ideas behind your wallet"),
      el("h3", {}, "Shared control.", el("span", {}, "Step by step."))),
    el("div", {}, el("p", {}, "From your first signing share to a private conversation. Explore one journey at a time."),
      el("button", { type: "button", class: "hw-reference-link", "data-key": "hw-open-reference",
        onclick: () => openChapter("shared-control") }, "Read the complete guide", el("span", { "aria-hidden": "true" }, "→")))),
    el("div", { class: "hw-explore-label" }, el("span", {}, "Explore the journeys"), position), track, panel);
  choose(0);
  return root;
}
