# zec-frost

A t-of-n multisignature wallet for Zcash shielded funds that runs in the browser. A group makes one
shared shielded address with a distributed key generation (no dealer). Any t members co-sign a spend
with re-randomized FROST (ZIP 312). On chain, the result is a normal Ironwood transaction: nobody can
see that a group signed it, who the members are, or which members approved.

The status is **prototype, testnet only**. Do not use it with real funds.

## What it does

1. **Key ceremony.** n people open an invite link and take a seat. Their browsers run a 3-round FROST
   DKG over RedPallas. No person and no server ever holds the full spend key.
2. **Shared wallet.** The group gets one unified address (`utest1…`) and one viewing key. Each browser
   checks that the address really belongs to the group key before it trusts it.
3. **Testnet sync.** Each browser syncs Zcash testnet from the wallet's birthday block, finds the
   group's Ironwood notes with the viewing key, and shows the balance. No browser trusts another
   browser or the server for the balance.
4. **Spend.** A member proposes a payment to a recipient address. Each approving browser decodes the
   transaction itself, checks it, and publishes a FROST nonce commitment. When t members approve,
   the browsers sign. Any member then makes the Halo2 proof and broadcasts the transaction.

## Proof on testnet

These transactions were made by the web app with 2-of-2 groups (NU7 testnet, V6, Ironwood):

