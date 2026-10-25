// Educational diagrams only. Actual setup status and safeguards stay in the existing ceremony.
import { el } from "./app-dom.js";
import { icon } from "./app-icons.js";
import { SETUP_STAGES } from "./setup-model.js";
import { presentEducation } from "./app-motion.js";
import { distributedSecurity } from "./app-security.js";
import { setupProgress } from "./setup-wizard.js";

// Contextual education only. These symbols and words never report or grant protection.
const SECURITY_EXPLANATIONS = Object.freeze({
  passkey: ["fingerprint", "Protect your local signing share",
    "A passkey unlocks encrypted wallet data in this browser. Your passkey provider may ask for a fingerprint, face, PIN or security key. It does not add a signing device or replace a recovery file."],
  threshold: ["approvals", "Share approval across devices",
    "Separate physical devices each keep a signing share. Payments need your chosen number of approvals, reducing reliance on any one device."],
  device: ["key", "One device, one signing share",
    "A recognizable label helps you identify this device’s share. Labels do not prove identity; compare the safety number on the actual devices."],
  review: ["security", "Check the arrangement before creating",
    "Review the devices, approval rule and networks together. Every device takes part in initial setup before the wallet can be used."],
  "payment-review": ["approvals", "Inspect the payment before approving",
    "Check the recipients, amounts, network costs and any warnings. Approve only when the existing checks show the payment you intend to make."],
  overview: ["home", "Start with the right wallet",
    "Check the wallet, asset and network before continuing."],
  approvals: ["approvals", "Review before you approve",
    "Check the full recipient addresses, amounts and network costs. Only approve a payment you recognize and intend to make."],
  activity: ["activity", "Follow the actual payment status",
    "Use each payment’s status and network details to understand its progress. An activity entry alone does not mean a payment is confirmed."],
  chats: ["chat", "Keep coordination separate from approval",
    "Messages do not authorize payments. Check the actual payment review before giving an approval."],
  recipients: ["addressBook", "Check more than a saved name",
    "Saved names are your labels, not identity verification. Check the full address and network in the payment review."],
  recovery: ["security", "Keep independent shares recoverable",
    "Each encrypted recovery file copies one device’s share and needs its passphrase. Recovery still needs enough usable independent shares to meet the wallet’s approval rule."],
  settings: ["settings", "Manage access on this device",
    "Review this browser’s existing access and recovery controls. Keep recovery files available before removing local keys."],
  help: ["key", "Get help without sharing secrets",
    "Help answers work offline. Diagnostics are only shared when you copy them and choose to send them."],
  send: ["send", "Check the destination before continuing",
    "Review the full recipient address, asset, network and total cost. Payment approvals follow the wallet’s rule."],
  receive: ["receive", "Share the correct receiving address",
    "Check the wallet name, asset and network before sharing its address. The sender needs the address for the asset and network they are using."],
  backup: ["lock", "Save a separate copy of this share",
    "Keep the encrypted file and its passphrase separately. Copying one share does not create another independent signing device."],
  "backup-check": ["lock", "Check this saved copy",
    "This optional check compares the opened file with this device’s existing share. It does not restore or replace key shares."],
  "account-backup": ["lock", "Encrypt a separate account recovery copy",
    "Keep the account backup file and its passphrase separately. Together they give access to this personal account."],
  restore: ["key", "Open the saved copy with its passphrase",
    "The encrypted file needs its separate passphrase. Check which wallet or account the saved file belongs to before restoring it."],
  verify: ["approvals", "Compare the actual devices",
    "Compare all 30 digits on every device before confirming. A matching safety number helps you check which devices joined; stop if any number differs."],
  connect: ["devices", "Connect only your intended devices",
    "Use independent physical devices and keep the setup invitation private. Anyone with the invite link can read wallet information and join an open device slot."],
  prepare: ["key", "Create the wallet key together",
    "The devices exchange encrypted setup messages and check the shared address. No device receives the whole wallet key."],
  ready: ["security", "Use your independent devices together",
    "The wallet’s preparation checks are complete. Payments still need the configured approvals; keep each device and any recovery copies safe."],
});

