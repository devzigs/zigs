# Zigs privacy model

Zigs is a shared wallet for shielded Zcash. This document states what each party can learn, what
Zigs does about it, and what it does not protect. If you find a leak that is not listed here, it
is a bug: please report it.

## Summary

- On chain, a Zigs payment looks like a payment from any standard Zcash wallet. Nothing shows that
  a group signed it, who the signers are, or which of them approved.
- The group server relays and stores encrypted data. It cannot read wallet names, signer names,
  addresses, amounts, notes, recipients or transactions. It does see who connects, to which
  wallet, and when.
- The light-wallet server sees your IP address and the blocks you download, as it does for every
  light wallet. It never receives a key.

## On chain

A payment is an Ironwood (v6) transaction with re-randomized FROST signatures (ZIP 312). The group
key is re-randomized for each spend, so the signature verifies like a single-signer RedPallas
signature under a fresh key.

The transaction shape matches the standard wallet library (`zcash_client_backend`), which Zodl
uses. We checked each visible property:

| Property | Zigs | Standard wallet library |
|---|---|---|
| Transaction builder | `zcash_primitives` `Builder` | Same builder |
| Expiry | Target height + 40 | Same (`DEFAULT_TX_EXPIRY_DELTA`) |
| Action padding | `BundlePadding::DEFAULT` | Same default |
| Fee | ZIP 317 standard rule | Same |
| Anchor | Target height − 3 (3 confirmations) | Same (`ConfirmationsPolicy` trusted = 3) |
| Change | One note to the wallet's internal address | Same |
| Memos | Empty | Empty unless the user writes one |
| Transparent parts | None | None for a shielded payment |
| Several recipients | One output per recipient, plus change | Same for a multi-recipient payment (ZIP 321) |

The code is `build_ironwood_pczt` and `spend_pczt` in `wasm/src`.

The number of actions is visible on chain, as for every Zcash transaction: it is the larger of
the inputs and the outputs, at least 2. A payment to 4 recipients has at least 5 actions, so it
shows that it is a larger payment, but not who or how much.

## Group server (Cloudflare Worker and Durable Objects)

Every field of every wallet document is encrypted on the device with XChaCha20-Poly1305. The key
comes from the wallet secret in the invite link, which the server never receives. The document
path and field name are bound into each ciphertext, so the server cannot move a value elsewhere.

Values are padded before encryption to at least 64 bytes and then to the next power of two. The
server cannot tell a 0.005 ZEC payment from a 50 ZEC one, or a short note from a long one.

What the server can still see:

| Visible | Why | Mitigation |
|---|---|---|
| Wallet ids, document paths and field names | The store routes and merges by path and field | None yet. Field names show the step a payment is at (proposed, signed, sent). |
| Timing of every write | Writes happen when people act | None |
| Which IP addresses connect to which wallet | Each wallet has its own connection | Use Tor Browser, or a VPN, to hide your IP address |
| Number of signers and payments | Count of documents | None |

The server keeps no logs: Workers Logs are off (`observability.enabled = false`), and the code
writes nothing about requests. IP addresses are used in memory only: to apply rate limits, and as
a tag on each open WebSocket.
Cloudflare, as the host, can see connection metadata.

## Light-wallet server (lightwalletd)

The app downloads compact blocks and finds the wallet's notes on the device. The server sees:

- your IP address and the time of each request;
- the wallet's birthday height (the first sync asks for the tree state there);
- the transactions you send, and from which IP address.

It does not learn which notes or outputs are yours: every wallet downloads the same blocks.

If one operator runs both the group server and the light-wallet server, they can match the moment
a wallet marks a payment as sent with the transaction that reaches the network at that moment.
This links a wallet id to a transaction id, but not to its amount or recipient.

- **Mainnet** wallets use ChainSafe's public light-wallet server, so the two servers have
  different operators.
- **Testnet** wallets use the Zigs light-wallet server first, with ChainSafe as the backup.

Tor Browser hides your IP address from both servers, but not this timing link. To remove the
link, point the app at a light-wallet server you trust (`NETWORKS` in `web/app.js`,
`ZcashNetwork` in `ios/Zigs/Chain.swift`).

## Use Zigs over Tor

The web app is prepared to run in Tor Browser, so that neither server sees your IP address. A full
session in Tor Browser has not been tested yet.

1. Set the security level to **Standard**. The Safer and Safest levels turn off WebAssembly, and
   Zigs needs it for its cryptography. The app says so if it is off.
2. Tor Browser deletes all site data when it closes, including your key share. After the wallet
   is created, click **Back up key** in the yellow note. At the start of each session, click
   **Restore from backup**. The backup file is not encrypted: keep it offline.
3. Finish each approval in one session. If Tor Browser closes between your approval and the group
   signature, the approval is lost. The payment shows this, and someone proposes it again.

