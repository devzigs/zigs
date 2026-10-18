// The Zigs web app. index.html loads this module, so the page needs no inline script. It lists
// every module of the page, so the browser asks for all of them at once, then starts the page.
import "./qr.js";
import "./payees.js";
import "./vault.js";
import "./util.js";
import "./signed.js";
import "./chat.js";
import "./personal.js";
import "./requests.js";
import "./setup-model.js";
import "./app-state.js";
import "./app-kit.js";
import "./app-engine.js";
import "./app-keystore.js";
import "./app-seats.js";
import "./app-links.js";
import "./app-chain.js";
import "./app-filter.js";
import "./app-groups.js";
import "./app-dom.js";
import "./app-icons.js";
import "./app-theme.js";
import "./app-messages.js";
import "./app-dkg.js";
import "./app-payments.js";
import "./app-payreq.js";
import "./app-account.js";
import "./app-thread.js";
import "./app-backups.js";
import "./app-account-view.js";
import "./app-shell.js";
import "./app-drawer.js";
import "./app-loop.js";
import "./app-setup.js";
import "./app-sol.js";
import "./app-wallet.js";
import "./app-send.js";
import { loadEngine } from "./app-engine.js";
import { lockedVault } from "./app-keystore.js";
import { adoptInviteKey } from "./app-links.js";
import { startUp } from "./app-account.js";
import { draw, render } from "./app-loop.js";

adoptInviteKey();
draw();   // the first paint does not wait for the engine
loadEngine().then(() => lockedVault ? render() : startUp());
