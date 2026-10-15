# Tickets

Open work for Zigs. Each ticket has an id, a priority (P1 high, P2 medium, P3 low), an owner
(dev: an agent or a developer can do it; owner: it needs the project owner's accounts or a decision),
and a "Done when" line. Close a ticket by moving it to "Closed" with the commit or PR that closed it.

## Zolana (Solana) beta in the web app

The web app runs Zolana as a beta: Devnet only, for testnet wallets only, web only. ZOLANA.md is the
design. These tickets list what the beta does not do yet, and what must hold before mainnet.

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| SOL-2 | P1 | owner | Get answers from Helius to ZOLANA.md questions 2, 3, 5 and 6 | Written answers on the upgrade key holder, mainnet service and limits, audit scope and timelock, root window and durable nonces |
| SOL-3 | P1 | owner | Get an audit report, or an equal review, of the pool and the SDK version we pin | A report exists that covers the deployed pool and the pinned SDK commit |
| SOL-4 | P1 | dev | Stop the hosted prover from seeing the witness | Proofs run in the browser or in an attested TEE that the app checks; the nullifier secret never leaves the device. ZOLANA.md question 4 (attestation, local proving) is answered |
| SOL-5 | P2 | dev | Handle a stale proof root during a long approval | The product decides between "approve again" and "devices sign again for the approved intent"; the UI says what happens; a test forces a stale root |
| SOL-6 | P2 | dev | Allow more than one open Solana payment | More nonce accounts, or a queue; the UI no longer blocks a second proposal |
| SOL-7 | P2 | dev | Pay fees from a separate payer | The group key is not the fee payer; the TS SDK owner-signer patch is upstream or vendored; ZOLANA.md question 1 is answered |
| SOL-8 | P2 | dev | Share the spent-salt history between devices | Every seat refuses a reused salt from any proposal on the group server, also after a restore |
| SOL-10 | P2 | owner | Set the product values: expiry window, minimum remaining expiry, fee caps, tree fee cap | The values are decided and pinned in the template with tests |
| SOL-11 | P2 | dev | Show the custody limits in the app | The Solana details screen shows the pool upgrade authority and the protocol authority, and says that they sit outside the group |
| SOL-12 | P2 | dev | Make the privacy limits clear in every Solana screen | Each screen says what is public (sender, recipient, deposit and withdrawal amounts) and what Helius sees; PRIVACY.md matches |
| SOL-13 | P3 | dev | Re-run P1 when a published crate has the SIMD-0376 verify | P1 passes with verify_simd0376 |
| SOL-14 | P2 | dev | Add Solana to the iPhone and Mac apps | The apps read the Solana documents and can approve and sign |
| SOL-15 | P2 | dev | Keep the vendored SDK bundle up to date and checked | `solspike/build.mjs` rebuilds the bundle from a Zolana checkout at the pinned commit, and the build needs no local checkout (the source is pinned by hash); the hash of the bundle is in `web/sol/SHA256SUMS`; an update note lists the changes; the dcap-qvl stub still throws |
| SOL-16 | P3 | dev | Support SPL tokens | Shield, transfer and withdraw an SPL token on Devnet with checker rules and tests |
| SOL-17 | P1 | owner | Decide the mainnet go or no-go | SOL-1 to SOL-4 are closed and the owner signs off ZOLANA.md section 7 |
| SOL-18 | P3 | dev | Help a new group get Devnet SOL for fees | The Solana tab shows the fee address and how to fund it on Devnet |
| SOL-19 | P2 | dev | Bring the checks under the repo's CI rules | CI runs the baseline gate, the `solspike/test` tests, the mock run and `cargo test` of `wasm-sol` with the nine ignored `repo_pins` tests (a pinned Zolana checkout), with no secret in the tree. The live harness sends the app Origin (the key refuses calls with no Origin) |
| SOL-20 | P2 | dev | Get the code of `wasm-sol` that no verifier signed checked by a verifier | A verifier who did not write it signs `src/frost.rs`, `codec.rs`, `sign.rs`, `roles.rs` and `wasm.rs` (CHECKER_PIN lists them as new or modified), with mutation cases for each rule |
| SOL-21 | P3 | dev | Fix the free bytes of a dummy output | A dummy output has no free 89 bytes: the checker derives the blob from a seed, or the template refuses a blob that it cannot recompute |
| SOL-22 | P3 | dev | Accept padded circuits when a wallet needs them | The snapshot names the padding inputs, the checker accepts compact and random padding with rules and tests |
| SOL-23 | P3 | dev | Remove the secrets of a Solana session from wasm memory, and read a key share text without a timing leak | The snapshot secrets are zeroized after use; `share_fits` reads the text in constant time or a note states why that is not needed |
| SOL-24 | P2 | owner | Decide how the Helius key is guarded | The owner picks Allowed Domains only (the beta today: every user of the page can read the key) or a proxy host that keeps it; the choice and its privacy cost (ZOLANA.md 3.5) are written down |
| SOL-25 | P3 | dev | Pin the network of a wallet in the page | `trustShape` pins `network` as it pins `n` and `t`, so that a holder of the invite link cannot show the Solana tab of a mainnet wallet; a test changes the field |
| SOL-26 | P3 | dev | Let the page retry a failed Solana load | After a failed fetch of `/sol/config.json` the tab offers a retry, and a retry does not loop on its own |
| SOL-27 | P3 | dev | Test the checker with a landed payment and its blinding seed | A Devnet payment is landed with its root blinding seed recorded, and the checker accepts the landed message and every one of its rules |
| SOL-29 | P3 | dev | Check that `web/sol/wasm` equals the build of `wasm-sol` | A check runs `wasm-sol/build.sh` in a clean tree and compares the hash of the wasm with the committed file and with CHECKER_PIN |
| SOL-30 | P1 | dev | Run the live Devnet scenarios from this tree | `solspike/harness/scenario-f.mjs` (payment, restore, second payment) and `sol-live.mjs` pass on Devnet from this repo, with the Helius URL from `cf/.dev.vars`. They ran in the spike tree only, with a browser setting that no longer exists |
| SOL-31 | P3 | dev | Make a test kill the mutant S-part-chain | `solspike/tools/mutate.mjs S-part-chain` is killed: a test shows that a signed part with no package, and a sent mark with no signed part, do not count. Today the lonely sessions of `web/test/sol-sessions.mjs` share the nonce of a landed one, so the rule that ends them hides the part chain rule (the mutant also survives in the spike tree) |

## Privacy

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| PRIV-1 | P1 | owner | Change the registrant address of the domain to a non-identifying, accurate address | WHOIS and RDAP for the domain show the new address |
| PRIV-2 | P1 | owner | Remove the GitHub-made commits from main in both repos | Main in devzigs/zigs-site has no merge commit made by GitHub, and main in devzigs/zigs has no commit with a GitHub committer; the pre-push hooks pass on main |
| PRIV-3 | P1 | owner | Recreate both repos from clean history before either one goes public | New repos hold only clean commits; GitHub serves no old commit by hash |
| PRIV-4 | P2 | dev | Rename the Cloudflare Worker of the app | The Worker has a new name, its Durable Object data moved with a transfer migration, and a rehearsal on wrangler dev passed |
| PRIV-5 | P3 | owner | Rename or remove the old workers.dev account subdomain | The account subdomain has a neutral name or is off |
| PRIV-6 | P3 | owner | Check that the project's design pages in the owner's AI account are private | Each one is private or deleted |

## Air-gapped signing

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| AIR-1 | P2 | dev | Run the spike plan in AIRGAP.md | The spike steps pass their acceptance criteria |

## Closed

| Id | Title | Closed by |
|---|---|---|
| SOL-1 | Allowed Domains set on the app's Helius key. Checked 2026-10-15: a call with the app Origin gets 200; another Origin and no Origin get 403; CORS preflights pass. The SDK uses no WebSocket | owner, checked by dev |
| SOL-28 | Build the hasher wasm without the build paths of its author | `withoutHomePaths` in `solspike/build.mjs` replaces the home path of the upstream author in the panic text with a neutral text of the same length. `SHA256SUMS` holds the hashes of the cleaned files, and `solspike/test/build.test.mjs` checks it |
| SOL-9 | Refuse a dummy output placed before a real output in the checker | The rule `dummies-last` of `wasm-sol` (the spike step P8b), with `tests/slot_order.rs` and mutation cases |