What makes this safe to rely on:

- The page sends a Content-Security-Policy header. The browser lets it connect only to the group
  server and the three light-wallet servers in `NETWORKS`, and to nothing else.
- A restored seat works in a new session. The app checks the restored key share against the key
  data the wallet published for that seat, and a proposal records the seat's identity, not the
  session's.
- Backups leave out signing nonces, and a restore drops the nonces in older backup files, so a
  restored copy cannot reuse one.
- The backup note goes away when the file is offered for download. The app cannot tell whether
  you saved it.

Not tested yet: a full session in Tor Browser, whether the light-wallet servers accept
connections from every Tor exit, and whether many Tor users on one exit reach the group server's
per-IP rate limits.

## Your device

| Data | Web app | iPhone and Mac app |
|---|---|---|
| Key share, signing nonces | Browser local storage; sealed with a passkey when the lock is on | iPhone: Keychain, this device only, not in backups; sealed behind Face ID when the lock is on. Mac: login keychain |
| Wallet secrets (from invite links) | Same as the key share | Same as the key share |
| Sync state (notes, tree) | IndexedDB, sealed with the wallet key | File, sealed with the wallet key |
| Cached balances for the wallet list | Local storage, sealed with the wallet key | Settings, sealed with the wallet key |

Without the lock, anyone who controls your unlocked device can read your key share and wallet
secrets. One share alone cannot move funds: a payment needs a full threshold of signers.

### Lock with a passkey or Face ID

A passkey cannot sign for the wallet: it signs with P-256, and FROST for Zcash uses RedPallas. So
the passkey guards the key share instead. The lock is opt-in.

- **Web:** "Lock with a passkey" makes a passkey for the site. The WebAuthn PRF extension gives a
  32-byte secret on each Face ID, Touch ID or security key check. That secret is the AES-256-GCM
  key for one sealed record that holds the key shares, the signing nonces and the wallet secrets.
  The plain copies are deleted only after the sealed record opens. The page asks for the passkey
  each time it opens (`web/vault.js`).
- **iPhone:** "Lock with Face ID" in Settings puts a random 256-bit key in the Keychain with a
  user-presence rule, so iOS gives it out only after Face ID or the passcode. The secrets are
  sealed with that key (AES-GCM). The app asks once each time it starts.
- Signing steps that run without a click still work, because the lock opens once per session.
- Someone who reads the browser storage or the Keychain gets only the sealed record.
- If the passkey is lost, the locked seats in that browser are lost. Restore them from a backup
  file, or rely on the other signers. On iPhone, turning off the device passcode deletes the key.
- The Mac app does not offer the lock yet: its ad-hoc signature does not allow Keychain access
  rules. A Developer ID build is necessary.
- Not all browsers support the PRF extension. Current Chrome, Edge and Safari do. Other browsers
  show a clear error, and the keys stay as they are.

## Signers and invite links

- An invite link contains the wallet secret. Anyone who has the full link can read the wallet's
  data and take an open seat. Send links only through an end-to-end encrypted chat, such as Signal.
- Every signer holds the wallet's viewing key and sees every payment. A signer removed with
  "Change signers" keeps the old wallet's history but gets no access to the new wallet: the old
  wallet stores only the new wallet's id, never its secret.

## Not protected

- A threshold of signers who agree can move the funds. That is the rule they chose.
- A compromised device can sign with its own share, and can show its user false information.
  Each approving device decodes the transaction itself. It ties every output that carries value
  to the recipient it shows, checks that the outputs are exactly the listed recipients and
  amounts, and refuses a transaction that moves more than the standard fee out of the shielded
  pool. Each approval is tied to the transaction's sighash: the device signs later only if the
  transaction is still the one it approved, and otherwise marks the payment failed. So one honest
  signer sees the true payment.
- A signer checks the wallet address against its own key share and keeps the result on its
  device. If the wallet document in the store changes, the device checks it again. Other signers'
  "checked" marks are their claims. A seat approves a payment only after its own check passed.
- A move to a new wallet shows as checked only when this device holds a seat in the new wallet
  and that seat checked its address. A person who opens a wallet link without a seat sees the
  store's address, and nothing checked it.
- The group server can refuse service, drop messages or replay old ones. It cannot read them or
  write new ones.
- Chain reorganisations are not handled in the sync state yet.
- The code is not audited. Mainnet wallets are limited to 0.5 ZEC: at that balance the app stops
  showing the address and warns. It cannot stop someone from sending more, and payments out
  always stay possible.

## Checks

- Engine tests: sealed values of different lengths have the same size, old unpadded values still
  open, and tampered or misplaced values are rejected (`cargo test` in `wasm/`).
- Testnet transactions made by the web, iPhone and Mac apps are listed in the README.
