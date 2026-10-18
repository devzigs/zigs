# Zigs hackathon release checklist

Release scope: Zcash testnet and Solana Devnet. Mainnet is out. Base: main 950a88b. Sources: five audits of the demo flows (setup, Zcash, Solana, devices, polish), 18 October 2026.

Evidence marked "checked" was read in the repo during this synthesis. All other evidence comes from the audits. See section 10 for what nobody verified.

## 1. How to read this list

- **MUST:** the demo breaks or misleads on the demo path without the item, or the owner asked for it.
- **SHOULD:** a visible rough edge, or a failure that needs a user mistake. Each SHOULD has a preparation step as mitigation.
- **NICE:** the demo works without it.
- Duplicates are merged. The strongest evidence stays.

## 2. Totals

| Class | Items |
|---|---|
| MUST | 10 |
| SHOULD | 18 |
| NICE | 11 (not planned) |

- M3 (unified setup) and M10 (ZNS) are the largest items. M4 is part of the gate that M3 needs.
- Section 7 gives the order and the dependencies of the packages.

## 3. Owner decisions

1. **D1 Preview password.**
   - Option A: add "ask <host> for the password" to the invite texts (S10). This is the recommendation.
   - Option B: lift the gate for the demo. PRIV-8 (TICKETS.md:135) says the gate protects /lwd and the Helius key (SOL-24).
2. **D2 ZEC-13 hold.** Decide whether to keep the hold after Approve then Cancel, or to release it on testnet (S7).
3. **D3 Existing mainnet wallets** (README.md:281). The switch in M1 hides creation only. Existing wallets stay readable.
4. **D4 Helius.**
   - Add every demo origin to Allowed Domains (SOL-48).
   - Read the plan limits.
   - Set a usage alert.
   - Decide SOL-24 (key readable by every page user) for the demo days.
5. **D5 lwd box.** Power it on, or accept the ChainSafe fallback (works, but slower: S9).
6. **D6 WS_PER_IP.** Pick the value for demo day and the date to revert it (M9).
7. **D7 Unified setup cut line.** Step 9 of M3 may be deferred. See the fallback in M3.

**Decided by the owner on 18 October 2026:**

- D1: keep the password gate. The invite texts and the README say that the browser asks for a
  password and that the host gives it (S10).
- D2: S7 as written. When t = n and this seat made no share, the hold ends. Otherwise the hold
  stays, the page says why and shows the time left, and it offers a confirmed "I checked, release".
- D3: existing mainnet wallets stay readable. M1 hides the creation of new ones only.
- D4: the owner adds app.zigs.app and staging.zigs.app to the Allowed Domains of the Helius key,
  reads the plan limits and sets a usage alert. The key stays readable behind the gate (SOL-24).
- D5: the ChainSafe fallback day to day. The owner powers on the lwd box for the demo week.
- D6: WS_PER_IP goes from 60 to 600 for the demo week, and back after it.
- D7: step 9 of M3 is deferred.

## 4. MUST items

### M1 Hide mainnet for this release, behind one switch
- **Why:** Mainnet is not hidden.
  - The Mainnet radio and the "I understand" tick are live (checked: web/app-dom.js:159-166).
  - Create wallet (web/app-shell.js:276) and Personal account (web/app-account-view.js:56) both call that picker.
  - web/index.html:19 and :24 say "mainnet with a warning at 0.5 ZEC" (checked).
  - README.md:49-51 and :82 present mainnet as usable.
  - ZEC-1 (TICKETS.md:54) says a mainnet build uses the wrong branch after NU7.
  - Two clicks give a person a real-ZEC wallet of unaudited code.
- **Fix (smallest switch):**
  - Add `MAINNET_ON = false` in web/app-chain.js.
  - Make networkPick show the Testnet option only, with no tick, while the constant is false.
  - Change the two texts and the meta description in web/index.html to "Zcash testnet and Solana Devnet".
  - Make the request parser in web/app-payreq.js:45 accept testnet only.
  - Change the README text (WP-D).
  - Add a test: the picker shows one option, and the default is testnet.
- **Decision:** hide the option only. Do not add a refusal in createGroup or createPersonal. web/test/app.mjs:1871-1872 sets state, so it keeps passing.
- **Keep:** NETWORKS.mainnet, the CSP entry (cf/src/index.js:8-9) and reading of existing mainnet wallets. Removing the CSP entry changes the page policy hash in solspike/baseline.json.
- **Known gap:** a restore of a mainnet backup is not refused. Leave it for this release.
- **Files:** web/app-chain.js, web/app-dom.js, web/index.html, web/app-payreq.js, new web/test/mainnet-off.mjs, README.md.

### M2 Replace the dead Zcash testnet faucet link
- **Why:** NETWORKS.testnet.faucet points to zcashfaucet.jinolabs.xyz (checked: web/app-chain.js:22).
  - The link shows in the Receive dialog (web/app-send.js:23-25), in the empty-wallet callout (web/app-wallet.js:254-256) and in README.md:62-64.
  - Audit read-only check, 18 Oct: that faucet reports "Drips are paused for the testnet NU7 upgrade" and shows 0 drips in 7 days.
  - The Valar faucet (faucet.testnet.valargroup.dev) reported ready. It pays 0.125 TAZ to utest1 addresses. Its payout transactions have the same shape as the first Zigs spend.
  - Limits: one claim per IP per 24 h, about 150 drips a day. A venue with one shared IP gives coins to one person.
- **Fix:**
  - Change the faucet URL.
  - Change README step 3: copy the address first, 0.125 TAZ, one claim per IP per day, wait 3 confirmations (about 75 s).
  - Owner: prove one drip into a Zigs wallet before the demo. The audit could not do this, because it needs a write.
- **Files:** web/app-chain.js, README.md.

