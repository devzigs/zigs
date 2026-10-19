# Zigs demo runbook

**Status: draft of 18 October 2026.** Sources: sections 3, 8 and 9 of
[hackathon-release.md](hackathon-release.md) and the page code on main df210da. A step
marked **[waits for Mx]** or **[waits for Sx]** needs a package that is not on main yet. Each such
step gives the way to run the demo without it. Finalize this file when M3 (unified setup), M5
(Zcash signing in the background) and M10 (pay to a ZNS name) land.

Scope: a 2-of-3 group on Zcash testnet and Solana Devnet, with three laptops. No mainnet. The code
is not audited.

Names in this file:

- **L1**, **L2**, **L3**: the three laptops. L1 is the presenter and holds seat 1. L2 holds seat 2,
  L3 holds seat 3.
- **D1** to **D7**: the owner decisions of section 3 of the checklist.
- **Demo A**: the wallet that the owner prepares and funds before the demo.
- **Payee**: a second group that receives the payments.

## 1. What the demo needs, and what to do without it

On main 8e624ff (18 October 2026): M1, M2, M4, M6, M8 and S1. M10 is in part: the `/zns` route
and the lookup on the device are on main, but the Send form does not take a name yet. The rows
below that say "on main" need nothing more.

| Item | What the demo needs | Without it |
|---|---|---|
| M1 | The network picker shows Testnet only | On main |
| M2 | Get testnet ZEC opens the Valar faucet | On main |
| M3 | One setup for Zcash and Solana | Run two ceremonies: section 5 |
| M4 | A restored seat can join the Solana ceremony | On main |
| M5 | Zcash signing goes on when the payment drawer is closed | Keep the payment open on every approving laptop until it says Sent |
| M6 | The Solana approval screen says what is public | On main |
| M8 | `solspike/demo-check.sh` | On main |
| M9 | WS_PER_IP at 600 for the demo week (D6) | Use one network for each laptop, or the phone hotspot |
| M10 | Pay to a ZNS name in the Send form | Paste the utest1 address of Payee |
| S1 | The side bar says when the group server does not answer | On main |
| S2 | The Solana balances refresh by themselves | Click **Sync Solana** after each Solana step |
| S3 | Only a funded seat executes | Fund the fee address of all three seats |
| S4 | An open Solana proposal does not hold every note of the group | An open proposal holds its notes for 23 hours, and nothing can cancel it before then. Keep two notes in Demo A (step 12). Check the payee twice before **Send privately** |
| S7 | The Send hold ends after Approve then Cancel | Never click Cancel after Approve. Keep a spare funded wallet |
| S8 | One open Zcash proposal at a time | Make one proposal at a time |
| S10 | The invite text names the password | Give each person the password before the scan |
| S15 | Copy buttons for the Solana addresses | Copy the payee address from the private note on L1 |
| S16 | Explorer links for Solana ids | Paste the id into https://explorer.solana.com/?cluster=devnet |
| SOL-4 | Local proving on Demo A (the card **Local proving** of the Solana tab) | Keep local proving off: all groups use the hosted prover |
| S17 | A neutral line while a device reads the wallet | The Approve button shows during the read. While the red text "Zigs is reading your wallet" shows, do not click. Wait until the screen shows the payment (up to about 25 s) |

## 2. Owner decisions that apply

Decided by the owner on 18 October 2026:

- **D1 Password.** The password gate stays. The browser asks for a user name and a password. Any
  user name works: the Worker checks the password only. The host gives the password. Never write
  it into the repo, a chat or the invite text. Keep it only in files of mode 600 outside the repo,
  for demo-check (step 4).
- **D2 Send hold.** When t = n and this seat made no share, the hold ends. Otherwise the hold
  stays. With S7, the page says why and offers "I checked, release". In the demo: never Cancel
  after Approve.
- **D3 Mainnet.** Mainnet wallets made before stay readable. The web app makes no new ones (M1).
- **D4 Helius.** The owner adds app.zigs.app and staging.zigs.app to the Allowed Domains of the
  Helius key, reads the plan limits and sets a usage alert. The key stays readable behind the
  gate (SOL-24).
- **D5 Light-wallet node.** The ChainSafe fallback day to day. The owner powers on the lwd box for
  the demo week.
- **D6 Connection limit.** WS_PER_IP goes from 60 to 600 for the demo week, and back to 60 after
  it (M9).