/** Static guidance: its decorative icon is paired with visible, screen-readable meaning. */
export function securityExplanation(kind) {
  const explanation = SECURITY_EXPLANATIONS[kind];
  if (!explanation) throw new Error("No security explanation for " + kind);
  const [mark, title, copy] = explanation;
  return el("div", { class: "security-explanation", "data-security-explanation": kind },
    icon(mark), el("div", { class: "security-explanation-copy" },
      el("strong", {}, title), el("p", { class: "small muted" }, copy)));
}

const DIAGRAMS = {
  shares: { caption: "Example: separate shares on three devices", nodes: [
    ["phone", "Everyday phone", "Share 1"], ["devices", "Second device", "Share 2"],
    ["phone", "Reserve device", "Share 3"]],
    note: "Any two can authorize a payment. One device alone cannot spend. All three take part in setup." },
  approval: { caption: "Example: any 2 of 3 approvals", nodes: [
    ["approvals", "Everyday phone", "Approval 1"], ["approvals", "Second device", "Approval 2"],
    ["phone", "Reserve device", "Available if needed"]],
    note: "With a 2 of 3 rule, two devices can approve while one is unavailable." },
  backup: { caption: "Keep each device recoverable", nodes: [
    ["phone", "Key share", "On your device"], ["lock", "Encrypted file", "Saved separately"],
    ["key", "Passphrase", "Kept apart from the file"]],
    note: "Each device can save its own recovery files. Saving and checking them is optional. Keep each file and its passphrase safe and separate." },
  verify: { caption: "Compare before creating the wallet key", nodes: [
    ["phone", "Every device", "Shows a safety number"], ["approvals", "Compare", "All 30 digits match"],
    ["security", "Confirm", "Only after checking"]],
    note: "A matching safety number helps you check which devices joined. Never confirm a mismatch." },
  protection: { caption: "A passkey protects this device’s share", nodes: [
    ["lock", "This device", "Passkey unlock"], ["approvals", "Another device", "A separate approval"],
    ["phone", "Reserve device", "A separate share"]],
    note: "A passkey unlocks one signing share. It does not count as another device or authorize a payment alone." },
  connect: { caption: "Connect a separate device", nodes: [
    ["phone", "This device", "Its own share"], ["devices", "Second device", "Joins with the private code"],
    ["phone", "Reserve device", "Joins next"]],
    note: "Use separate physical devices. Multiple browsers on one device do not provide physical independence." },
  reserve: { caption: "Connect your reserve device", nodes: [
    ["phone", "Everyday device", "Connected"], ["devices", "Second device", "Connected"],
    ["phone", "Reserve device", "Connect for setup"]],
    note: "The reserve is a normal Zigs signing device, not a hardware wallet or an offline-signing system. Keep it connected until setup finishes. Saving recovery files is optional." },
  prepare: { caption: "Your devices prepare the wallet together", nodes: [
    ["phone", "This device", "Encrypted messages"], ["devices", "Second device", "Checks the address"],
    ["phone", "Reserve device", "Checks the same wallet"]],
    note: "No device receives the whole key. Keep Zigs open on every device while both requested chains are prepared." },
  ready: { caption: "Your independent devices are ready", nodes: [
    ["phone", "Everyday device", "Use normally"], ["devices", "Second device", "Use together"],
    ["security", "Reserve device", "Store safely"]],
    note: "Use your two everyday devices together. If one becomes unavailable, your reserve device can help you access the wallet." },
};

