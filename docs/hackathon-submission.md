# Zecathon submission

**Status: draft of 20 October 2026.** The owner submits it. Deadline: 28 October 2026, 23:59 UTC.
Sources: [hackathon-release.md](hackathon-release.md) (the live records),
[PRIVACY.md](../PRIVACY.md), the judge walkthrough of the [README](../README.md) and
[demo.md](demo.md).

## 1. Form fields

| Field | Value |
|---|---|
| Project name | Zigs |
| Track | Cross-Chain or Shielded Payments: the owner chooses (section 2) |
| Description | Section 3 (at most 2,000 characters) |
| Public repository | https://github.com/devzigs/zigs (public since 26 October 2026) |
| Demo URL | https://app.zigs.app |
| Demo video | A two-minute video (section 5). The owner uploads it and pastes the URL |

## 2. Which track

**Cross-Chain.** One group of devices controls a shielded Zcash wallet and a private SOL balance in
the Zolana pool on Solana Devnet. One setup makes both keys on the same devices, and the same
approval rule (any t of n devices) holds on both chains. Each chain keeps its own keys and its own
privacy model, and the app says what each chain hides and what it shows. The live Devnet runs
cover the setup, the restore of every device, private payments and a withdrawal.

**Shielded Payments.** A shielded Zcash payment that a group approves has the shape of a payment
from a standard Zcash wallet, except for its one-day expiry and an optional priority fee, which can
mark it. Zigs needs no trusted dealer and no server that can read the wallet.
Each device decodes the transaction itself before it approves, and payments can go to a ZNS name
with no server learning which name. The Solana part is a second, weaker privacy rail, so the
Zcash part carries the case.

## 3. Description

Character count: 1,976 (the text between the two lines below, with its 14 line breaks; 1,990 if the
form counts each line break as two characters).

---
Zigs is a shared wallet for shielded Zcash and for private SOL in the Zolana pool on Solana Devnet. Each device of a group holds one key share of FROST threshold keys. Nobody holds the whole key. Any t of n devices approve each payment. One setup makes both keys on the same devices.

Real and live (web app, testnet and Devnet):
- Zcash: re-randomized FROST (ZIP 312) on the Ironwood pool. Each device decodes the transaction itself and binds its approval to the sighash. On chain, a Zigs payment has the shape of a payment from a standard Zcash wallet, except for its one-day expiry and an optional priority fee, which can mark it. Nothing shows that a group signed it, who the devices are, or which of them approved.
- Pay to a ZNS name: a testnet payment to craftsoldier.zec landed on 19 October 2026 (block 4,518,023); each approving device checked the name again. No server learns which name you pay.
- Solana: a Zigs program owns the funds of the group. Live Devnet runs on 18 and 19 October 2026 made a 3-device wallet in one setup, restored every device from backup files, and sent two private payments and a withdrawal. A device restored before the Solana setup still joined it.
- The group server relays and stores encrypted data. It cannot read names, addresses, amounts, notes or transactions, but it sees which IP addresses open which wallet, and when.

Not done or not hidden:
- Testnet and Devnet only: the web app makes no mainnet wallets. Not audited.
- On Solana, a private payment hides its amount, but the owner key of the payee is public. The chain also links the group key, the program address and the fee addresses in public.
- The hosted prover of Helius sees the witness of each Solana spend: owners, assets, amounts, blindings and the nullifier secret. With local proving on, nobody: the proof runs on the device.
- Mock: only the illustration screens on zigs.app. Each payment above is a real testnet or Devnet transaction.

Licence: AGPL-3.0-only.
---

Sources of each claim:

| Claim | Source |
|---|---|
| On chain, nothing shows a group; the expiry and an optional priority fee can mark it | PRIVACY.md, Summary and On chain; README, judging criteria |
| Each device decodes the transaction and binds its approval to the sighash | README, judging criteria (Originality) |
| The ZNS payment, block 4,518,023; no server learns the name | hackathon-release.md M10 status; PRIVACY.md, Summary |
| The Devnet runs: one setup, restore of every device, two payments, a withdrawal | hackathon-release.md M3 and the nonce lock record (18 and 19 October) |
| A device restored before the Solana setup joined it | hackathon-release.md M4 (`scenario-e.mjs`) |
| The group server sentence | PRIVACY.md, Summary and the table of the group server |
| The Solana sentences and the hosted prover | PRIVACY.md, Solana beta: approvals program, the Zolana table, Local proving |
| AGPL-3.0-only | LICENSE and README, License |