- **D7 Seat 1.** Step 9 of M3 is deferred. So the device of seat 1 must stay open on the wallet
  until every seat shows its Solana key ready.

## 3. Preparation

The owner does every write: deploys, payments, faucet claims and name claims.

### From now until the demo

- **Regular check.** Until the demo, run `sh solspike/demo-check.sh` by hand at least every two
  days, and after any Helius release note. The coordinator also runs it at every deploy. It is
  read only.
  - A FAIL for `pool program`, `approvals program`, `tree 0` or `prover` means that Devnet moved.
    Write the date, follow the "pool program" row of section 6, and tell the coordinator.
  - A PASS does not cover the hosted prover or the indexer: the prover check sends an empty body
    only, and no check calls the indexer. So step 18 (T-1 hour) and the rehearsal (step 16)
    stay.
- **Freeze.** Freeze is the default (TICKETS.md SOL-37). If Devnet has moved, do not change the
  pin, and run the Solana part from the recording. A repin needs a decision of the owner, because
  docs/hackathon-release.md forbids a rebuild of the Solana SDK bundle in this release. It is
  allowed only if the SOL-37 checks pass and a Devnet payment lands by T-7. The cut-off is T-10:
  after it, no repin. Never repin in the last week.
- **After a repin or a pool redeploy that changes the tree layout** (SOL-37 T2 or T3): make Demo
  A, the spare wallet and Payee again, because groups made before cannot spend. After any pool
  redeploy, compare the upgrade key and the protocol authority on Devnet with
  `web/sol/view.js`. The Details screen shows constants and does not read them again.
- **First recording.** Record a full run now, while Devnet matches the demo-check pins: the
  Zcash payment as the flow stands, and the Solana private payment (propose, approve, prove,
  execute). The coordinator starts the live steps, after the owner says yes in the coordinator
  session; send the command, the amount and the wallets first.
  - Write the pins of that day in the notes of the file: the pool ELF `44238d6f…`, the
    ProgramData slot 512563584, tree 0 of 40,080 bytes, the approvals ELF `b4bad24c…`.
  - Record only the browser window, in a clean profile, with no menu bar, notifications, real
    names or password prompt (D1).
  - Keep the unedited original outside the repo, never in git, with a copy on a second device.
  - Record again after M3, M5 or M10 lands, after a repin (SOL-37) and after a redeploy of the
    approvals program. Keep the old file until the new one plays.
  - With the current pin, no new run is possible after Devnet moves. A new run needs the SOL-37
    repin, and maybe a change of the approvals program (SOL-43).

### T-7 days

1. Helius: add app.zigs.app and staging.zigs.app to Allowed Domains. Read the plan limits. Set a
   usage alert (D4).
2. Power on the lwd box (D5).
3. Set WS_PER_IP to 600 in both entries of `cf/wrangler.jsonc` (production and staging), and
   deploy (D6, M9). Write the date to set it back.
4. Run `sh solspike/demo-check.sh` (M8). Fix every FAIL. The script reads two files outside the
   repo:
   - `~/.config/zigs/demo-check.json`: the app origins with their password files (mode 600).
     Without a password file, the checks behind the gate say SKIP. After step 11, add the fee
     addresses of Demo A to `solFees`, each with `"min": "0.003"`.
   - `~/.config/zigs/helius-app.url`: the Helius URL. Without it, the Helius checks say FAIL.

   The script sends no write and prints no secret.
5. Prove the faucet: copy the address of a Zigs testnet wallet, then claim one Valar drip into it.
   The drip is 0.125 TAZ, once for each IP address and once for each address every 24 hours
   (M2). The faucet lists each payout in public: a short form of the address, the transaction id,
   the amount and the time.
6. Claim a testnet name for the demo payee: one small testnet payment to the ZNS Mint.
   **[waits for M10]** The name `zigsdemo` in this file is a placeholder: the owner chooses the
   final name. While ZNS Early Access lasts, the Mint refuses a claim without a six-digit access
   code and keeps the payment (docs/zns-spike.md 3.1). A test claim of `zigsdemo` on 18 October
   2026 had no code and registered nothing. So get a code from ZcashMe first, or wait for open
   registration. Open question for the owner: M10 decided "no names for groups while ZNS
   control is 1-of-n" (docs/zns-spike.md 3.3).
   - Option A: the name points to a single-signer testnet address of the owner. The 3:30 step
     then pays that address, not Payee.
   - Option B: the owner accepts a name for the group Payee on testnet. Any signer of Payee can
     then move the name alone.
   - In both cases, check the lookup again at T-1 hour.