| txid | What |
|---|---|
| [`4838de4c…6612`](https://testnet.zcashexplorer.app/transactions/4838de4c250d85c82657a600bd9886b75080711c37723c7a07f311c96f046612) | First FROST spend, block 4,485,020 |
| [`86807799…45fd`](https://testnet.zcashexplorer.app/transactions/86807799c1393829e9de9b1158caa0285d198797c4194b2520f23a713b4f45fd) | Payment to an end-to-end encrypted group, block 4,485,097 |
| [`9859c24b…2409`](https://testnet.zcashexplorer.app/transactions/9859c24b961bb196f9a1de74cc099c32d4f2c9812c12a2db47a504cb88ff2409) | Spend from the encrypted group, block 4,485,106 |

## Privacy model

What each party can see:

| Party | Sees | Does not see |
|---|---|---|
| Chain observers | A normal shielded Ironwood transaction | That it is a multisig, members, amounts, addresses |
| Group server (Cloudflare Durable Object) | Group ids, document paths, field names, timing, an opaque user id per browser | Group names, member names, addresses, viewing key, amounts, recipients, PCZTs, signing data |
| lightwalletd proxy | Your IP address, the birthday height, the block ranges you download, the transactions you broadcast | Which notes are yours (every browser downloads all compact blocks) |
| Other group members | Everything about the group wallet | Your key share and your signing nonces |

How the group server is kept blind:

- `createGroup` makes a 32-byte group secret. The invite link is `<site>/#<group-id>.<secret>`.
  Browsers never send the URL fragment to a server. The page saves the secret in local storage and
  removes it from the address bar.
- Every field of every group document is sealed separately with XChaCha20-Poly1305. The key is
  BLAKE2b of the group secret (personal `zf-store-v1`). The AAD is the document path plus the field
  name, so the server cannot move a value to another document or field.
- DKG round-2 packages are also sealed point to point with X25519 keys, so only the receiver can
  read its share.

Known metadata leaks, accepted for the prototype: group ids, field names, document counts and
timing are visible to the server; the proxy sees IP and timing (use Tor or your own lightwalletd to
remove this); the invite link is a bearer secret (anyone with the full link can read the group).

## Try it

The live demo is at https://app.zigs.app (password protected; ask the author).

1. Create a group (for example 2-of-2) and click **Copy invite link**. Send the link to the other
   members. On your own, click **Also play this seat** to play every seat from one browser.
2. When every seat is taken, the ceremony runs by itself. Each browser shows **Verified wallet**.
3. Fund the address with testnet TAZ, for example from the
   [Valar faucet](https://github.com/valargroup/valar-testnet-faucet). Wait for 3 confirmations.
4. Propose a spend, approve it from t seats, click **Build proof and finish**, then **Broadcast**.

Key shares stay in the browser that made them. Use **Back up key share** to keep a copy.

## Run locally

Needs Rust with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.129, LLVM with a wasm32
target (for `secp256k1-sys`), and Node.js.

```bash
cd wasm
CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang \
AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar \
RUSTFLAGS="--remap-path-prefix=$HOME=/build" \
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir ../web/pkg target/wasm32-unknown-unknown/release/zec_frost_wasm.wasm
cargo test --release
```

```bash
cd cf
npm install
echo DEV_NO_AUTH=1 > .dev.vars
npx wrangler dev --port 8787
```

Open http://localhost:8787. To act as a second person on the same computer, open
http://127.0.0.1:8787 (a separate origin, so separate local storage).

To deploy: `npx wrangler secret put APP_PASSWORD`, then `npx wrangler deploy` in `cf/`.

### iOS app (prototype)

The iOS app in `ios/` uses the same Rust engine through a C interface (`wasm/src/ffi.rs`) and the
same group protocol, so iPhones and browsers can sit in one group. It joins groups from invite
links, runs the key ceremony, approves and signs payments, builds the proof natively and
broadcasts. Proposing payments and syncing the balance stay in the web app for now.

Needs Xcode 26, XcodeGen, and the Rust targets `aarch64-apple-ios` and `aarch64-apple-ios-sim`.

```bash
cd ios
./build-core.sh
xcodegen generate
open Zigs.xcodeproj
```

The app connects to `http://localhost:8787` by default (change it in Settings). Open an invite
link as `zigs://join#<group-id>.<secret>`, or paste the web invite link in Join.

## How it works

### Keys

An Ironwood full viewing key (FVK) has three parts: `ak`, `nk` and `rivk`.

- `ak` (spend validating key) controls spending. The wallet sets `ak` to the FROST group public key.
  Each person holds only a share of the matching secret `ask`.
- `nk` and `rivk` control viewing only. The creator's browser samples them from a random spending
  key and discards that key's `ask`. Everybody receives the FVK.

The `reddsa` DKG normalizes the group key to even y, as Orchard and Ironwood require.

Each member checks the published wallet: the `ak` in the FVK must equal the group key from their own
DKG output, and the address must re-derive from the FVK. A malicious creator cannot insert its own
`ak`.

### Signing

Each spend has a signature under a randomized key `rk = ak + [alpha]G`. The transaction builder picks
a fresh `alpha` for each spend, so spends are unlinkable to the wallet. Re-randomized FROST adds
`alpha` during signing, so the aggregate signature verifies under `rk`. The wallet runs one FROST
session per spend. All sessions sign the same shielded sighash (ZIP 244, v6).

Before a member publishes a share, their browser:

- Parses the PCZT itself and runs the PCZT Verifier role: `cv_net`, `rk` against the wallet FVK,
  nullifier and note commitment.
- Recomputes the sighash and rejects the package if the sighash or a randomizer differs.
- Checks that nobody replaced their own nonce commitment.
- Shows each output with its value and recipient (change or external).
- Deletes the nonces after use, so a nonce is never used twice.

Any member aggregates the shares with cheater detection (a bad share names its sender). Any member
can then make the Halo2 proof, extract the transaction (which verifies the proof, every spend
authorization signature and the binding signature) and broadcast it.

### Chain access

The WASM engine talks grpc-web to lightwalletd through `https://zcash-testnet.chainsafe.dev`. It
loads the Ironwood note commitment tree frontier at the birthday (`GetTreeState`), streams compact
blocks (`GetBlockRange`), scans them with `zcash_client_backend::scanning::scan_block`, keeps an
in-memory `ShardTree` for Merkle paths, and broadcasts with `SendTransaction`. Spends use anchors with
3 confirmations and the ZIP 317 fee.

## Code layout

| Path | Content |
|---|---|
| `wasm/src/lib.rs` | WASM engine: DKG, wallet creation and verification, PCZT inspection, FROST commit / package / share / aggregate, proof and extraction, store sealing |
| `wasm/src/chain.rs` | Testnet sync, balance, note selection, PCZT creation from real notes, broadcast |
| `web/index.html` | The web app: ceremony, wallet, spends, encrypted store wrapper |
| `web/shim.js` | Store and identity for the Cloudflare deploy |
| `cf/src/index.js` | Cloudflare Worker: static files, password, Durable Object store over WebSocket |
| `src/` | Native CLI version of the ceremony (regtest demo, older crate line) |
| `tests/e2e.sh` | CLI 3-of-5 flows and adversarial tests |

## Dependencies

- NU7 crate line (pre-release, needed for current testnet): `zcash_protocol` 0.11.0-pre.0,
  `zcash_primitives` 0.31.0-pre.1, `pczt` 0.10.0-pre.1, `zcash_keys` 0.17.0-pre.1, `orchard` 0.16.0,
  `zcash_client_backend` 0.25.0-pre.1.
- FROST: `reddsa` at git rev `ed49e9c` (feature `frost`) and `frost-rerandomized` 2.x. `reddsa` 0.6
  removed the `frost` feature; pin the git rev until a `frost-redpallas` crate is released.
- grpc-web: `tonic` 0.14 and `tonic-web-wasm-client` 0.9.

## Tests

- `cargo test --release` in `wasm/`: full 2-of-3 flows for Ironwood and Orchard (including a bad
  share that is attributed to its sender), NU7 testnet branch and V6, note selection and fee, store
  sealing (wrong key and wrong AAD fail), DKG box routing.
- `bash tests/e2e.sh` for the CLI: separate processes, wallet substitution attack, fewer than t
  signers, tampered randomizer and sighash, nonce reuse, wrong share attribution, foreign notes.

## Known limits

- **No persistence of chain state.** Each page load syncs again from the birthday (about 36 s for
  20,000 blocks). Reorgs are not handled.
- **Pending spends.** Notes in a broadcast spend count as unspent until it is mined; a second spend in
  that window is rejected by the node.
- **Randomizer source.** The wallet uses the `alpha` that the transaction builder put in the PCZT, as
  ZF's `zcash-sign` does. Check the final ZIP 312 text before production.
- **No key refresh or repair**, and only diversifier index 0.
- **Pre-release crates.** The NU7 crates are pre-releases and mainnet has no NU7 height yet.
- **Third-party proxy.** The default lightwalletd proxy is run by ChainSafe.

## License

MIT, see [LICENSE](LICENSE).
