// The Zigs web app. Loaded by index.html as a module, so the page needs no inline script.
import "./qr.js";
import "./payees.js";
import "./vault.js";
import "./util.js";
import "./signed.js";
import "./chat.js";
import "./personal.js";
import "./requests.js";
import "./app-state.js";
import "./app-kit.js";
import "./app-engine.js";
import "./app-rest.js";
import { loadEngine } from "./app-engine.js";
import { adoptInviteKey, draw, lockedVault, render, startUp } from "./app-rest.js";

adoptInviteKey();
draw();   // the first paint does not wait for the engine
loadEngine().then(() => lockedVault ? render() : startUp());