### M3 Unified setup: one flow for Zcash testnet and Solana Devnet
- **Why:** The owner plans it, and the demo shows one setup, not two ceremonies.
  - Today seat 1 must press Add Solana after its own "Address checked" (web/sol/ceremony.js:311-324).
  - The Solana tab exists only after the wallet is ready (web/app-wallet.js:76, :94).
  - The setup card has 3 Zcash steps only (web/app-setup.js:202-217).
  - The invite and join texts talk about Zcash only (web/app-setup.js:79-99).
  - The Zcash backup carries no Solana part (web/app-backups.js:51-56).
  - A stopped Solana part is final (ceremony.js:314-315, web/sol/secrets.js:35-42).
- **Fix (steps):**
  1. Add a Solana choice to createDialog. Offer it on testnet only, and only when /sol/config.json answers 200.
  2. Let the reactor write solstart/1 for seat 1 when seatReady holds, with no button. Keep the gates: safety number, signed start, all n seats. This step needs M4.
  3. Show "Solana key" and "Fee address" steps in progressCard. Keep the setup view up until the Solana agreement holds, or open the wallet with "Solana is still setting up". walletReady (app-wallet.js:76) ignores Solana now.
  4. Load web/sol for every seat at the start of setup (about 3 MB with the wasm).
  5. Say "Zcash and Solana" in joinCard, inviteMessage and the safety card. Say that all devices stay open through both ceremonies. This step also covers the "tell every signer to open this wallet" text that the audits asked for.
  6. Make the backups one setup step with both files. Add a saved flag for the Solana file, so backupNote counts both.
  7. Define the partial states. Zcash ready with Solana stopped must keep Zcash usable and offer "Retry Solana" (a new start document, which does not exist now).
  8. Show the fee-address funding as a setup step with the faucet link and Check balance.
  9. Remove the dependency on the device of seat 1 after the wallet document (app-dkg.js:182-184, ceremony.js:316). This step may be deferred (D7).
  10. Add a create-both test with two devices and a restore in the middle.
- **Fallback if M3 slips** (each piece ships alone):
  - M4
  - S6
  - S10
  - S14
  - the Solana saved flag from step 6
  - the "every signer must open this wallet" sentence on the Add Solana card (web/sol/view.js:11-16)
  - Run the demo with two ceremonies (section 9).
- **Files:** web/app-shell.js, web/app-dkg.js, web/app-setup.js, web/app-wallet.js, web/app-sol.js, web/app-backups.js, web/sol/ceremony.js, web/sol/view.js, web/sol/backup.js, web/sol/secrets.js, web/test/sol-ceremony.mjs, new web/test/unified-setup.mjs, solspike/harness/scenario-e.mjs, solspike/harness/scenario-f.mjs.
- **Package:** WP-U.

### M4 A restored seat must be able to join the Solana ceremony
- **Why:** This is a dead end today. M3 step 2 needs the same gate, so it is a MUST for M3.
  - seatReady needs `z.confirmed === safetyNo` (checked: web/sol/ceremony.js:36-42).
  - Only web/app-dkg.js:269 writes `confirmed`.
  - A restore never copies it (RESTORE_FIELDS, web/util.js:122-123).
  - A seat that holds a key share cannot press "It matches" again (canConfirm, web/app-dkg.js:240).
  - A restored seat 2 or 3 shows "has not started" for good, and the ceremony needs all n seats.
  - A restored seat 1 gets "Seat 1 must show Address checked, with the safety number confirmed" while it shows Address checked (ceremony.js:319-321).
  - The only way out is a new wallet.
  - web/test/sol-ceremony.mjs:796-815 pins the refusal but puts `confirmed` back by hand. SOL-34 covers only the network detection.
- **Fix:**
  - Let seatReady accept the seat's own signed confirm document when it carries the current number (the rule of confirmedNetwork, web/app-dkg.js:226-238).
  - Make seatProgress say why a seat waits ("this browser has not confirmed the safety number").
  - Add a test: restore a seat before the Solana part exists, then run the whole ceremony.
- **Files:** web/sol/ceremony.js, web/app-dkg.js, web/util.js, web/app-filter.js, web/test/sol-ceremony.mjs, web/test/sol-app.mjs.
- **Package:** WP-U.

### M5 Zcash signing steps must run without the payment drawer open
- **Why:** Two real devices stall the payment.
  - The reactor runs only for the open payment: `reactSession(curSession())` (web/app-loop.js:60-61).
  - Commits and shares are subscribed only in openSession (web/app-groups.js:236-243).
  - Only the browser of the proposer builds the signing package (web/app-payments.js:37, 53-70).
  - Each signer makes its share only while the payment is open (web/app-payments.js:72-80).
  - If the proposer or an approver goes back to Overview, the payment stays at "2 of 2 approvals" or "Signing 0 of 2 shares".
  - The drawer text "Starts after 2 approvals." is wrong then (web/app-drawer.js:305-308).
  - After Approve, the payment leaves the "to approve" list (web/app-groups.js:164-174), so nothing calls the person back.
  - live/zec-pay.mjs plays both seats in one browser, so no test covers this.
- **Fix:**
  - Subscribe to commits and shares of every payment in which this browser holds an approval or is the proposer.
  - Run reactSession on them in the background.
  - Change the drawer texts: "Waiting for the proposer's browser to build the package", "Waiting for seat N to sign: open this payment".
  - Add a two-browser test in which the approver leaves the drawer.
- **Scope:** the watch fix and the texts. Letting any seat build the package is not needed for the demo, because the proposer's browser stays open.
- **Files:** web/app-loop.js, web/app-groups.js, web/app-payments.js, web/app-drawer.js, web/test/app.mjs.
- **Package:** WP-Z.

