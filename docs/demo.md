# Zigs demo runbook

**Status: draft of 18 October 2026.** Sources: sections 3, 8 and 9 of
[hackathon-release.md](hackathon-release.md) (main a29e9ea) and the page code on main. A step
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

Status on 18 October 2026: M6 is on main (8330312). The other items are not.

| Item | What the demo needs | Without it |
|---|---|---|
| M1 | The network picker shows Testnet only | Keep Testnet. Say that mainnet is off for this release |
| M2 | Get testnet ZEC opens the Valar faucet | Open https://faucet.testnet.valargroup.dev/ by hand |
| M3 | One setup for Zcash and Solana | Run two ceremonies: section 5 |
| M4 | A restored seat can join the Solana ceremony | Restore a seat only after its Solana part is ready |
| M5 | Zcash signing goes on when the payment drawer is closed | Keep the payment open on every approving laptop until it says Sent |
| M6 | The Solana approval screen says what is public | Do not read the old sentence aloud. Say the public parts (section 7) |
| M8 | `solspike/demo-check.sh` | Run `solspike/harness/sol-live.mjs` and `sol-cors.mjs` by hand |
| M9 | WS_PER_IP at 600 for the demo week (D6) | Use one network for each laptop, or the phone hotspot |
| M10 | Pay to a ZNS name | Paste the utest1 address of Payee |
| S2 | The Solana balances refresh by themselves | Click **Sync Solana** after each Solana step |
| S3 | Only a funded seat executes | Fund the fee address of all three seats |
| S7 | The Send hold ends after Approve then Cancel | Never click Cancel after Approve. Keep a spare funded wallet |
| S8 | One open Zcash proposal at a time | Make one proposal at a time |
| S10 | The invite text names the password | Give each person the password before the scan |
| S15 | Copy buttons for the Solana addresses | Copy the payee address from the private note on L1 |
| S16 | Explorer links for Solana ids | Paste the id into https://explorer.solana.com/?cluster=devnet |
| S17 | A neutral line while a device reads the wallet | The Approve button shows during the read. While the red text "Zigs is reading your wallet" shows, do not click. Wait until the screen shows the payment (up to about 25 s) |

## 2. Owner decisions that apply

Decided by the owner on 18 October 2026:

- **D1 Password.** The password gate stays. The browser asks for a user name and a password. Any
  user name works: the Worker checks the password only. The host gives the password. Never write
  it into a file, a chat or the invite text.
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

### T-7 days

1. Helius: add app.zigs.app and staging.zigs.app to Allowed Domains. Read the plan limits. Set a
   usage alert (D4).
2. Power on the lwd box (D5).
3. Set WS_PER_IP to 600 in both entries of `cf/wrangler.jsonc` (production and staging), and
   deploy (D6, M9). Write the date to set it back.
4. Run `solspike/demo-check.sh` (M8). Fix every FAIL. **[waits for M8]**
5. Prove the faucet: copy the address of a Zigs testnet wallet, then claim one Valar drip into it.
   The drip is 0.125 TAZ, once for each IP address every 24 hours (M2).
6. Claim a testnet name for the demo payee: one small testnet payment to the ZNS Mint.
   **[waits for M10]** The name `zigsdemo` in this file is a placeholder: the owner chooses the
   final name. Open question for the owner: M10 decided "no names for groups while ZNS
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
9. Save the backups of each seat: the Zcash file (**Back up key share**) and the Solana file
   (**Back up Solana part, seat N** on the Solana tab). Keep the two passphrases offline. Restore
   one seat on a blank browser profile once.
10. Fund Demo A with Zcash: one Valar drip (0.125 TAZ), plus coins from the permanent test wallet
    if needed. Wait for 3 confirmations (about 75 s at 25 s a block). Fund a spare wallet in the
    same way.
11. Fund the fee address of all three seats with Devnet SOL, at least 0.03 SOL each (S3). A seat
    that proposes or executes needs about 0.003 SOL. The seat that adds SOL also needs the 0.02 SOL
    of step 12. The **Get Devnet SOL** link opens faucet.solana.com. Click **Check balance** on
    each seat.
12. On one seat, use **Add SOL** (default 0.02 SOL). Click **Sync Solana** and read the private
    balance.
13. Create **Payee**: a second wallet with Zcash and Solana. Save its Zcash address (`utest1…`) and
    the 198-character shielded address from its Solana tab in a private note on L1.
14. Optional: make one Solana proposal on Demo A 24 hours before the demo. After it expires, the
    card **Rent of old proposals** shows.

### T-1 day and T-1 hour

15. Use three laptops with desktop Chrome or Safari. No private window. No chat app browser. One
    tab for each wallet. A phone may approve. Build the proof on a laptop unless a phone run was
    rehearsed.
16. Rehearse the whole script once on the real laptops and network. Write down the time of the
    Zcash ceremony, the Solana ceremony, the proof and the Solana execute. If the live setup takes
    more than 2.5 minutes, narrate it and switch to Demo A.
17. Open both explorers once: testnet.zecblock.com and the Solana explorer on Devnet.
18. T-1 hour:
    - Run demo-check again. **[waits for M8]**
    - Confirm the Zcash **Available** balance of Demo A and the three fee balances.
    - Close old proposals. Confirm that no approval hold blocks Send on Demo A.
    - Type the ZNS name (placeholder `zigsdemo.zec`) in the Send form of Demo A, and compare
      the address with the note.
      Close the form without a proposal. **[waits for M10]**
19. Keep a phone hotspot as a backup network. Keep a screen recording of a full run.

## 4. Demo script: 10 minutes

Rule for the whole demo: never click Cancel after Approve. Keep each payment open until its status
says Sent (Zcash) or Executed (Solana).

