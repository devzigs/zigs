// The words of the Help part of Settings, and the diagnostics text. Help works offline: it holds
// no link and asks for nothing. The diagnostics hold a fixed list of facts and no line of the
// log, which has free text. Display only: nothing here sends anything.

export const HELP = [
  ["What does a payment need?",
    "A payment needs approval from as many devices as the approval rule names, for example 2 of "
    + "3. Each device approves with its own key share. After enough approvals, the devices sign "
    + "together, and then the payment can be sent."],
  ["What if a device is lost?",
    "Keep the devices that still work, and do not delete their data. While enough devices "
    + "remain to meet the approval rule, they can move the Zcash funds to a new wallet. A Solana "
    + "part does not move this way. With fewer devices, first restore devices from their backup "
    + "files. Zigs cannot go around the approval rule. The Recovery section has more."],
  ["Where is my backup file?",
    "A backup file holds the key share of one device. Your browser saves it as a download, "
    + "usually in its download folder. Zigs does not know where. The file is locked with a "
    + "passphrase that you choose. Zigs cannot recover that passphrase. A device with a Solana "
    + "part has two files and two passphrases. Keep each file and its passphrase apart, and make "
    + "sure that you can find both. The Recovery section shows which files this browser saved."],
  ["What do the servers see?",
    "The group server keeps the encrypted data of the wallet. It cannot read the data. It sees "
    + "which IP addresses open which wallet, and when data is sent. The light-wallet server sends "
    + "the blocks to this page. It sees the transactions that you send, and it never sees a "
    + "secret key. It sees your IP address, except that on testnet the Zigs light-wallet server "
    + "sees only the Zigs Worker. That Worker is also the group server, so one operator sees the "
    + "traffic of both. The Solana part also asks Helius. Helius sees your IP address and the "
    + "public keys of this wallet. Unless local proving is on, the hosted prover of Helius also "
    + "sees each Solana payment. The Zigs server operator can link this wallet to its Solana "
    + "addresses by timing."],
  ["How do I read the memos of payments to this wallet?",
    "Turn on Read memos of incoming payments, under This browser. A memo is only in "
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

/**
 * The diagnostics text. `facts` is a list of [name, value] pairs that the page chose: counts,
 * words of a fixed list and facts of the browser. It holds no free text, so no name, note,
 * amount, address, key or link of the wallet can get in.
 */
export const diagnosticsText = (facts) => ["Zigs diagnostics",
  "Made in this browser. Zigs sends nothing.", "",
  ...facts.map(([name, value]) => name + ": " + value)].join("\n");
