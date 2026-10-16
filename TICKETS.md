# Tickets

Open work for Zigs. Each ticket has an id, a priority (P1 high, P2 medium, P3 low), an owner (dev:
an agent or a developer can do it; owner: it needs the project owner's accounts or a decision), and
a "Done when" line. Close a ticket by moving it to "Closed" with the commit or PR that closed it.

## Zolana (Solana) beta in the web app

The web app runs Zolana as a beta: Devnet only, for testnet wallets only, web only. ZOLANA.md is the
design. These tickets list what the beta does not do yet, and what must hold before mainnet.

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| SOL-3 | P1 | owner | Get an audit report, or an equal review, of the pool and the SDK version we pin | A report exists that covers the deployed pool and the pinned SDK commit |
| SOL-4 | P1 | dev | Stop the hosted prover from seeing the witness | Proofs run in the browser or in an attested TEE that the app checks; the nullifier secret never leaves the device. Helius said on 15 October 2026 that browser proving exists but is slow, and that speed is on its roadmap |
| SOL-5 | P2 | dev | Handle a stale proof root during a long approval | The program design solves it on Devnet (ZOLANA.md 6.10): payments settled two hours after their proposals (for one of them, two hours after its approval signature was on chain), after a forced stale root, with a fresh proof and no new signing round. Done when the beta runs that design (SOL-36). Until then, the beta asks for a new proposal |
| SOL-6 | P2 | dev | Allow more than one open Solana payment | The beta runs the program design (SOL-36), where each payment has its own proposal account (several were open at once on Devnet, ZOLANA.md 6.10); the page picks disjoint inputs for open payments, because the first one that lands ends every proposal over the same input; the UI no longer blocks a second proposal |
| SOL-7 | P2 | dev | Pay fees from a separate payer | Shown on Devnet (ZOLANA.md 6.10): the executor pays and the owner PDA signs through the program, with no owner-signer patch of the SDK (the spike builds the transfer with `ConfidentialTransfer` and appends the PDA account itself). Done when the beta runs that design (SOL-36) with a payer for the fee and the proposal rent that the owner accepts (a seat key, a fee key or a sponsor), and the screens name the public link that the payer makes (ZOLANA.md 7.2) |
| SOL-8 | P2 | dev | Share the spent-salt history between devices | Every seat refuses a reused salt from any proposal on the group server, also after a restore |
| SOL-10 | P2 | owner | Set the product values: expiry window, minimum remaining expiry, fee caps, tree fee cap | The values are decided and pinned in the template with tests |
| SOL-11 | P2 | dev | Show the custody limits in the app | The Solana details screen shows the pool upgrade authority and the protocol authority, and says that they sit outside the group |
| SOL-12 | P2 | dev | Make the privacy limits clear in every Solana screen | Each screen says what is public (sender, recipient, deposit and withdrawal amounts) and what Helius sees; PRIVACY.md matches |
| SOL-13 | P3 | dev | Re-run P1 when a published crate has the SIMD-0376 verify | P1 passes with verify_simd0376 |
| SOL-14 | P2 | dev | Add Solana to the iPhone and Mac apps | The apps read the Solana documents and can approve and sign |
| SOL-15 | P2 | dev | Keep the vendored SDK bundle up to date and checked | `solspike/build.mjs` rebuilds the bundle from a Zolana checkout at the pinned commit, and the build needs no local checkout (the source is pinned by hash); the hash of the bundle is in `web/sol/SHA256SUMS`; an update note lists the changes; the dcap-qvl stub still throws |
| SOL-16 | P3 | dev | Support SPL tokens | Shield, transfer and withdraw an SPL token on Devnet with checker rules and tests |
| SOL-17 | P1 | owner | Decide the mainnet go or no-go | SOL-3 and SOL-4 are closed, the owner accepts the open custody and service risks (ZOLANA.md section 7), and signs off ZOLANA.md section 7 |
| SOL-18 | P3 | dev | Help a new group get Devnet SOL for fees | The Solana tab shows the fee address and how to fund it on Devnet |
| SOL-19 | P2 | dev | Bring the checks under the repo's CI rules | CI runs the baseline gate, the `solspike/test` tests, the mock run and `cargo test` of `wasm-sol` with the nine ignored `repo_pins` tests (a pinned Zolana checkout), with no secret in the tree. The live harness sends the app Origin (the key refuses calls with no Origin) |
| SOL-20 | P2 | dev | Get the code of `wasm-sol` that no verifier signed checked by a verifier | A verifier who did not write it signs `src/frost.rs`, `codec.rs`, `sign.rs`, `roles.rs` and `wasm.rs` (CHECKER_PIN lists them as new or modified), with mutation cases for each rule |
| SOL-21 | P3 | dev | Fix the free bytes of a dummy output | A dummy output has no free 89 bytes: the checker derives the blob from a seed, or the template refuses a blob that it cannot recompute |
| SOL-22 | P3 | dev | Accept padded circuits when a wallet needs them | The snapshot names the padding inputs, the checker accepts compact and random padding with rules and tests |
| SOL-23 | P3 | dev | Remove the secrets of a Solana session from wasm memory, and read a key share text without a timing leak | The snapshot secrets are zeroized after use; `share_fits` reads the text in constant time or a note states why that is not needed |
| SOL-24 | P2 | owner | Decide how the Helius key is guarded | The owner picks Allowed Domains only (the beta today: every user of the page can read the key) or a proxy host that keeps it; the choice and its privacy cost (ZOLANA.md 3.5) are written down |
| SOL-26 | P3 | dev | Let the page retry a failed Solana load | After a failed fetch of `/sol/config.json` the tab offers a retry, and a retry does not loop on its own |
| SOL-27 | P3 | dev | Test the checker with a landed payment and its blinding seed | A Devnet payment is landed with its root blinding seed recorded, and the checker accepts the landed message and every one of its rules |
| SOL-29 | P3 | dev | Check that `web/sol/wasm` equals the build of `wasm-sol` | A check runs `wasm-sol/build.sh` in a clean tree and compares the hash of the wasm with the committed file and with CHECKER_PIN |
| SOL-30 | P1 | dev | Run the live Devnet scenarios from this tree | `solspike/harness/scenario-f.mjs` (payment, restore, second payment) and `sol-live.mjs` pass on Devnet from this repo, with the Helius URL from `cf/.dev.vars`. The Helius key accepts only the app Origin, so the harness takes ORIGIN, an https server option and the Chrome host mapping from the environment, `tools/key-b.mjs` sends the app Origin, and `live-check.mjs` accepts `wss://` under https. A live run of the beta passed on 2026-10-15 with adapters outside the repo |
| SOL-31 | P3 | dev | Make a test kill the mutant S-part-chain | `solspike/tools/mutate.mjs S-part-chain` is killed: a test shows that a signed part with no package, and a sent mark with no signed part, do not count. Today the lonely sessions of `web/test/sol-sessions.mjs` share the nonce of a landed one, so the rule that ends them hides the part chain rule (the mutant also survives in the spike tree) |
| SOL-32 | P2 | dev | Add withdrawal to a public address to the web beta | The page proposes a withdrawal (intent tag 4 of wasm-sol) with a public recipient and amount, every seat sees them, the page checks the new intent, tests cover it, a Devnet run lands one withdrawal, and ZOLANA.md section 2 and the screen text match. The engine and a script withdrew on Devnet; the page cannot yet |
| SOL-33 | P3 | dev | Pin the network of a wallet in the iPhone and Mac apps | The apps keep the first `network` that they see for a wallet in `zf-signpins` (key `network:<wallet id>`, as the web app does) and warn when the store shows another; a Swift check changes the field |
| SOL-34 | P2 | dev | Pin the network from data the people confirmed | The network pin keeps the first value a device sees, and no device had a pin before the beta. A link holder who writes "testnet" into a mainnet group document before a device first loads it makes that device show the Solana tab. Take the network from the values that the safety number covers (the Solana ceremony already refuses on that check), and test a flip that comes before the first load |
| SOL-36 | P1 | dev | Move the beta to approvals owned by a program, before durable nonces end | Before the deprecation date that Solana announces, the beta signs approval digests of proposal accounts and needs no nonce account. The five conditions of the decision in ZOLANA.md 7.2 hold first: withdrawals through the program with the settlement accounts in the commitment check, the new `wasm-sol` rules and the option D keys, one migration payment to the PDA address, a fee payer, and a review of the program plus the owner's decision on its upgrade key |

## Zcash NU7

NU7 disallows v4 transactions, moves to 25-second blocks and ships the Network Sustainability
Mechanism. Zigs builds only v6 (and reads v5) transactions, so the v4 change does not touch it, and
the nodes handle the NSM.

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| ZEC-1 | P1 | dev | Update the Zcash crates as soon as a release sets the NU7 mainnet height | The pinned zcash_protocol gives NU7 a mainnet height (it is None today; testnet is 4,465,026); BranchId::for_height on mainnet after activation gives Nu7 in a test; the engine wasm and the iPhone and Mac library are rebuilt |
| ZEC-2 | P1 | dev | Fit the transaction expiry to group approvals | Today a proposal expires at target height + 40 (the builder default): about 17 minutes at 25-second blocks, on testnet now and on mainnet after NU7. The expiry window is a product value that covers a normal approval, the approval screen shows it, and an expired proposal ends with a clear "propose again" step |
| ZEC-3 | P2 | dev | Take the marginal fee from the server instead of a constant | The fee comes from the node's getstandardfee answer (through the light-wallet servers or a small endpoint) and no longer from the constant 5,000 zatoshis in wasm/src/chain.rs and the ZIP 317 fee rule; the approval check accepts it only inside fixed bounds |
| ZEC-4 | P2 | dev | Let the proposer pay more for inclusion | The propose form offers a priority fee of 10 times the standard fee; every approving device shows it and refuses a fee above a fixed cap |
| ZEC-5 | P3 | dev | Use the right block time for each network and height | Time estimates use 75 seconds before NU7 and 25 seconds after it (web/app.js has a constant of 25 for every network) |
| ZEC-6 | P1 | owner | Upgrade the light-wallet servers for NU7 before mainnet activation | The Zakura node and lightwalletd that the app uses run NU7 versions on testnet and mainnet |

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
| AIR-1 | P2 | dev | Run the spike plan for air-gapped signing | The design lands in a separate change. The spike steps in it pass their acceptance criteria |

## iPhone and Mac

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| APP-1 | P3 | dev | Match the key ceremony box error of the web app | `GroupModel.openBox` says that another version of Zigs made the message, and a version 1 `round3` ends the seat's setup on a box error instead of retrying; a Swift check covers both |
| APP-2 | P3 | dev | Name the right cause when a ceremony box cannot be checked | `openBox` in web/app.js reads the sender's box key inside its try, so a missing seat document gives "made by another version of Zigs" and, in version 1, ends the setup. Read the key before the try and say that the seat document is missing |

## EVM (frozen)

| Id | P | Owner | Title | Done when |
|---|---|---|---|---|
| EVM-1 | P3 | owner | Decide when to thaw the EVM design | The owner restarts EVM.md after the Zcash and Zolana work is done. The first step is then the Railgun spike on Sepolia (EVM.md section 7, R1 to R10), with no funds |

## Closed

| Id | Title | Closed by |
|---|---|---|
| SOL-1 | Allowed Domains set on the app's Helius key. Checked 2026-10-15: a call with the app Origin gets 200; another Origin and no Origin get 403; CORS preflights pass. The SDK uses no WebSocket | owner, checked by dev |
| SOL-28 | Build the hasher wasm without the build paths of its author | `withoutHomePaths` in `solspike/build.mjs` replaces the home path of the upstream author in the panic text with a neutral text of the same length. `SHA256SUMS` holds the hashes of the cleaned files, and `solspike/test/build.test.mjs` checks it |
| SOL-25 | Pin the network of a wallet in the page | `pinNetwork` in `web/app.js` keeps the first `network` that the device saw, for every wallet version, in `zf-signpins` (key `network:<wallet id>`), and the wallet page warns when the store shows another. `solOn` also needs version 3, and the page loads `web/sol` for a start document only when seat 1 signed it (`solReact`). `web/test/sol-ceremony.mjs` flips the stored network of a mainnet version 3 wallet and of a version 2 wallet, and writes start documents that no seat signed |
| SOL-9 | Refuse a dummy output placed before a real output in the checker | The rule `dummies-last` of `wasm-sol` (the spike step P8b), with `tests/slot_order.rs` and mutation cases |
| SOL-2 | Not asked: the owner decided on 16 October 2026 not to ask Helius about key holders, mainnet service and the audit. Question 6 was answered on 15 October 2026 | owner decision |
| SOL-35 | Spike approvals owned by a program, as in the Helius minimal multisig | Devnet spike of 16 October 2026, ZOLANA.md 6.10 (signatures and results) and 7.2 (design, decision: go with five conditions, carried by SOL-36). Program `5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL` stays on Devnet; its upgrade key is outside the repo |