### M6 Correct the false privacy claim on the Solana approval screen
- **Why:** The screen says "The chain shows neither the payee nor the amount" (checked: web/sol/payview.js:44-46). PRIVACY.md:187 says "The payee and the amount stay hidden" (checked). ZOLANA.md:67 says "Sender and recipient are public" (checked). ZOLANA.md:77 says an owner key tag marks each output. Judges who know Zolana will see the wrong claim. The SOL-12 branch, which is in QA, keeps the sentence (audit), so QA does not cover it.
- **Fix:**
  - New text: "The amount is hidden on the chain. The payee key tag, the fee address and the group are public."
  - Fix PRIVACY.md:187 to match.
  - Update the tests that check the text.
  - Put the same fix on the SOL-12 branch before it merges, or start WP-S after SOL-11 and SOL-12 merge.
- **Files:** web/sol/payview.js, web/test/sol-sessions.mjs, PRIVACY.md.

### M7 Demo runbook and README fixes
- **Why:** No document lists the steps before a first payment.
  - The judges walkthrough (README.md:53-75) has no Solana step and no password step. It points to the dead faucet.
  - README.md:395-401 still says "create the nonce account, register the group". SOL-36 (TICKETS.md:131) and ZOLANA.md:195 replaced that.
  - README.md:301 says the program is "not used by the beta yet".
  - README.md:477 says 16 fast tests. There are 17.
  - README.md:7 only says "password protected".
- **Fix:**
  - Write the runbook for a 2-of-3 group on each chain, with three devices (from the setup audit). Use the unified flow when M3 lands.
  - Add a Solana step to the judges walkthrough.
  - Fix the stale lines and the test count.
  - Add the password step.
  - Store the script of section 9 in the README or in a new docs/demo.md.
- **Files:** README.md, docs/demo.md (new).
- **Package:** WP-D.

### M8 Read-only preflight script for the demo days
- **Why:**
  - Helius may redeploy the Devnet pool: it plans breaking SDK releases over about two weeks from 18 October 2026. A pool with the tree layout of #428 would stop the pinned SDK. Helius reverted #428 on `release/devnet-c` on 17 October, so the date and the layout are open (SOL-37 in TICKETS.md).
  - The page does not compare the pool hash (SOL-43).
  - The Zcash faucet already paused once.
  - The existing read-only checks (solspike/harness/sol-live.mjs, sol-cors.mjs) run only by hand.
  - A change before November would break every Solana action, and the user sees an undecodable code (S5).
  - scripts/deploy-staging.sh:95 checks only that /sol/config.json answers 200.
- **Fix:**
  - New solspike/demo-check.sh with PASS or FAIL for each item:
    - the app origins answer (the password comes from the environment and is never printed)
    - the group server socket opens
    - /lwd or ChainSafe answers, with the branch id
    - the Valar faucet is ready
    - the approvals program hash is version 5
    - the pool program hash
    - the tree size and treeFees
    - the Helius Allowed Domains answer for each demo origin (getVersion with an Origin header)
    - the prover answers
  - Reuse sol-live.mjs and sol-cors.mjs without editing them.
  - Add the same Origin check at the end of scripts/deploy-staging.sh.
  - The script sends no write call.
- **Files:** new solspike/demo-check.sh, scripts/deploy-staging.sh.
- **Package:** WP-P.

### M9 Raise the connection limit for demo day
- **Why:** cf/wrangler.jsonc:25 (production) and :43 (staging) allow 60 new group connections a minute for each IPv4 address or IPv6 /64 (checked).
  - Each wallet and each chat opens a socket on load.
  - Each retry counts (web/shim.js:60-65).
  - A room on one network can hit the limit.
  - The answer is a 429 that the page never shows.
- **Fix:** raise the value in both entries for the demo days, deploy, and revert after the demo. Pair this with S1. The owner deploys (D6).
- **Files:** cf/wrangler.jsonc.
- **Package:** WP-N.

### M10 Pay to a ZNS name on testnet
- **Why:** the owner made it a MUST on 18 October 2026. "Pay alice.zec" is the demo moment.
  docs/zns-spike.md has the protocol, the resolver options and the risks (ticket ZNS-1).
- **Decided:** resolver option B. No names for groups while ZNS control is 1-of-n (spike 3.3).
  Testnet only.
- **Fix:**
  1. A Worker route `/zns` behind the gate, like `/lwd`: it fetches the whole testnet registry
     from a public resolver (all `list_names` pages on each refresh, with no name filter) and caches
     it. It forwards no user header. A full load on each refresh heals a reorg within one refresh;
     deltas came back wrong for up to 1 hour after a reorg (WP-ZN QA round 1, F2).
  2. `web/zns.js`: the device looks names up in the downloaded registry. It never asks a resolver
     for one name.
  3. The Send form accepts `name`, `name.zec` and `name.zcash`, and shows the address that the name
     gives, with the name. The proposal records the name and the address.
  4. Each approving device resolves the name itself and refuses the approval when its answer
     differs from the address in the proposal.
  5. PRIVACY.md and README.md say who learns a looked-up name: our Worker sees the registry
     download, and nobody learns which name a person pays.
  6. Tests: lookup, unknown name, a name that moved, a mismatch on an approving device.
  7. A live testnet payment to a testnet name.
- **Owner:** claim a testnet name for the demo payee (one small testnet payment to the ZNS Mint).
- **Review:** payment state: Gate 0, QA up to 3 rounds, the live testnet payment, a cold read.
- **Files:** cf/src/index.js (the `/zns` route only), new web/zns.js, new web/test/zns.mjs,
  web/app-send.js (the Send form hook, after WP-Z), PRIVACY.md and README.md (ZNS parts).
- **Package:** WP-ZN.

## 5. SHOULD items

### S1 Show the group server state and stop the false empty lobby
- **Why:**
  - The page never shows the socket state.
  - A refused socket retries without a message, up to 30 s (web/shim.js:59-64).
  - The lobby shows "No wallets yet" after 4 s even with no socket (shim.js:79-86).
  - Create wallet waits for ever, because send() waits on g.ready (shim.js:68-75).
  - Buttons stay disabled with no reason (web/app-shell.js:130, :195, :230; web/app-setup.js:81).
  - The error callback at web/app-groups.js:124 is never called (shim.js:95, :102).
