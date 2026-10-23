// The page entry. The Tor demo is only a popup: if it fails, the wallet still loads.
import { installPrivacyPopup } from "./network-privacy-popup.js";
try {
  installPrivacyPopup();
} catch (error) {
  console.error("The Tor demo did not start.", error);
}
await import("./app.js");
await import("./homepage-motion.js");
