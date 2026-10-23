// Public design fixture. No wallet, keys, storage or service calls.
import { newNamePreview, znsSetupPreview } from "../../zns-setup-preview.js";
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of kids.flat()) if (child != null && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const draft = newNamePreview();
document.getElementById("name-preview").append(znsSetupPreview({ el, draft,
  onBack: () => { document.getElementById("preview-status").textContent = "Back to recovery files in the full setup."; },
  onContinue: () => { document.getElementById("preview-status").textContent = "Continue to Overview without a name. Nothing purchased or registered."; },
}));