export function tutorialDiagram(kind, { number = null, devices = [], rule = null,
  walletName = "One shared wallet" } = {}) {
  const customReady = kind === "ready" && rule && (rule.n !== 3 || rule.t !== 2);
  const customShares = ["shares", "protection", "reserve", "prepare", "connect"].includes(kind)
    && rule && (rule.n !== 3 || rule.t !== 2 || devices.length);
  const members = devices.length ? devices : Array.from({ length: rule?.n || 3 }, (_, i) => "Device " + (i + 1));
  const d = customReady || customShares ? {
    caption: "Your wallet’s approval arrangement",
    nodes: members.map((label, i) => [i === 1 ? "devices" : "phone", label, "An independent share"]),
    note: "Use any " + rule.t + " of the " + rule.n + " independent devices together to authorize a payment. Keep every share recoverable.",
  } : kind === "verify" && number ? {
    caption: "Compare this expected safety number on every actual device",
    nodes: devices.map((label, i) => [i === 1 ? "devices" : "phone", label, number]),
    note: "These drawings repeat this screen’s number as a comparison guide. Check the actual screen of every device: the drawings do not verify another device for you.",
  } : DIAGRAMS[kind];
  const nodes = d.nodes.map(([mark, title, detail], i) =>
      el("div", { class: "tutorial-node" }, icon(mark), el("strong", {}, title),
        el("span", { class: "small muted" + (kind === "verify" && number ? " tutorial-safety-number" : "") }, detail),
        i < d.nodes.length - 1 ? el("span", { class: "tutorial-link", "aria-hidden": "true" }, icon("forward")) : null));
  const flow = el("div", { class: "tutorial-nodes" }, nodes);
  return el("figure", { class: "tutorial-diagram surface-quiet" },
    el("figcaption", { class: "label" }, d.caption),
    el("div", { class: "tutorial-wallet" },
      el("div", { class: "tutorial-wallet-head" }, icon("security"), el("div", {},
        el("span", { class: "label" }, "Wallet / shared account"), el("strong", {}, walletName))),
      el("p", { class: "small muted" }, kind === "backup"
        ? "Each device keeps one live share. The recovery files below are copies of that share."
        : "The wallet holds the assets at its shared address. These devices hold independent approval shares."),
      kind === "backup" ? null : flow,
      kind === "backup" ? null : el("p", { class: "tutorial-wallet-rule small" },
        "Approval rule · Any " + (rule?.t || 2) + " of " + (rule?.n || 3) + " devices together")),
    kind === "backup" ? el("div", { class: "tutorial-copy-flow" }, flow,
      el("p", { class: "small muted" }, "Copies live outside the wallet. A backup file is not another signing device.")) : null,
    el("p", { class: "small muted" }, d.note));
}

/** Presentation of the caller's existing protection result. Animation never grants protection. */
export function passkeyIllustration(status = "unprotected") {
  const secured = status === "verified";
  return el("figure", { class: "passkey-illustration", "data-protection-art": status,
    "data-motion-watch": "passkey:setup-art", "data-motion-value": status },
    el("div", { class: "passkey-art", "aria-hidden": "true", "data-motion-mark": "" },
      el("div", { class: "passkey-browser" },
        el("div", { class: "passkey-browser-bar" }, el("i"), el("i"), el("i")),
        el("span", { class: "passkey-browser-line" }),
        el("span", { class: "passkey-fingerprint", "data-passkey-arrival": status === "unprotected" ? "" : null }, icon("fingerprint")),
        el("span", { class: "passkey-lock" },
          el("span", { class: "passkey-shackle" }), el("span", { class: "passkey-lock-body" })))),
    el("figcaption", { class: "passkey-art-caption" },
      el("strong", {}, secured ? "Passkey secured" : status === "pending"
        ? "Securing this browser…" : "Protect your local share"),
      el("span", { class: "small muted" }, secured ? "Local vault verified · your approval rule stays the same"
        : status === "pending" ? "Waiting for device authentication and the encrypted-copy check"
          : "Protect this browser to encrypt its local signing share.")));
}