- **Fix:**
  - Give shim.js a status: connecting, open, retrying in N s, refused with the HTTP code.
  - Show it next to the engine dot (build the line from JS, no index.html edit).
  - Time out send() after 10 s with "The group server did not answer".
  - Keep the lobby on "Connecting" until each wallet loaded or failed.
  - Call the error callback.
  - WP-U then shows the reason on the disabled buttons and on the setup card.
- **Files:** web/shim.js, web/app-engine.js (WP-N); web/app-shell.js, web/app-setup.js (WP-U).

### S2 Refresh the Solana balances by itself
- **Why:**
  - The private balance is set only by syncSolana, which only the Sync button calls (web/sol/session.js:108-131, web/sol/main.js:152).
  - Add SOL refreshes the public balance only (main.js:160-164).
  - Nothing syncs after an execute.
  - The live harness taps Sync every 4 s for up to 180 s (solspike/harness/flow.mjs:216-228). A person who taps once can see the old value.
  - Zcash refreshes every 60 s.
- **Fix:**
  - Run refreshChain and syncSolana when the tab opens, after a confirmed Add SOL, and after a payment is sent or seen as landed elsewhere.
  - After Add SOL, poll every 4 s for up to 60 s and show "Waiting for the indexer".
  - Add a page test with a delayed fake indexer.
- **Files:** web/sol/main.js, web/sol/session.js, web/sol/payview.js, web/sol/signing.js.
- **Package:** WP-S.

### S3 Only funded seats take the execute lease
- **Why:**
  - executorOf picks every local seat with a published fee document and reads no balance (web/sol/execute.js:67-70).
  - A browser with an empty fee address takes the lease first (execute.js:192), re-proves, fails, and tries 3 times.
  - The funded browser waits. The delay is about 1 to 3 minutes, with a red banner on approver screens.
  - LEASE_MS is 240000 (checked: execute.js:39), but the server caps a lease at 60000 ms (checked: cf/src/index.js:467). A second browser can then send a second execute.
  - The fund card says only "Send Devnet SOL to it" (web/sol/payview.js:90-93).
- **Fix:**
  - Choose the executor among seats whose fee balance covers the execute fee. Read the balance with the Worker "balance" command before the lease.
  - A seat that cannot pay skips the execute with no banner.
  - Set LEASE_MS to 60000 and renew it before send().
  - Add to the fund card: "Seats that propose or execute need about 0.003 SOL. Seats that only approve need none."
  - Add a test with one funded seat and two unfunded browsers.
- **Scope:** the executor choice, the lease and the text.
- **Mitigation:** fund all three fee addresses before the demo (section 8).
- **Files:** web/sol/execute.js, web/sol/signing.js, web/sol/payview.js, web/test/sol-pay.mjs.
- **Package:** WP-S.

### S4 Show the notes that an open Solana proposal holds
- **Why:**
  - A payment cannot be cancelled before its 23-hour expiry (web/sol/propose.js:48, ZOLANA.md:388-390).
  - openInputs hides its notes from new payments (web/sol/sessions.js:191-194).
  - With one note, the next proposal fails with "the synced balance does not cover the amount" (web/sol/transfer.js:56), while the tab shows the full balance.
  - A payee typo or a stuck session leads there.
  - The only way out is another Add SOL.
- **Fix:**
  - Show the private balance as "available" (balance minus notes held by open proposals).
  - Name the holder: "All your notes are held by an open proposal (id). It ends at <time>. Add SOL or wait."
- **Mitigation:** check the payee twice before Propose. The Abandon action is in the NICE list.
- **Files:** web/sol/transfer.js, web/sol/sessions.js, web/sol/payview.js.
- **Package:** WP-S.

### S5 Helius errors: readable text and a retry backoff
- **Why:**
  - The SDK bundle is built with NODE_ENV=production (solspike/build.mjs:98), so a 403, 429 or 5xx reaches the page as "Solana error #8100002; Decode this error by running npx @solana/errors decode" (web/sol/worker.js:491-500, web/app-dom.js:42, web/sol/session.js:125-127).
  - Staging gets 403 for its origin (SOL-48, TICKETS.md:44). The ceremony needs no Helius call, so staging looks fine until the first Sync.
  - Failed wallet reads retry every 3 s with a red banner each time (web/sol/signing.js:333-345, web/app-loop.js:28-37). That makes a 429 worse.
  - Nobody checked the Helius plan limits (D4).
- **Fix:**
  - In the Worker answer(), read the status code of SolanaError 8100002.
  - 403: "Helius refused this website. Its key does not allow this domain."
  - 429: "Too many Helius calls. Wait a minute."
  - 5xx: "Helius is not answering."
  - Add exponential backoff (3 s up to 60 s) to the wallet read. Show a banner once for each error text.
  - Do not rebuild the SDK bundle.
  - Add a test with a stub that answers 403, 429 and 500.
- **Files:** web/sol/worker.js, web/sol/signing.js, new web/test/sol-errors.mjs.
- **Package:** WP-S.

### S6 Solana approval count, and a Solana tab that a phone can reach
- **Why:**
  - toApprove counts Zcash sessions only (web/app-groups.js:174). The side count, the tab and the page title ignore Solana.
  - The Solana tab has no badge (web/app-wallet.js:94).
  - Measured at 375 px: the tab bar is 456 px wide in a 343 px box, and "Solana" sits at x=411..472, past the edge. The scrollbar is hidden (web/app.css:173-174).
  - An approver sees nothing unless it opens a tab that it cannot see.
- **Fix:**
  - Add a count badge on the Solana tab and on the side item. Count the open Solana sessions that this browser can still approve (from sol.ctl.sessions).
  - On phones, shorten the labels or wrap the bar, scroll the selected tab into view, and show an edge fade.
  - Check at 375 px and 390 px.
- **Files:** web/app-wallet.js, web/app-shell.js, web/app-sol.js, web/app.css.
- **Package:** WP-U.