### T-3 to T-1 days: stage on production

Stage on app.zigs.app. The Solana tab of staging works only after D4 adds staging.zigs.app
(SOL-48).

7. On each laptop, open app.zigs.app once and enter the password. The browser keeps it until it
   closes.
8. Create **Demo A**: a 2-of-3 wallet on L1, L2 and L3, with Zcash and Solana ready.
   - With M3: turn on Solana in the create dialog. **[waits for M3]**
   - Without M3: after all three seats show **Address checked**, L1 opens the Solana tab and
     clicks **Add Solana**. Keep L1, L2 and L3 open on the wallet until every seat shows its
     Solana key ready.
   - With SOL-4, before the first spend of Demo A: on the Solana tab, in the card **Local
     proving**, click **Test this device, then prove on our devices**. Confirm "Turn on local
     proving for every device of this group? It cannot be turned off." Then reload every open
     Zigs tab of the group, and make the Solana backups after this step (step 9), as the card
     says. **[waits for SOL-4]**
     - Each seat then shows "Local proving: this device made a test proof in N s." On the test
       Mac of 18 October 2026, a test proof took 6.3 to 6.6 s.
     - A seat that shows "Local proving: this device could not make a test proof, so it cannot
       pay for this group." cannot pay. Use another device for that seat.
     - If the card says "Helius changed the Solana pool after this version of Zigs was tested
       with it. Local proving cannot be turned on until Zigs is tested with the new pool.",
       Devnet moved: follow the "pool program" row of section 6.
     - Keep local proving off on the spare wallet (step 10). A group with local proving on can
       never go back to the hosted prover. If a Devnet change breaks the web prover, Demo A
       cannot pay until a Zigs update brings a new prover. The spare wallet, with the hosted
       prover and Devnet SOL on its fee addresses, is then the fallback.
9. Save the backups of each seat: the Zcash file (**Back up key share**) and the Solana file
   (**Back up Solana part, seat N** on the Solana tab). Keep the two passphrases offline. Restore
   one seat on a blank browser profile once.
10. Fund Demo A with Zcash: one Valar drip (0.125 TAZ), plus coins from the permanent test wallet
    if needed. Wait for 3 confirmations (about 75 s at 25 s a block). Make a **spare wallet** in the
    same way as Demo A, with Solana, and fund it in the same way (steps 10 to 12). It is the
    fallback for a Send hold (S7) and for an open Solana proposal (S4).
11. Fund the fee address of all three seats with Devnet SOL, at least 0.03 SOL each (S3), and at
    least 0.05 SOL for the seat that adds SOL in step 12. A seat that proposes or executes needs
    about 0.003 SOL. The **Get Devnet SOL** link opens faucet.solana.com. Click **Check balance** on
    each seat.
12. On one seat, use **Add SOL** twice (default 0.02 SOL each). The group then holds two notes,
    so one open proposal cannot hold all of them (S4). Click **Sync Solana** and read the private
    balance.
13. Create **Payee**: a second wallet with Zcash and Solana. Save its Zcash address (`utest1…`) and
    the 198-character shielded address from its Solana tab in a private note on L1.
14. Optional: make one Solana proposal on the spare wallet, not on Demo A, at least 23 hours
    before the demo, and approve nothing. An open proposal holds the notes of its wallet for 23
    hours, and nothing can cancel it before then (S4). The card **Rent of old proposals** is always
    on the Solana tab. After the expiry, open the spare wallet once, then click **Look for rent**: a
    row with the amount and **Get it back** shows.

### T-1 day and T-1 hour

15. Use three laptops with desktop Chrome or Safari. No private window. No chat app browser. One
    tab for each wallet. A phone may approve. Build the proof on a laptop unless a phone run was
    rehearsed.
16. Rehearse the whole script once on the real laptops and network. Write down the time of the
    Zcash ceremony, the Solana ceremony, the proof and the Solana execute. If the live setup takes
    more than 2.5 minutes, narrate it and switch to Demo A.