// These diagrams explain the implementation; they never observe or advance a ceremony.
const educationFlow = (steps) => el("ol", { class: "setup-explainer-flow setup-technical-flow" },
  steps.map(([mark, title, copy], i) => el("li", {},
    el("span", { class: "setup-flow-number", "aria-hidden": "true" }, String(i + 1)),
    icon(mark), el("strong", {}, title), el("span", { class: "small muted" }, copy))));
const technicalDiagram = (id, title, steps, note) =>
  el("figure", { class: "setup-technical-diagram", "data-explainer-flow": id,
    "aria-labelledby": "setup-flow-" + id },
    el("figcaption", {}, el("span", { class: "label" }, "Educational diagram · not live progress"),
      el("h4", { id: "setup-flow-" + id }, title)),
    educationFlow(steps), note ? el("p", { class: "small muted setup-boundary-note" }, note) : null);

export function browserProtectionExplanation() {
  return el("div", { class: "setup-explainer" },
    technicalDiagram("protect", "First-time protection · create, encrypt, verify", [
      ["fingerprint", "Create the site passkey", "WebAuthn requests user verification. Your provider may use a fingerprint, face, PIN or security key; Zigs never receives your biometrics."],
      ["key", "Assert the same credential", "After registration, Zigs requests an assertion with that credential and a random PRF salt. This checks that the passkey can supply the key material again."],
      ["lock", "Derive the vault key", "The 32-byte WebAuthn PRF output is imported as a non-extractable AES-GCM key in memory. This encryption key is separate from the wallet’s signing shares."],
      ["browser", "Seal and save locally", "Covered wallet data is encrypted with a fresh IV and authenticated metadata. Ciphertext, credential id, salt and IV are saved in this browser’s localStorage."],
      ["approvals", "Reopen the saved copy", "Zigs reads the stored record back, decrypts it and compares the covered data. It also checks that the saved record did not change during verification."],
      ["security", "Clean up, then confirm", "Only after verification does Zigs remove covered unprotected copies and the separate device-account copy. Protection is reported after the existing cleanup checks succeed."],
    ], "If registration or authentication is cancelled, PRF is unsupported, or storage cannot be checked, Zigs does not report success. Failed saved-copy verification keeps the original unprotected copies; incomplete cleanup does not count as verified protection."),
    technicalDiagram("unlock", "Later unlocking · use the existing passkey", [
      ["fingerprint", "Authenticate again", "Zigs asks for the saved credential with user verification and the saved PRF salt. It does not register a new passkey each time you unlock."],
      ["key", "Recreate the encryption key", "A successful assertion supplies the PRF output for the same AES-GCM key. A different credential or unusable PRF result cannot open this saved vault."],
      ["lock", "Open the current vault", "Authenticated decryption makes the covered data available to this page in memory. Zigs rereads current browser storage so another tab’s saved changes are considered."],
      ["approvals", "Check protection boundaries", "Any separate unprotected copies must be covered by the verified vault before cleanup. Extra or unreadable data is kept for review; successful unlock alone is not proof that those copies are protected."],
    ], "A passkey unlocks local data; it is not another device, a payment approval or a recovery backup. Restoring a lost share still needs its recovery file and separate passphrase."),
    el("p", { class: "small muted" }, "The vault protects covered data at rest, not against code running in an unlocked page or every kind of browser-profile access. Private descriptions and other data outside the vault are not encrypted by this mechanism. Explicitly confirmed Skip leaves new signing shares without Zigs’ passkey encryption; it cannot bypass a locked, damaged or incomplete vault."));
}