### S7 Release the Send hold after Approve then Cancel (owner decision D2)
- **Why:** The owner chose the hold on 18 Oct (ZEC-13).
  - cancelPayment keeps the approval mark (web/app-payments.js:288-304).
  - stillHolds ends the hold only for done, expired, spent, expiry+3 blocks or the ceiling (569-574).
  - web/test/app.mjs:1495-1498 pins "an error part ends no hold".
  - A presenter who finds a typo after Approve cannot propose again for about a day.
  - In a 2-of-2 wallet where this seat never made a share, the text "can still go on chain" is wrong.
  - "Play the other seats in this browser" puts every seat in one browser.
- **Fix:**
  - End the hold when t = n and this seat burned its nonce without a share.
  - For t < n, keep the hold. Say why, show the time left, and offer a confirmed "I checked, release" button.
  - Test both cases.
  - Land S7 before S8, because S8 makes users cancel more often.
- **Mitigation:** do not Cancel after Approve in the demo. Keep a spare funded wallet.
- **Files:** web/app-payments.js, web/app-drawer.js, web/test/app.mjs.
- **Package:** WP-Z.

### S8 Block Send while a proposal is open, and guard the button (ZEC-10)
- **Why:**
  - ZEC-10 is open (TICKETS.md:60).
  - sendBlocker blocks only on a sent payment or an approval hold (web/app-payments.js:331-346).
  - The engine picks from all unspent notes (wasm/src/chain.rs:741-752).
  - A faucet wallet holds one note, so a second proposal spends the same note. It fails only at the broadcast, after all approvals and the proof of about a minute (web/app-drawer.js:311-315).
  - act() disables the form, not the submit button (web/app-dom.js:35-48), so a double tap sends two proposals.
- **Fix:**
  - Disable the submit button while newSpend runs.
  - Refuse Send while a proposal is open and not cancelled, failed or expired: "Finish or cancel the open payment first".
  - Add a one-note test.
- **Mitigation:** one proposal at a time in the demo.
- **Files:** web/app-payments.js, web/app-send.js, web/app-drawer.js, web/test/app.mjs.
- **Package:** WP-Z.

### S9 Light-wallet sync with the lwd node off
- **Why:**
  - pickServer tries /lwd first on every sync, waits up to 8 s, and keeps no memory (web/app-chain.js:68-74, :95-101, :247-250).
  - broadcastAnywhere starts at /lwd with a 16 s timeout (web/app-payments.js:183-198). That is the last step of the Zcash payment.
  - sync and createSpend have no timeout. A stalled stream keeps `syncing` true, so Refresh stays disabled.
  - The refresh skips hidden tabs, and a return to the tab only redraws (web/app-loop.js:293-294). Faucet coins show up to a minute late.
  - No test covers the fallback.
  - The audit could not measure /lwd with the box really off.
- **Fix:**
  - Remember a failed server for 5 minutes and try ChainSafe first in that time. Cut the first timeout to 3 s.
  - Add a 60 s timeout around sync and createSpend that frees the busy flag.
  - Run runSync on visibilitychange (visible) and on focus when the last sync is older than 15 s.
  - Export `preferredServer()` and use it in broadcastAnywhere.
  - Add a page test for the fallback.
- **Mitigation:** power on the lwd box (D5).
- **Files:** web/app-chain.js (WP-A); web/app-payments.js (WP-Z).

### S10 Invite texts: password and browser hint (owner decision D1)
- **Why:**
  - cf/src/index.js:290-306 asks every request, including /ws, for one shared Basic password. A refused prompt ends in the plain text "Zigs is not open yet" (index.js:301).
  - inviteMessage and the invite card (web/app-setup.js:95-118) do not mention the password.
  - A joiner who scans the QR code on a phone meets the prompt before any Zigs screen.
  - A link opened in a chat app browser or a private window loses the seat without a backup (CHAT.md:423-425).
- **Fix:**
  - Option A: add "The browser will ask for a password. Ask <host> for it." and "Open this link in Safari or Chrome, not in a chat app browser, and not in a private window" to inviteMessage, the invite card, joinCard (web/app-shell.js:154-158) and chatMessage (web/app-links.js:74-76).
  - Option B: lift the gate (see D1).
- **Files:** web/app-setup.js, web/app-shell.js, web/app-links.js.
- **Package:** WP-U.

### S11 A red banner stays after the step succeeds
- **Why:**
  - once() shows showBanner('bad', ...) on each failure and retries every 3 s (web/app-loop.js:28-37).
  - Only a button action clears a bad banner (web/app-dom.js:41).
  - The key ceremony, wallet creation and every Solana step use once(), so a slow answer leaves a red banner in front of the room.
  - The text "No light-wallet server answers. Check your connection, then click Sync." (web/app-chain.js:73) points to a button that the setup screen does not have.
  - Only seat 1 sees the error. The other seats see "Building the shared address…" for ever (web/app-dkg.js:200).
- **Fix:**
  - In once(), clear the banner (clearBadBanner) when the same key later succeeds.
  - Change the pickServer text to "The page tries again by itself." where no Sync button shows.
  - Show a waiting line on the setup card of the other seats.
- **Files:** web/app-loop.js, web/app-state.js (WP-Z); web/app-chain.js (WP-A); web/app-setup.js (WP-U).

### S12 A failed Solana load needs Try again and a clear text (SOL-26)
- **Why:**
  - solLoad keeps the failed promise until a reload (web/app-sol.js:43-55).
  - fetchRpcUrl turns every network error into "Solana is not available on this server" (web/sol/session.js:25-35).
  - A short outage on one seat device takes that seat out of the ceremony, and the other seats wait.
  - SOL-26 is open.
- **Fix:**
  - Add a Try again button to the Solana tab that clears solLoading once.
  - Use "Solana did not load. Check your connection, then press Try again or reload." for a network error.
  - Keep "not available on this server" for a 503.
