// Preserve the existing landing page and app. Only the small privacy popup is simulated.
import { installPrivacyPopup } from "./network-privacy-popup.js";
await import("./theme.js");
installPrivacyPopup();
await import("./app.js");
await import("./homepage-motion.js");