export function thresholdExplanation(n = 3, t = 2) {
  const valid = Number.isInteger(n) && Number.isInteger(t) && n >= 2 && n <= 7 && t >= 2 && t <= n;
  return el("div", { class: "setup-explainer", "data-threshold-explanation": "" },
    valid ? el("figure", { class: "threshold-example" },
      el("figcaption", { class: "small muted" }, "Illustration · possible approvals, not live activity"),
      el("div", { class: "threshold-example-devices" }, Array.from({ length: n }, (_, i) =>
        el("span", { class: i < t ? "example-approval" : "" }, icon("phone"), "Device " + (i + 1)))),
      el("div", { class: "threshold-example-outcomes" },
        el("p", {}, el("strong", {}, t + " of " + n + " approve"),
          el("span", { class: "small muted" }, "Enough to participate in signing; transaction checks, proofs and network submission still follow.")),
        el("p", {}, el("strong", {}, "Fewer than " + t + " approve"),
          el("span", { class: "small muted" }, "No group authorization. Wait for enough usable independent shares.")))) : null,
    el("p", { class: "small muted" }, "All chosen devices take part in a key-generation ceremony. Each creates and keeps an independent share; no device receives the whole wallet spending key. Zcash uses re-randomized FROST over RedPallas; Solana has a separate FROST-Ed25519 key and its own checks."),
    technicalDiagram("formation", "Initial setup · every chosen device participates", [
      ["devices", "Join independent devices", "Each device keeps its own setup keys. The arrangement includes the participant count, approval threshold and network."],
      ["approvals", "Compare all 30 digits", "The safety number binds the setup device keys, wallet id, rule and network. Compare the actual screens; each device still needs its existing acknowledgement."],
      ["key", "Commit setup material", "After the safety checks, each device saves its private setup material before publishing its round-one package and commitment. Each records a digest of the round-one view."],
      ["lock", "Exchange encrypted packages", "Round-two packages are encrypted for the individual receiving devices. The exchanged data includes the round-one digest, so inconsistent setup views can be detected."],
      ["security", "Check agreement", "Each device checks the shared digest, the revealed material against its commitments, and the resulting public key packages. A mismatch stops the existing ceremony."],
      ["phone", "Retain separate shares", "Devices save their own key packages and check the shared wallet address. Shares remain separate during payments; signing does not assemble a complete spending key."],
    ], "Formation needs every chosen device, even if later payments need fewer approvals. A device label is not proof of identity or physical independence. Solana follows the existing Zcash preparation checks with its separate ceremony."),
    technicalDiagram("zec-signing", "Zcash payment · review, sign, prove, submit", [
      ["browser", "Review the transaction", "Each approving device decodes and checks the proposed transaction (PCZT), including intended recipients, amounts and costs. Its approval is bound to the transaction’s sighash."],
      ["key", "Save fresh nonces", "The engine makes one-time FROST nonces. The device saves them with the approved sighash before publishing only the nonce commitments."],
      ["devices", "Select the signing group", "When enough approvals exist, a signing package identifies the selected devices and their commitments. Fewer than the threshold cannot create group authorization."],
      ["security", "Recheck and sign a share", "Each selected device checks the transaction again and verifies its commitment. It deletes its saved nonces before publishing a signature share, preventing reuse through this path."],
      ["approvals", "Combine and verify", "Signature shares are combined and the result is verified under the spend’s re-randomized key. The full spending key is not reconstructed."],
      ["send", "Prove, validate and submit", "A device builds the Halo2 proof and checks the complete transaction before network submission. Approval or submission alone is not a confirmed payment."],
    ], "A changed sighash or invalid signing package is refused by the existing checks. Each payment uses its own nonce material; an earlier approval is not permission to sign different transaction bytes."),
    technicalDiagram("sol-signing", "Solana payment · approve the proposal, then execute", [
      ["browser", "Prepare the proposal", "The payment plan and an initial proof are prepared for the proposal account. Paid proposal operations use an individual device’s fee address."],
      ["security", "Check independently", "Each approver checks the intent, plan and first proof using its own wallet snapshot and the on-chain proposal account. The reviewed proposal-account digest is what the group authorizes."],
      ["key", "Bind fresh nonces", "Fresh FROST-Ed25519 nonces are saved for that digest before their commitments are published. Saved approval material for different bytes is refused."],
      ["devices", "Create the group signature", "Enough selected devices contribute signature shares for the checked digest. The resulting approval signature is combined and verified; the key shares stay separate."],
      ["lock", "Prepare execution", "An eligible device prepares a fresh execution proof for the same committed spend. Existing checks validate the execution message before that device’s fee key signs it."],
      ["send", "Execute and confirm", "The on-chain program checks the group approval and the committed operation. Execution also needs the existing fee and service checks; a confirmed chain result, not an approval count, establishes completion."],
    ], "This diagram describes the current payment path. Some setup or legacy operations sign checked messages instead. Proofs are checked at different stages from Zcash; the existing service/privacy disclosures still apply. Fee funding is needed for paid operations, not initial wallet formation."),
    el("p", { class: "small muted" }, "Use independent physical devices. Multiple browsers on one device can be lost together. A reserve device connects for setup and whenever needed for signing; it is not a hardware wallet or an offline-signing system."),
    el("p", { class: "small muted" }, "If too few independent shares remain usable, payments stop until enough are restored from recovery files and separate passphrases. A copy of one share is not another independent share. This version supports 2 to 7 devices and at least 2 approvals; 1 of 1 and 1 of 2 are unavailable."),
    el("p", { class: "small muted" }, "Change devices creates a new wallet and address. Moving Zcash funds needs the old wallet’s approvals; existing Solana funds do not move through that process."));
}