17. Open both explorers once: testnet.zecblock.com and the Solana explorer on Devnet.
18. T-1 hour:
    - Run `sh solspike/demo-check.sh` again. It also checks the three fee balances.
    - With local proving on Demo A: check that the "pool program" line of demo-check shows the
      deploy slot that Zigs pins (508,538,476, deployed 7 October 2026 at 18:01 UTC). Make one
      payment on Demo A, proved on the device. **[waits for SOL-4]**
    - Confirm the Zcash **Available** balance of Demo A in the app.
    - Cancel a Zcash payment that has no approval (**Cancel payment**). A Solana proposal ends
      only at its expiry. Confirm that no approval hold blocks Send on Demo A.
    - Type the ZNS name (placeholder `zigsdemo.zec`) in the Send form of Demo A, and compare
      the address with the note.
      Close the form without a proposal. **[waits for M10]**
19. Keep a phone hotspot as a backup network. Check that the recording plays offline on L1, and
    that its pins equal the demo-check output.

## 4. Demo script: 10 minutes

Rule for the whole demo: never click Cancel after Approve. Keep each payment open until its status
says Sent (Zcash) or Executed (Solana).

| Time | Who | Step | Expected result | Needs |
|---|---|---|---|---|
| 0:00 | L1 | Open app.zigs.app. Say: Zcash testnet and Solana Devnet only, not audited. Click **New wallet**. | The picker shows Testnet only. | M1 |
| 0:45 | L1 | Type a name. Set **Signers** to 3 and **Approvals needed** to 2. Turn on Solana. Click **Create wallet**. | The invite card shows. | **[waits for M3]** |
| 1:15 | L1, L2, L3 | L1 clicks **Copy link** and sends the link to L2 and L3 through an end-to-end encrypted chat. L2 and L3 open it in Chrome or Safari, enter the password if the browser asks, type a name, then click **Take seat**. A phone scans the QR code instead. | 3 of 3 seats taken. | D1, S10 |
| 1:45 | L1, L2, L3 | Read the safety number aloud. Each person clicks **It matches**. Narrate the progress card: Zcash key, Solana key, fee address. Keep L1 open until every seat shows its Solana key ready (D7). | Both ceremonies run. Each seat shows **Address checked** and its Solana key ready. | **[waits for M3]**, M4 |
| 3:00 | L1 | Switch to Demo A. Show the Zcash address, the **Available** balance and the Solana tab. Click **Sync Solana**. | Both balances show. | S2 |
| 3:30 | L1 | Click **Receive**: show the address and the faucet link. Do not use the faucet live. Click **Send**. Type the ZNS name of the demo payee (placeholder `zigsdemo.zec`, step 6). Enter 0.01. Click **Propose payment**. | The form shows the address that the name gives. A payment opens with the name and the address. | M2, **[waits for M10]**: paste the utest1 address of Payee instead |
| 4:00 | L2 | Open the payment. Read **What this payment does**. Click **Approve payment**. Keep the payment open. | One approval. With a name, L2 looks it up itself and gets the same address. | **[waits for M5]**, M10 |
| 4:30 | L1 | Click **Approve payment**. Click **Build proof**. Narrate the privacy model during the proof (about 1 minute). | The proof builds. | **[waits for M5]** |
| 5:45 | L1 | Click **Send to network**. Click **View in explorer**. | The status shows **Confirming**, then **Sent** after the next sync sees the block. The explorer shows the transaction. | S9 |
| 6:15 | L1 | Open the Solana tab. Under **Pay from the group**, paste the 198-character shielded address of Payee into **Payee (full shielded address)**. Compare it with the note, character by character: a wrong payee holds the note for 23 hours, and nothing can cancel it (S4). Enter 0.01. Click **Send privately**. | A Solana proposal opens: **Collecting approvals**. | S15 |
| 6:45 | L1 | When the screen shows the payment, click **Approve as seat 1**. | Approvals: 1 of 2. | S17 |
| 7:00 | L2 | Open the Solana tab. Wait until the screen shows the payment, not "Zigs is reading your wallet" (up to about 25 s). Click **Approve as seat 2**. | Approvals: 2 of 2. The status says **Approved, executing**. | S6, S17 |
| 7:30 | L1 | Wait for the execute: a seat with a funded fee address executes by itself. Click **Sync Solana**. | The status says **Executed**. The private balance drops. | S3, S2 |
| 8:15 | L1 | Open the transaction in the Devnet explorer. | The explorer shows it. | **[waits for S16]**: paste the id into the explorer |
| 8:45 | L1 | Switch to the spare wallet. On its Solana tab, click **Look for rent** in the card **Rent of old proposals** (step 14). Do not click **Get it back**: it is a Devnet write. Show the backup buttons. Say what is public (section 7). | The words match ZOLANA.md and PRIVACY.md. | M6 |
| 9:30 | L1 | Close: both chains are test networks, the web app makes no mainnet wallets, and the code is not audited. | | M1 |