## 4. Judge access

Put this in the form:

```text
Demo: https://app.zigs.app
No password and no account: the app opens in a desktop browser.
```

Try it alone, from one desktop browser (the README has every step):

1. Open https://app.zigs.app. Click **Set up a wallet**, then **Set up my
   wallet**. Open **Advanced approval rule**, set **Devices** to 2 and **Approvals needed** to 2,
   tick the box under the warning and click **Next**. Keep **Also set up Solana Devnet** ticked.
   Click **Review wallet**, then **Create wallet**.
2. Open **Trying Zigs alone? Play the other devices in this browser** and click **Play device 2**.
   Within half a minute the wallet opens, and the Solana key follows by itself.
3. Click **Receive** and get test coins from the faucet link (if it does not pay, step 4 of the
   README gives other ways). Click **Send**, paste a `utest1` address and an amount, then click
   **Review payment** and **Propose payment**. Click **Approve as device 1** and **Approve as
   device 2**, then **Build proof** and **Send to network**. For Solana, click **Open Solana** and
   follow steps 9 to 12 of the README.

## 5. Video script: 2 minutes

Record only the browser window, in a clean profile, with no menu bar, notifications or real names
(docs/demo.md section 3, "First recording"). The scenes follow section 4 of
docs/demo.md, cut to 2:00. **Prepared** marks a scene that needs the funded wallets of
docs/demo.md section 3 (Demo A, Payee, the fee addresses and Add SOL) before the recording.

| Time | Show | Say | Prepared |
|---|---|---|---|
| 0:00 | The start screen of app.zigs.app | "Zigs is a shared wallet for shielded Zcash and private SOL. It runs on Zcash testnet and Solana Devnet, and it is not audited." | |
| 0:10 | **Set up a wallet**, the rule any 2 of 3 devices, **Also set up Solana Devnet**, **Create wallet**. Cut to the other devices that join and click **It matches** | "Each device makes its own key share. One setup makes the Zcash key and the Solana key. Nobody holds the whole key." | |
| 0:30 | Demo A: the Zcash balance. **Send**: type the demo name, or paste the Payee address. **Review payment** | "The review is what this device decoded from the transaction itself." | Yes |
| 0:45 | **Propose payment**. Device 1 and a second device each click **Approve payment**. **Build proof** (cut the wait) | "Any 2 of 3 devices approve. Each one checks the payee and the amount before it signs." | Yes |
| 1:00 | **Send to network**, **View in explorer** | "On chain, this has the shape of a payment from a standard Zcash wallet, except its one-day expiry and an optional priority fee, which can mark it. Nothing shows that a group signed it." | Yes |
| 1:10 | **Open Solana** on Demo A: the private balance. **Send privately** to the Payee address. Two devices approve | "The same devices approve a private SOL payment in the Zolana pool." | Yes |
| 1:30 | The status **Executed** and its explorer link | "The amount is hidden. The owner key of the payee, the group and the fee address that pays are public." | Yes |
| 1:40 | The card **Local proving** | "By default the hosted prover of Helius sees each Solana spend. With local proving on, the proof runs on the device." | |
| 1:50 | The README and the repository | "Testnet and Devnet only, not audited, open source under AGPL-3.0." | |

Do not show a real name, the seed of an account or a backup passphrase.

## 6. Owner checklist

1. Register on the Zecathon site. The form asks for a real-name profile that only the organisers
   and the judges see. Check it against the pseudonymous identity rule before you register.
2. Done on 26 October 2026: the repository is public. The website repository stays private.
3. Pick the track: Cross-Chain or Shielded Payments (section 2).
4. Prepare the wallets of docs/demo.md section 3, record the video of section 5, upload it, and
   keep its URL.
5. Paste the description of section 3, the repository URL, the demo URL and the video URL.
6. The day before the deadline, run `sh solspike/demo-check.sh` and fix every FAIL. The judges use
   app.zigs.app.
7. Submit before 28 October 2026, 23:59 UTC.