- **Files:** web/app-sol.js (WP-U); web/sol/session.js (WP-S).

### S13 Stale and wrong texts on the main screens
- **Why:**
  - Every new wallet shows the note "The backup format changed on 16 October 2026. Older backup files no longer open ... iPhone and Mac apps need their next version" (web/app-wallet.js:147-151, web/app-backups.js:34-35, :121). A first-time user has no older file.
  - The Send form says "An iPhone or Mac app built before this version cannot approve it" (web/app-send.js:227).
  - The privacy card says the wallet "syncs again on every load" (web/app-wallet.js:455), but saved state continues the sync.
- **Fix:**
  - Remove the migration sentence from the reminder and the dialog. Keep it in the restore error for an old file.
  - Remove the iPhone and Mac sentence.
  - Fix the privacy card.
  - The integrator updates the assertion at web/test/app.mjs:2604.
- **Files:** web/app-wallet.js, web/app-backups.js (WP-U); web/app-send.js (WP-Z); README.md (WP-D).

### S14 A stopped or stuck Solana ceremony needs a next step
- **Why:**
  - The Zcash stop text ends with "Create a new wallet." (web/util.js:60-64). The Solana stop text ends with "Do not use the Solana part of this wallet." (web/sol/ceremony.js:21-24). It does not say that Zcash still works.
  - A second start is refused: "Solana was added already." (ceremony.js:314-315).
  - A seat that lost its setup secret shows the problem only on its own tile (ceremony.js:326-344). No stop document goes to the other seats, so they show "running" for ever.
  - During a live demo, one failure costs a new wallet and a new funding.
- **Fix:**
  - Change the stop text: the Zcash part still works, and a new wallet is the way to a new Solana part.
  - Add a "Create a new wallet" button to both stop callouts.
  - When lostSecret is true, publish a stop with "Seat N lost its Solana setup secret. Create a new wallet to use Solana." (reactAborts already publishes stops).
  - A real restart (a new start document) belongs to M3 step 7.
- **Files:** web/sol/ceremony.js, web/sol/abort.js, web/sol/view.js, web/app-setup.js, web/test/sol-ceremony.mjs.
- **Package:** WP-U.

### S15 Copy buttons for the Solana addresses, and a compare hint
- **Why:**
  - The payee needs the 198-character shielded address of another group (web/sol/intent.js:23). keyBlock shows it as plain text with no Copy button (web/sol/view.js:69-88). Only the fee address has Copy (web/sol/payview.js:96-118).
  - The address has no checksum, so one wrong character gives another well-formed payee.
  - The approval screen does not say where to compare the payee (payview.js:342-350).
  - The status shows raw words ("running", "differs") (view.js:17-24).
  - Errors use `small bad`, which has no CSS rule (payview.js:99, :498, :512).
- **Fix:**
  - Add Copy buttons to the shielded address and the program address.
  - Replace the raw status words with sentences.
  - Add `.small.bad { color: var(--bad) }`.
  - Add to the approval screen: "Compare the Payee with the program address on the Solana tab of the payee group."
- **Files:** web/sol/view.js, web/app.css (WP-U); web/sol/payview.js (WP-S).

### S16 Explorer links for Solana ids
- **Why:**
  - The Add SOL line and the session result show bare ids (web/sol/payview.js:166-173, :501-513). The rent cancel shows no id (web/sol/rent.js:67-84).
  - The Zcash drawer has explorer links (web/app-drawer.js:313).
  - The demo closes with the transaction on the explorer.
- **Fix:** link ids to `https://explorer.solana.com/tx/<id>?cluster=devnet` and accounts to `/address/<key>?cluster=devnet`, with `target="_blank"` and `rel="noopener"`. Show the cancel id after a rent recovery.
- **Files:** web/sol/payview.js, web/sol/rent.js.
- **Package:** WP-S.

### S17 Show "reading the wallet" as a wait, not as an alert
- **Why:** While the device reads the wallet, reviewOf returns READING (web/sol/approve.js:43, :149). reviewBlock renders it as a red alert (web/sol/payview.js:435-440). A first sync takes up to about 25 s (ZOLANA.md 6.10), so each approver sees an error during a normal wait.
- **Fix:** return a separate "waiting" result. Show a neutral line: "Reading your wallet. The Approve button appears when it is done."
- **Files:** web/sol/approve.js, web/sol/payview.js.
- **Package:** WP-S.

### S18 Align the site and the note with the app
- **Why:**
  - zigs-site/index.html:22 and :84-86 promise "One unified wallet", "shielded ZEC, SOL and USDC", "Solana Privacy Rings" and "Native privacy on both chains". The mock shows Phantom, Keystone, Swap and a USD balance.
  - The app has SOL only (SOL-16 is open), and a unified setup is not yet built.
  - The note says sender and recipient are public (zigs-site/note.html).
  - Judges read the site before the app.
- **Fix:**
  - Add the caption "Illustration" to the mock.
  - Align the claims: SOL only, Devnet, sender and recipient public, setup on testnet.
  - Re-check the app text after SOL-11 and SOL-12 merge.
- **Files:** zigs-site/index.html, zigs-site/note.html.
- **Package:** WP-D.

## 6. NICE items

| Item | Files |
|---|---|
| Solana payment thread and events in the wallet room (polish) | web/app-thread.js, web/app-messages.js, web/sol/payview.js |
| "Abandon this payment" for a Solana proposal that lost its nonces; frees the notes | web/sol/payview.js, web/sol/signing.js, web/sol/sessions.js |
| One Web Lock per wallet; a second tab shows "open in another tab" | web/app-keystore.js, web/app-loop.js, web/sol/ceremony.js |
| Rent recovery: scan on tab open, read-only "owned" check in sol-live.mjs | web/sol/payview.js, web/sol/rent.js, solspike/harness/sol-live.mjs |
| "Remove this wallet from this browser" action; script that stages the Solana group (VEL-3) | web/app-wallet.js, web/app-backups.js, solspike/harness/scenario-f.mjs |
| Faucet link and funding default on the testnet personal account | web/app-account-view.js, web/app-chain.js |
| Show the invite link as a short form with a "Show link" toggle | web/app-setup.js, web/app-wallet.js |
| "A computer is faster" in the proof text on phones | web/app-drawer.js |
| One vocabulary on Zcash and Solana screens, after SOL-11 and SOL-12 | web/sol/payview.js, web/sol/view.js |
| Solana approval count in the page title | web/app-loop.js |
| "Updated N s ago" label on the Solana balances | web/sol/payview.js |

