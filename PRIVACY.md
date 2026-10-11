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

The code is `build_ironwood_pczt` and `spend_pczt` in `wasm/src`.

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
writes nothing about requests. IP addresses are used in memory only, to apply rate limits.
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

To remove this risk entirely, use Tor Browser, or point the app at a light-wallet server you
trust (`NETWORKS` in `web/index.html`, `ZcashNetwork` in `ios/Zigs/Chain.swift`).

## Your device

| Data | Web app | iPhone and Mac app |
|---|---|---|
| Key share, signing nonces | Browser local storage | iPhone: Keychain, this device only, not in backups. Mac: login keychain |
| Wallet secrets (from invite links) | Browser local storage | Same as the key share |
| Sync state (notes, tree) | IndexedDB, sealed with the wallet key | File, sealed with the wallet key |
| Cached balances for the wallet list | Local storage, sealed with the wallet key | Settings, sealed with the wallet key |

Anyone who controls your unlocked device can read your key share and wallet secrets. One share
alone cannot move funds: a payment needs a full threshold of signers.

## Signers and invite links

- An invite link contains the wallet secret. Anyone who has the full link can read the wallet's
  data and take an open seat. Send links only through an end-to-end encrypted chat, such as Signal.
- Every signer holds the wallet's viewing key and sees every payment. A signer removed with
  "Change signers" keeps the old wallet's history but gets no access to the new wallet: the old
  wallet stores only the new wallet's id, never its secret.

## Not protected

- A threshold of signers who agree can move the funds. That is the rule they chose.
- A compromised device can sign with its own share, and can show its user false information.
  Each approving device decodes the transaction itself and checks the recipient, so one honest
  signer sees the true payment.
- The group server can refuse service or drop messages. It cannot forge or read them.
- Chain reorganisations are not handled in the sync state yet.
- The code is not audited. Mainnet wallets are limited to 0.5 ZEC: at that balance the app stops
  showing the address and warns. It cannot stop someone from sending more, and payments out
  always stay possible.

## Checks

- Engine tests: sealed values of different lengths have the same size, old unpadded values still
  open, and tampered or misplaced values are rejected (`cargo test` in `wasm/`).
- Testnet transactions made by the web, iPhone and Mac apps are listed in the README.