| Time | Who | Step | Expected result | Needs |
|---|---|---|---|---|
| 0:00 | L1 | Open app.zigs.app. Say: Zcash testnet and Solana Devnet only, not audited. Click **New wallet**. | The picker shows Testnet only. | M1 |
| 0:45 | L1 | Type a name. Set **Signers** to 3 and **Approvals needed** to 2. Turn on Solana. Click **Create wallet**. Show the invite QR code. | The invite card shows. | **[waits for M3]** |
| 1:15 | L2, L3 | Scan the QR code. Enter the password if the browser asks. Type a name, then click **Take seat**. | 3 of 3 seats taken. | D1, S10 |
| 1:45 | L1, L2, L3 | Read the safety number aloud. Each person clicks **It matches**. Narrate the progress card: Zcash key, Solana key, fee address. Keep L1 open until every seat shows its Solana key ready (D7). | Both ceremonies run. Each seat shows **Address checked** and its Solana key ready. | **[waits for M3]**, M4 |
| 3:00 | L1 | Switch to Demo A. Show the Zcash address, the **Available** balance and the Solana tab. Click **Sync Solana**. | Both balances show. | S2 |
| 3:30 | L1 | Click **Receive**: show the address and the faucet link. Do not use the faucet live. Click **Send**. Type the ZNS name of the demo payee (placeholder `zigsdemo.zec`, step 6). Enter 0.01. Click **Propose payment**. | The form shows the address that the name gives. A payment opens with the name and the address. | M2, **[waits for M10]**: paste the utest1 address of Payee instead |
| 4:00 | L2 | Open the payment. Read **What this payment does**. Click **Approve payment**. Keep the payment open. | One approval. With a name, L2 looks it up itself and gets the same address. | **[waits for M5]**, M10 |
| 4:30 | L1 | Click **Approve payment**. Click **Build proof**. Narrate the privacy model during the proof (about 1 minute). | The proof builds. | **[waits for M5]** |
| 5:45 | L1 | Click **Send to network**. Click **View in explorer**. | Status Sent. The explorer shows the transaction. | S9 |
| 6:15 | L1 | Open the Solana tab. Under **Pay from the group**, paste the 198-character shielded address of Payee into **Payee (full shielded address)**. Enter the amount. Click **Send privately**. | A Solana proposal opens: **Collecting approvals**. | S15 |
| 6:45 | L1 | When the screen shows the payment, click **Approve as seat 1**. | Approvals: 1 of 2. | S17 |
| 7:00 | L2 | Open the Solana tab. Wait until the screen shows the payment, not "Zigs is reading your wallet" (up to about 25 s). Click **Approve as seat 2**. | Approvals: 2 of 2. The status says **Approved, executing**. | S6, S17 |
| 7:30 | L1 | Wait for the execute: a seat with a funded fee address executes by itself. Click **Sync Solana**. | The status says **Executed**. The private balance drops. | S3, S2 |
| 8:15 | L1 | Open the transaction in the Devnet explorer. | The explorer shows it. | **[waits for S16]**: paste the id into the explorer |
| 8:45 | L1 | Show the card **Rent of old proposals** (step 14) and the backup buttons. Say what is public (section 7). | The words match ZOLANA.md and PRIVACY.md. | M6 |
| 9:30 | L1 | Close: both chains are test networks, there is no mainnet, and the code is not audited. | | M1 |

## 5. If M3 slips: two ceremonies

- At 0:45, create the wallet without the Solana choice.
- At 1:45, run the Zcash ceremony.
- When all three seats show **Address checked**, L1 opens the Solana tab and clicks
  **Add Solana**.
- Keep L1, L2 and L3 open on this wallet until all three seats show their Solana key ready (D7,
  S14).
- If this takes more than 3 minutes, stop and switch to Demo A.

## 6. Contingencies

| Problem | Action |
|---|---|
| The light-wallet server is slow | Wait. The ChainSafe fallback works (S9) |
| Solana shows a Helius error | Wait one minute. Then show the Zcash part and the recorded run (S5) |
| The page shows "Connecting" for a long time | Switch to the phone hotspot (S1) |
| A hold blocks Send | Use the spare wallet (S7) |
| A seat laptop is lost | Restore the seat from its two backup files (M4) |
| L2 refuses the payment: the name gives another address | L1 has not approved yet, so L1 cancels the payment and proposes again with the pasted utest1 address. **[waits for M10]** |
| The faucet refuses a claim | One claim for each IP address every 24 hours. Use coins from the permanent test wallet |

## 7. What to say about privacy

- **Zcash.** On chain, the payment is a shielded Ironwood transaction. It shows no group, no
  signers, no addresses and no amounts. Its one-day expiry is the mark that differs from a
  standard wallet. The laptops make the signature shares and the proof, so no server holds a key.
  The group server stores only sealed, padded values.
- **Solana.** The amount of a private payment is hidden on chain. The owner key of the payee, the
  fee address of the seat that pays and the group are public. The hosted prover of Helius sees
  each payment while it builds the proof. The Zigs server operator can link the wallet to its
  Solana addresses by timing.
- **ZNS.** Our Worker downloads the whole testnet registry, and each device looks the name up
  itself. So no resolver learns which name a person pays. **[waits for M10]**
- **Limits.** Zcash testnet and Solana Devnet only. The code is not audited. PRIVACY.md lists every
  known leak.

## 8. After the demo

1. Set WS_PER_IP back to 60 in both entries of `cf/wrangler.jsonc`, and deploy (D6).
2. Return the lwd box to the day-to-day plan, with the ChainSafe fallback (D5).
3. Read the Helius usage against the plan limits (D4).
4. Send spare TAZ back to the Valar faucet.