## 7. Work packages

Rules:
- Each file has one owner package.
- Packages touch no common file, except the two integrator steps below.
- An item that spans two owners is split by file. The interface is named.

| Package | Items | Files owned |
|---|---|---|
| **WP-U** Setup, wallet shell, Solana ceremony | M3, M4, S1, S6, S10, S11, S12, S13, S14, S15 | web/app-shell.js, web/app-dkg.js, web/app-setup.js, web/app-wallet.js, web/app-sol.js, web/app-backups.js, web/app-links.js, web/app-filter.js, web/util.js, web/app.css, web/sol/ceremony.js, web/sol/view.js, web/sol/backup.js, web/sol/secrets.js, web/sol/abort.js, web/test/sol-ceremony.mjs, web/test/sol-app.mjs, new web/test/unified-setup.mjs, solspike/harness/scenario-e.mjs, solspike/harness/scenario-f.mjs |
| **WP-S** Solana payments | M6, S2, S3, S4, S5, S12, S15, S16, S17 | web/sol/payview.js, web/sol/main.js, web/sol/session.js, web/sol/execute.js, web/sol/signing.js, web/sol/transfer.js, web/sol/sessions.js, web/sol/worker.js, web/sol/approve.js, web/sol/rent.js, web/test/sol-pay.mjs, web/test/sol-sessions.mjs, new web/test/sol-errors.mjs |
| **WP-Z** Zcash payment flow | M5, S7, S8, S9, S11, S13 | web/app-loop.js, web/app-payments.js, web/app-groups.js, web/app-drawer.js, web/app-send.js, web/app-state.js, web/test/app.mjs |
| **WP-A** Chain and chrome | M1, M2, S9, S11 | web/app-chain.js, web/app-dom.js, web/index.html, web/app-payreq.js, new web/test/mainnet-off.mjs, new web/test/chain-fallback.mjs |
| **WP-N** Group server link | M9, S1 | web/shim.js, web/app-engine.js, cf/wrangler.jsonc, new web/test/shim-status.mjs |
| **WP-P** Preflight | M8 | new solspike/demo-check.sh, scripts/deploy-staging.sh |
| **WP-ZN** ZNS pay to a name | M10 | cf/src/index.js (`/zns` route), web/zns.js, web/test/zns.mjs, web/app-send.js (after WP-Z) |
| **WP-D** Docs and site | M1, M2, M6, M7, S13, S18 | README.md, PRIVACY.md, TICKETS.md, docs/demo.md (new), zigs-site/index.html, zigs-site/note.html |

Cross-package interfaces:
1. WP-N exports the group server status from web/shim.js. WP-U reads it in the lobby, createDialog and the setup card (S1). Merge WP-N first.
2. WP-A exports `preferredServer()` from web/app-chain.js. WP-Z uses it in broadcastAnywhere (S9). Merge WP-A first.
3. WP-U reads the Solana pending count from the existing sol.ctl.sessions (S6). WP-S exports nothing to other packages.

Integrator steps (one person, after the packages land):
- Edit scripts/test-fast.sh and the CI gate list. Add the new test names. No package edits these files.
- Fix the existing assertion at web/test/app.mjs:2604 (backup text, from S13 in WP-U). WP-Z owns app.mjs and WP-U must not edit it.
- Run the CI gate (baseline.sh) after each package. The polish audit did not run it. Do not rebuild the Solana SDK bundle in this release.

Order and sessions (one session for each package; heavy commands go through heavy.sh):
- WP-N and WP-A ship first, because WP-U and WP-Z read their exports.
- WP-U, WP-S, WP-Z and WP-ZN run in parallel.
- WP-ZN hooks into the Send form (web/app-send.js) only after WP-Z has landed its Send changes.
- WP-S starts after SOL-11 and SOL-12 merge, because all three touch web/sol/payview.js. Otherwise put the M6 text fix on the SOL-12 branch first.
- WP-D runs on the planning side. M7 needs the final flow, so finish it last.

## 8. Owner preparation (the owner does every write)

**T-7 days**
1. Decide D1 to D7.
2. Helius: add every demo origin to Allowed Domains, read the plan limits, set a usage alert (D4).
3. Power on the lwd box, or accept the ChainSafe fallback (D5).
4. Deploy the raised WS_PER_IP (M9). Revert after the demo.
5. Run solspike/demo-check.sh (M8). Fix every FAIL. Also run it every day until the demo: docs/demo.md section 3 has the schedule and the alert rule.
6. Prove the faucet: send one Valar drip to a Zigs testnet address (M2).

**T-3 to T-1 days: stage on production only** (staging has no working Solana tab until SOL-48 closes)
7. Create "Demo A": a 2-of-3 wallet on three devices, with Zcash and Solana ready.
8. Save both backup files for each seat (a Zcash file and a Solana file, with two passphrases that stay offline). Restore one seat on a blank profile once.
9. Fund Demo A with Zcash: one Valar drip (0.125 TAZ), plus coins from the permanent test wallet if needed (one claim per IP per day). Wait for 3 confirmations. Fund a spare wallet in the same way.
10. Fund the fee address of all three seats with Devnet SOL, at least 0.003 SOL each. Press Check balance on each seat.
11. Add SOL from a funded seat (default 0.02). Press Sync Solana and read the private balance.
12. Create a "Payee" group. Save its Zcash address (utest1…) and the 198-character shielded address from its Solana tab in a private note on the presenter device.
13. Optional: make one Solana proposal 24 hours before the demo, so that its rent card shows after expiry.

