// The words of the Help part of Settings, and the diagnostics text. Help works offline: it holds
// no link and asks for nothing. The diagnostics hold a fixed list of facts and the recent events
// of this browser with every long token hidden. Display only: nothing here sends anything.

export const HELP = [
  ["What does a payment need?",
    "A payment needs approval from as many devices as the approval rule names, for example 2 of "
    + "3. Each device approves in its own browser. After enough approvals, the devices sign "
    + "together, and then the payment can be sent."],
  ["What if a device is lost?",
    "Keep the devices that still work, and do not delete their data. While enough devices "
    + "remain to meet the approval rule, they can move the Zcash funds to a new wallet. A Solana "
    + "part does not move this way. With fewer devices, first restore devices from their backup "
    + "files. Zigs cannot go around the approval rule. The Recovery section has more."],
  ["Where is my backup file?",
    "A backup file holds the key share of one device. It is locked with a passphrase that you "
    + "choose. Zigs cannot recover that passphrase. Keep the file and the passphrase apart, and "
    + "make sure that you can find both. The Recovery section shows which files this browser "
    + "saved."],
  ["What do the servers see?",
    "The group server keeps the encrypted data of the wallet. It cannot read the data, and it "
    + "sees when data is sent. The light-wallet server sends the blocks to this page. It sees "
    + "your IP address, and never a key. The Solana part also asks Helius, which sees your IP "
    + "address and the keys of this wallet."],
  ["How do I read the memos of payments to this wallet?",
    "Turn on Read memos of incoming payments, under This app on this device. A memo is only in "
    + "the full transaction, so this browser then asks the light-wallet server for each "
    + "transaction that pays this wallet. That server learns which transactions pay this wallet. "
    + "The setting is off until you turn it on."],
  ["Why is my payment not done yet?",
    "A payment goes through these steps: approval, signing, proof, send, and then block "
    + "confirmations. Open the payment in Approvals or Activity to see its step. A payment can "
    + "need a few blocks to confirm. Do not pay again while it shows Confirming."],
  ["Which networks does Zigs use?",
    "This beta works on Zcash testnet and Solana Devnet. The coins on these networks are for "
    + "tests. Zigs is not audited."],
];

const LONG = 20;
const HEX_RUN = /[0-9a-f]{12}/i;
const EVENTS = 20;

/**
 * Hides each token of `text` that can be a secret, a key, an address, a link, an id or a part
 * of one: a run of 20 or more characters without a space, or a token with 12 hex digits in a row.
 * A plain word is shorter than 20 characters and stays.
 */
export const redact = (text) => String(text).replace(/\S+/g, (token) =>
  token.length >= LONG || HEX_RUN.test(token) ? "[hidden]" : token);

/**
 * The diagnostics text. `facts` is a list of [name, value] pairs that the page chose, so a fact
 * holds no free text. `events` are the recent lines of the log, newest first; they come from
 * many places, so each one goes through redact.
 */
export function diagnosticsText(facts, events) {
  const shown = events.slice(0, EVENTS).map((line) => "  " + redact(line));
  return ["Zigs diagnostics", "Made in this browser. Zigs sends nothing.", "",
    ...facts.map(([name, value]) => name + ": " + value), "",
    shown.length ? "Recent events (long tokens hidden):" : "No recent events.", ...shown,
  ].join("\n");
}