## 5. If M3 slips: two ceremonies

- At 0:45, create the wallet without the Solana choice.
- At 1:45, run the Zcash ceremony.
- When all three seats show **Address checked**, L1 opens the Solana tab and clicks
  **Add Solana**.
- Keep L1, L2 and L3 open on this wallet until all three seats show their Solana key ready (D7,
  S14).
- If this takes more than 3 minutes, stop and switch to Demo A.

## 6. Contingencies

The recorded run (section 3) is the fallback for the rows about a Helius error, a moved pool, a
Solana error, a server problem and a synced balance that is too low.

| Problem | Action |
|---|---|
| The light-wallet server is slow | Wait. The ChainSafe fallback works (S9) |
| Solana shows a Helius error | Wait one minute. Then show the Zcash part and the recorded run (S5) |
| demo-check says FAIL for "pool program", "approvals program", "tree 0" or "prover": Devnet moved. For example, the Devnet pool (`sppU489D…`) no longer has the hash `3641ffe2…`, or its tree 0 changed. Helius plans SDK releases with breaking changes before its mainnet launch | Stop the Solana part, show the recorded run, and tell the coordinator. No repin in the last week (section 3) |
| A Solana error that starts with "WalletError", "ClientError" or "Solana error #" and stays after one minute | Stop the Solana part, show the recorded run, and tell the coordinator |
| The side bar says "Connecting to the group server…" for a long time, or "The group server does not answer" | Read the reason in brackets (S1). For "no network" or "too many connections from this network" (M9), move one laptop to the phone hotspot. For "the preview password is missing or wrong", reload the page and enter the password. For "the server has a problem", wait one minute, then show the recorded run |
| A hold blocks Send | Use the spare wallet (S7) |
| Demo A, with local proving on, says "This group makes its proofs on its devices, and the local prover no longer fits the Solana pool" | Pay from the spare wallet, which uses the hosted prover. The page sent nothing to Helius for that payment, and the funds of Demo A stay in the pool until a Zigs update brings a new prover. **[waits for SOL-4]** |
| Solana says "the synced balance does not cover the amount" | An open proposal holds the notes (S4). Use the spare wallet, or show the recorded run |
| A seat laptop is lost | Restore the seat from its two backup files (M4) |
| L2 refuses the payment: the name gives another address | L1 has not approved yet, so L1 cancels the payment and proposes again with the pasted utest1 address. **[waits for M10]** |
| The faucet refuses a claim | One claim for each IP address and for each address every 24 hours. Use coins from the permanent test wallet |

## 7. What to say about privacy

- **Zcash.** On chain, the payment is a shielded Ironwood transaction. It shows no group, no
  signers, no addresses and no amounts. Its one-day expiry is the mark that differs from a
  standard wallet. The laptops make the signature shares and the proof, so no server holds a key.
  The group server stores only sealed, padded values.
- **Solana.** The amount of a private payment is hidden on chain. The owner key of the payee, the
  fee address of the seat that pays and the group are public. The hosted prover of Helius sees
  each payment while it builds the proof. Helius has a browser prover (zolana-web-sdk), which
  Helius calls experimental. With SOL-4, Demo A makes every proof on its devices, so Helius
  gets no witness of its payments. **[waits for SOL-4]** The Zigs server operator can link
  the wallet to its Solana addresses by timing.
- **ZNS.** Our Worker downloads the whole testnet registry, and each device looks the name up
  itself. So no resolver learns which name a person pays. **[waits for M10]**
- **Limits.** Zcash testnet and Solana Devnet only. The code is not audited. PRIVACY.md lists the
  known leaks.

## 8. After the demo

1. Set WS_PER_IP back to 60 in both entries of `cf/wrangler.jsonc`, and deploy (D6).
2. Return the lwd box to the day-to-day plan, with the ChainSafe fallback (D5).
3. Read the Helius usage against the plan limits (D4).
4. Send spare TAZ back to the Valar faucet.