/** All labels describe a proposed arrangement, never detected hardware or real approvals. */
export function setupArrangement(n, t, kind = "rule", labels = {}) {
  const diagram = distributedSecurity({ n, t, preview: true, illustrate: kind === "rule",
    walletName: labels.name || "Your shared wallet",
    devices: Array.from({ length: n }, (_, i) => ({
      label: i === 0 ? labels.label || "This device" : "Device " + (i + 1),
      detail: "Independent share",
    })),
  });
  diagram.className += " setup-arrangement";
  diagram.setAttribute("data-preview", kind);
  diagram.setAttribute("data-rule", n + ":" + t);
  return diagram;
}

/** Update only illustrations. Inputs, selection, draft storage and validation stay untouched. */
export function updateSetupIllustrations(form, n, t, valid) {
  const explanation = form.querySelector("[data-threshold-explanation]");
  const rule = valid ? n + ":" + t : "invalid";
  if (explanation && explanation.getAttribute("data-rule") !== rule) {
    const next = thresholdExplanation(valid ? n : null, t);
    next.setAttribute("data-rule", rule); explanation.replaceWith(next);
  }
  for (const old of form.querySelectorAll(".setup-arrangement")) {
    let diagram = old;
    if (old.getAttribute("data-rule") !== (valid ? n + ":" + t : "invalid")) {
      diagram = valid ? setupArrangement(n, t, old.getAttribute("data-preview"))
        : el("figure", { class: "setup-arrangement", "data-preview": old.getAttribute("data-preview"),
          "data-rule": "invalid" }, el("p", { class: "small muted" },
          "Enter a supported arrangement to preview its devices."));
      old.replaceWith(diagram);
      const marks = diagram.querySelector("[data-education]");
      if (marks && !diagram.closest("[hidden]")) presentEducation(marks);
    }
    const wallet = diagram.querySelector("[data-preview-wallet]");
    const device = diagram.querySelector("[data-preview-device]");
    if (wallet) wallet.textContent = form.querySelector("#g-name").value || "Your shared wallet";
    if (device) device.textContent = form.querySelector("#my-name").value || "This device";
  }
}

/** Review buttons only change education. They never run a completed setup operation again. */
export function tutorialProgress(index = 0, review = null, onReview = null, stages = SETUP_STAGES) {
  return setupProgress(el, index, review, onReview, stages);
}