**T-1 day and T-1 hour**
14. Use three laptops with desktop Chrome or Safari. No private window. No chat app browser. One tab for each wallet. A phone may approve. Build the proof on a laptop unless a phone run was rehearsed.
15. Rehearse the whole script once on the real devices and network. Write down the time of the Zcash key ceremony, the Solana ceremony, the proof and the Solana execute. If the live setup takes more than 2.5 minutes, narrate it and switch to Demo A (section 9).
16. Open both explorers once: testnet.zecblock.com and the Solana explorer on Devnet.
17. T-1 h: run demo-check again (the daily run does not cover the hosted prover or the indexer). Confirm the Zcash Available balance and the three fee balances. Cancel old Zcash proposals: a Solana proposal ends only at its expiry. Confirm that no approval hold blocks Demo A.
18. Keep a phone hotspot as a backup network. Keep a screen recording of a full run.

## 9. Demo script: 10 minutes, 2-of-3 group, Zcash testnet and Solana Devnet

Devices: D1 (presenter, seat 1), D2 (seat 2), D3 (seat 3). Rule for the whole demo: do not press Cancel after Approve. Keep each payment open until the status says Sent.

| Time | Who | Step | Expected result | Needs |
|---|---|---|---|---|
| 0:00 | D1 | Open app.zigs.app and enter the preview password. Say: testnet and Devnet only. Click New wallet. | The picker shows Testnet only. | M1, D1 |
| 0:45 | D1 | Name the wallet. Set Signers 3 and Approvals 2. Turn on Solana. Click Create wallet. Show the invite QR. | The invite card shows. | M3 |
| 1:15 | D2, D3 | Scan the QR, type a name, click Take seat. | 3 of 3 seats taken. | S10 |
| 1:45 | D1, D2, D3 | Read the safety number aloud. Each person presses It matches. Narrate the progress card: Zcash key, Solana key, fee address. | Both ceremonies run. Each seat shows Address checked and key ready. | M3, M4 |
| 3:00 | D1 | Switch to Demo A. Show the Zcash address, the Available balance and the Solana tab. Press Sync Solana. | Both balances show. | S2 |
| 3:30 | D1 | Receive: show the address and the faucet link. Do not use the faucet live. Click Send. Paste the Payee utest1 address. Enter 0.01. Click Propose payment. | A payment opens. | M2 |
| 4:00 | D2 | Open the payment. Read "What this payment does". Click Approve. Keep the payment open. | One approval. | M5 |
| 4:30 | D1 | Click Approve. Click Build proof. Narrate the privacy model during the proof (about 1 minute). | The proof builds. | M5 |
| 5:45 | D1 | Click Send to network. Click View in explorer. | Status Sent. The explorer shows the transaction. | S9 |
| 6:15 | D1 | Open the Solana tab. Click Send privately. Paste the 198-character payee address. Enter the amount. Click Propose. | A Solana proposal opens. | S15 |
| 7:00 | D2 | Open the Solana tab. Wait for the Approve button. Click Approve. | One approval. The group signature forms. | S6, S17 |
| 7:30 | D1 | Wait for the execute. A funded seat executes by itself. Press Sync Solana. | The status says sent. The private balance drops. | S3, S2 |
| 8:15 | D1 | Click the transaction link. | The Devnet explorer shows it. | S16 |
| 8:45 | D1 | Show the rent card (old proposal) and the backup buttons. State what is public: the payee key tag, the fee address, the group. | Text matches ZOLANA.md. | M6 |
| 9:30 | D1 | Close: both chains are test networks, no mainnet, the code is not audited. | | M1 |

**Fallback if M3 slips (two ceremonies).**
- At 0:45 create a Zcash-only wallet.
- At 1:45 run the Zcash ceremony.
- After "Address checked" on all three seats, D1 opens the Solana tab and presses Add Solana.
- All three devices stay open on this wallet until all three seats show "key ready" (S14).
- If this takes more than 3 minutes, stop and switch to Demo A.

**Contingencies.**
- The light-wallet server is slow: wait. The ChainSafe fallback works (S9).
- Solana shows a Helius error: wait one minute, then show the Zcash part and the recorded run (S5).
- The page shows "Connecting" for long: switch to the phone hotspot (S1).
- Send is blocked by a hold: use the spare wallet (S7).
- A seat device is lost: restore from the two backup files (M4).

## 10. Checks and limits of this review

- **Checked in the repo:**
  - the Mainnet radio and tick (web/app-dom.js:159-166)
  - the NETWORKS table and the faucet URL (web/app-chain.js:18-26)
  - the index.html texts at :19 and :24
  - seatReady (web/sol/ceremony.js:36-42)
  - the approval text (web/sol/payview.js:44-46)
  - PRIVACY.md:187 and ZOLANA.md:67
  - WS_PER_IP at cf/wrangler.jsonc:25 and :43
  - LEASE_MS 240000 against the 60000 cap (web/sol/execute.js:39, cf/src/index.js:467)
  - the README judges steps (README.md:52-76)
- **Audit read-only checks, 18 October (not repeated):**
  - the ChainSafe testnet answers
  - the Valar faucet is ready, and the old faucet is paused
  - lwd.zigs.app answered a keyless request with 404 in about 0.1 s while the box was off
  - the fast suite passed 17 of 17 on Node 24
  - the app, sol-fee, sol-ceremony, sol-app, sol-pay, sol-limits and sol-sessions suites exited 0
- **Nobody checked:**
  - a faucet drip landing in a Zigs wallet
  - /lwd behaviour with the box really off
  - proof time on phones
  - Helius plan limits
  - the Solana faucet limits
  - the CI gate (baseline.sh)
  - cf/test/limits.mjs
  - the flake rate of the page tests
- **No code was changed and no transaction was sent.**