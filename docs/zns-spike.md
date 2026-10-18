# ZNS spike: Zcash Names for Zigs wallets

Research spike of 18 October 2026, ticket ZNS-1. It has no product code. It answers how Zigs, a
t-of-n FROST wallet, can pay to a name and register a name with ZNS, the Zcash naming service. All
web pages were read on 18 October 2026. The project's documents say "Last updated on October 15,
2026". Code references name a commit (see [Sources](#sources)).

## Summary

- **What it is.** ZNS is the protocol of "Zcash Names" (zcashnames.com). ZcashMe, Inc. runs it. A
  name such as `alice` (shown as `alice.zcash` or `alice.zec`) maps to one unified address.
- **Status.** Testnet is active. Mainnet is "live in beta". Early Access for people on the
  waitlist started on 15 October 2026. Open registration starts on 30 October 2026 at the
  earliest. An external audit is in progress. No wallet ships name resolution yet. On 18 October
  2026 the public resolvers listed 137 names on mainnet and 1 name on testnet.
- **Resolution.** The registry is on chain. A single registrar, the Mint, writes each change of a
  name into the memo of an Ironwood note. The viewing key of the registry is public, so anyone can
  rebuild the registry from the chain. Open-source resolvers serve it over JSON-RPC.
- **Registration.** A claim is one shielded payment to the Mint with a text memo. A Zigs group can
  most likely make it today: paste the ZIP 321 link that zcashnames.com builds into the Send form.
  This was not tested.
- **Main finding.** After the claim, control of a name is **1-of-n** for a Zigs group, not t-of-n.
  ZNS gives control to whoever can read memos at the bound address. Every signer can do that, and
  so can every holder of the invite link. Any one of them can point the name at their own address.
  Zigs cannot prevent this. It can only detect it.
- **Privacy.** A name makes the link between the name and the wallet address public and permanent.
  A name lookup through a remote resolver tells its operator which name you pay. A download of the
  whole registry avoids that leak.
- **Recommendation.** Build "pay to a name" on testnet first. Download the whole registry through
  the app Worker and look names up on the device. Size: 4 to 6 days for the web app. For "register
  a name for a group", build only a guided claim and a watcher (3 to 4 days). Ask ZcashMe for an
  authorization that a FROST group can sign t-of-n before Zigs offers updates.

## 1. Status

### 1.1 Who runs it

| Fact | Source |
|---|---|
| The press contact is "CEO/Founder, ZcashMe, Inc." The protocol "succeeds ZECpages" and "draws on ZcashMe" | Press release, 15 October 2026 [P1] |
| The code is in the GitHub organization `zcashme`: `zns-mint`, `zns-resolver`, `zns-verify`, `zns-whitepaper`. The web app repo `zcashme/zcashnames` is not public on 18 October 2026 (GitHub answers 404) | [R1] to [R4] |
| Zcash Community Grants funds the work. The grant post of 19 May 2026 says that the service runs on "trusted infrastructure" and that beta names are temporary | Forum grant thread [F1] |
| The Mint runs in an AMD SEV-SNP confidential VM with measured boot, next to a Zebra node. It runs on testnet since 30 September 2026 | Forum update of 1 October 2026 [F1]; docs "The Mint" [D9] |
| An external audit started on 7 October 2026. Its final report is expected on 21 October 2026. A security competition ended on 13 October 2026 | Forum update of 8 October 2026 [F1]; roadmap "Security Review: In progress" [D3] |

### 1.2 Launch state

| Item | State on 18 October 2026 | Source |
|---|---|---|
| Testnet | "Active. Claims open." | Ecosystem page [D2] |
| Mainnet | "Beta. Claims open." The docs home says "Mainnet is live in beta." | [D2], [D1] |
| Early Access | Started on 15 October 2026 at 12:00 Eastern. Waitlisted people claim in waves with access codes | [D4], [P1] |
| Open registration | "October 30 or after all reserved participants have had an opportunity to register, whichever comes later" | [P1], roadmap [D3] |
| Protected names | 1,564 names need a six-digit access code to be claimed | [P1], [D7] |
| Wallet resolution | "No wallet has shipped ZNS resolution yet." Edge and Unstoppable are "Implementing" | Ecosystem page [D2] |
| Live registry | Mainnet: 137 names, resolvers synced to height 3,521,858. Testnet: 1 name (`craftsoldier`), synced to 4,514,470 | `status` and `list_names` calls on the three public resolvers |
| Current registries | They start at the Mint ceremony: mainnet height 3,518,764, testnet height 4,504,792 | "Running a Resolver" [D12] |

The current registries are new. Estimate from the heights: 3,094 mainnet blocks at 75 seconds and
9,678 testnet blocks at 25 seconds give about 2.7 days each. So both registries started near 15
October 2026. Names from the earlier beta are not in them. A mainnet endpoint for the beta,
`light.zcash.me/zns-mainnet-test`, "will sunset after beta".

The press release says that "Fourteen wallets, explorers, and other apps ... integrated Zcash Names
during earlier beta releases". The project's own Ecosystem page says that no wallet ships
resolution yet. The two statements differ. The Ecosystem page is more specific. One example:
Unstoppable iOS merged name resolution on 28 September 2026 [U1]. That change checks an Ed25519
signature of the registrar and handles "DELIST" records. The current protocol has neither. So the
earlier integrations follow an older design.

### 1.3 The claims of the secondary wiki

| Claim | Result |
|---|---|
| ZNS uses an on-chain registry | Confirmed. Name Notes in Ironwood memos, with a published viewing key (whitepaper, [W1]) |
| ZNS uses a waitlist | Confirmed. The waitlist leads to Early Access [D4] |
| The name-to-address mapping is public | Confirmed. "The registry is public" (docs, Privacy [D6]) |
| ZNS introduced itself on 13 April 2026 | Not confirmed from the project's own material. The earliest items found: a forum post of 31 March 2026 that announces a ZcashNames talk on 7 April 2026 [F2]; the grant post of 19 May 2026, which says that the waitlist started about 50 days before (near 30 March) [F1]; the roadmap, which puts the waitlist in "Alpha v1" (9 March to 19 April 2026) [D3]. An X post of the project on 13 April 2026 may exist. We did not read X |

**Another service with a similar name.** `zcashnames.co` (with `.co`) also sells `.zcash` names. It
launched on mainnet in August 2026 and is not related to ZNS. A forum member who edits the thread
says: "Zcash.me and zcashnames.com are separate services from zcashnames.co" [F3]. A name in one
registry can point to another address in the other one. Zigs must name the registry that it uses.

## 2. Resolution

### 2.1 How the registry works

1. **Name Note.** For each accepted change, the Mint makes an Ironwood output to its registry
   account. The memo holds the change [W1, section 3]:

   ```
   ZNS:claim:<name>:<ua>:<expires_at>:<prev_rcm>
   ZNS:update:<name>:<ua>:<expires_at>:<prev_rcm>
   ZNS:release:<name>:<ua>:none:<prev_rcm>
   ```

   A name is 1 to 63 bytes of `a-z` and `0-9`. `.zcash` and `.zec` are display forms only.
2. **Binding.** The note commitment randomness `rcm` and `psi` are a BLAKE2b-512 hash of the
   tuple (action, name, address, expiry, previous `rcm`) with the tag `ZcashName/v1`. So the
   on-chain `cmx` commits to the memo. Nobody can show another memo for the same note.
3. **Mint authorization.** The registry viewing key is public, so anyone can make an output to
   the registry. An update or release counts only when its transaction spends the current Name
   Note of the name. A claim counts only when it spends one live anchor: a zero-value note from a
   pool of 40 that the Mint made in its setup transaction. Only the Mint key can spend these notes.
4. **Order.** A resolver applies the accepted changes in block order. A reorganisation rolls the
   state back. Two resolvers that read the same chain get the same registry.

### 2.2 Interfaces

- **JSON-RPC 2.0 over HTTP POST**, five read-only methods: `resolve`, `list_names`,
  `reverse_lookup`, `events`, `status` [D11]. A record has `name`, `address`, `txid`, `height`,
  `last_action` and `expires_at`. `status` returns the registry viewing key and the treasury
  address. Pages hold at most 500 records.
- **Public endpoints** [D10]: testnet `https://light.zcash.me/zns-testnet`; mainnet
  `https://light.zcash.me/zns-mainnet` and `https://main.zcashnames.com`. All three answered on 18
  October 2026, and each `status` showed the published registry key.
- **SDK:** `zcashname-sdk` 0.15.0-rc.1 (TypeScript). Its default network is testnet.
- **Own resolver:** `zcashme/zns-resolver` (Rust). It reads compact blocks from any lightwalletd,
  trial-decrypts Ironwood outputs with the registry key from the ceremony height, and keeps the
  registry in SQLite. Network, key and ceremony height are build constants [D12].

### 2.3 Can the app read the registry itself?

Yes, in principle. The data is on chain, and the key is public. The engine already downloads
compact blocks and trial-decrypts them. The resolver uses the same crate line as our engine
(`zcash_protocol` 0.11.0-pre.0, `zcash_primitives` 0.31.0-pre.1, `orchard` 0.16). Four limits:

1. **Standard decryption rejects Name Notes.** Standard ZIP 212 decryption derives `rcm` from
   `rseed` and compares `cmx`. A Name Note derives `rcm` from the tuple, so the check fails. ZNS
   patches `orchard` with its fork `zcashme/orchard` (tag `zns-orchard-v0.16.0-pre.1`) through
   `[patch.crates-io]` [R2]. Our engine pins upstream `orchard =0.16.0` with `unstable-frost`. The
   fork must not go into the signing engine. Two safer ways: a small decryption of our own (the
   AEAD only, no `cmx` check), or a check that needs no decryption. The default build of
   `zns-verify` recomputes `cmx` from the tuple with no `orchard` dependency [R3].
2. **Memos are not in compact blocks.** The app must fetch the full transaction of each Name
   Note. To fetch only the record of one name tells the light-wallet server which name the device
   looks up. To fetch all of them tells it nothing more than "this device reads the registry".
3. **The scan starts at the ceremony height.** A scan that starts later never fills the anchor
   pool and refuses every claim. A wallet born after the ceremony must download more blocks. Today
   that is a few thousand blocks, and the number grows.
4. **Nullifiers.** The app must follow the spends of registry notes. The registry viewing key
   holds `nk`, so the app can compute these nullifiers, as it does for its own notes.

### 2.4 What a resolver answer proves today

- The reference resolver checks the commitment and the spend of the predecessor note. It does not
  check the TEE attestation: its source has no attestation code [R2]. The whitepaper marks the
  attestation format as Open [W1, section 4]. So a binding today trusts the Mint operator and the
  claims about its TEE. The audit report is not out yet.
- A check of one record (fetch the `txid`, decrypt, recompute `cmx`, check the spent note) proves
  that the binding was valid once. It does not prove that it is still current. The whitepaper says
  that ZNS does not protect "against a Resolver presenting a client with stale chain state".
- The registry key is protocol identity. Both registries restarted near 15 October 2026. Pin the
  key for each network, and expect that it can change once more before launch.

### 2.5 Resolver options against PRIVACY.md

PRIVACY.md says that the group server cannot read recipients, and that the page connects only to
the group server and the light-wallet servers in `NETWORKS`. A name is a recipient.

| Option | Who learns the name that you pay | Work | Fit |
|---|---|---|---|
| A. Ask a remote resolver for each name (the SDK way) | ZcashMe: the name, your IP address and the time. With a Worker proxy, our Worker sees them in memory | Small | Poor. A new party learns recipients. The CSP gets a new host |
| B. Download the whole registry (`list_names` pages, then `events` deltas with no name filter) through a Worker route such as `/zns`, as `/lwd` works, and look names up on the device | Nobody. ZcashMe sees our Worker fetch the registry. Our Worker sees your IP address and the download, as for `/lwd` | Medium | Good. The CSP does not change. PRIVACY.md needs a new section |
| C. B with our own `zns-resolver` behind the Worker | Nobody | B, plus one service to run | Good. It removes the trust in the resolver of ZcashMe, not in the Mint. It is an infrastructure decision of the owner |
| D. The engine scans the registry from the ceremony height and verifies it | Only the light-wallet server, which sees that the device reads registry transactions | Large | Best trust: no resolver at all. The 1-of-n and Mint limits stay |

The registry is small today: 137 names. The testnet record of `craftsoldier` is 351 bytes of
JSON, so 10,000 names are about 3.5 MB. The waitlist had 10,802 names on 15 October 2026. Measure the size again after open
registration.

## 3. Registration and updates

### 3.1 Claim

A claim is one shielded payment to the Mint treasury. "There is no confirmation step: the payment
is the request" [D7].

| Part | Value |
|---|---|
| Recipient | Treasury, mainnet `u1f68wxdxsrswjl04kcc397a9ljedg88rl8dgazrk8l9v8jx6t3gqsktvqyvmc3ypgf4pum03q4ftvy5s0fe803nrxm8kw6dgzlvnv83nv`. Testnet: see [D8]. `status` returns it too |
| Memo | `ZNS:claim:<term>:<name>:<ua>`, or `ZNS:claim:<code>:<term>:<name>:<ua>` for a protected name. `<term>` is `forever` or `1y` to `99y`. The memo is ZIP 302 text, zero-padded to 512 bytes |
| Amount | The price at the daily rate of the Mint (zatoshis per USD), "in force when the Mint first sees the payment". USD per year by name length: 1 = 10,000; 2 = 2,500; 3 = 800; 4 = 400; 5 = 100; 6 or more = 20. `forever` costs 3 years [D13] |
| Fee | The normal fee. ZNS adds no fee to a claim |
| Transparent parts | None. The output must be an Ironwood output |
| Rules | "First sufficient payment wins." "Underpaid or malformed requests are not refunded." The Mint does not check the address in the memo: anyone can claim a name for any address |

**Fit with a Zigs payment.** A Zigs payment has 1 to 20 recipients, each with an optional memo of
at most 512 bytes. It has no transparent part and uses the ZIP 317 fee. Every approving device
checks each memo in the PCZT (PROTOCOL.md 7.1 and 7.2). The engine pays the Orchard receiver of a
unified address (`parse_recipient` in `wasm/src/chain.rs`). The Mint accepts a bound address only
when it has an Orchard receiver and no unknown receiver (`decode_controller_ua` in
`zns-mint/src/mint.rs` [R1]). A Zigs wallet address is a unified address with only an Orchard
receiver, so it qualifies. A Zigs mainnet address has 106 characters, so a claim memo has 126 to
188 bytes.

zcashnames.com builds the claim as a ZIP 321 link: `zcash:<treasury>?amount=<ZEC>&memo=<base64url>`
(`BuildZcashURI` in the SDK [R4]). The Send form of the web app accepts a pasted `zcash:` link and
reads it with the `zip321` crate (`wasm/src/request.rs`). So a group can most likely claim a name
today with no code change: a signer pastes the link, and t seats approve as for any payment. **Not
tested.** The approval screen shows the memo as raw text, with no explanation.

Group risks of a claim:

- Approvals can take up to a day (the payment expiry). The daily rate can change in that time, and
  a payment that is too small is lost. Pay a margin. The docs do not say whether the Mint returns
  an overpayment. Assume that it keeps it.
- Another claim for the same name can land first. The later payment is lost.
- The claim does not need the group at all. Any one signer can claim a name for the group address
  from a personal wallet. A group payment hides who paid and shows that the group agreed.

### 3.2 Update, renewal and release

An update (new address, more years, or `forever`) or a release has three memos [W1, section 5],
[D8]:

| Step | From, to | Memo | Payment |
|---|---|---|---|
| Request | Anyone, to the treasury | `ZNS:update:<term>:<name>:<new ua>` or `ZNS:release:<name>:<ua>` | 1 USD, rounded up to the next 100,000 zatoshis |
| Relay | Mint, to the Orchard receiver of the bound address | `ZNS:otp:<6 digits>:<name>:<verb>:<ua>` | Paid by the Mint |
| Respond | Anyone who knows the code, to the treasury | The Relay memo, unchanged | The price of added years or of `forever`; else nothing |

- The code is valid for 1,800 seconds of median time past (`D_OTP`) and allows 6 wrong tries
  (`MAX_ATTEMPTS`) [R1]. A Respond must land in a block within about 30 minutes.
- **Liveness.** Every name, also a `forever` name, needs one accepted update in each 365.25 days of
  chain time (`LIVENESS_INTERVAL = 31_557_600`). Else the Mint releases it, and anyone can claim it.
  The Mint removed its automatic liveness reminders on 24 September 2026 (`mint.changelog.md`
  [R1]).
- An update does not check the new address. A wrong address becomes the new binding.

### 3.3 Main finding: control of a name is 1-of-n

The Mint accepts a Respond when the memo, the paid amount and the current Name Note match a pending
code. It does not know, and does not check, who sent it. A shielded note shows no sender. The
whitepaper says that ZNS "does not require or verify spending authority over that receiver" [W1,
section 7]. In the code, `answer()` in `src/mint/treasury/otp.rs` compares the name, the action, the
address, the current `rcm` and the code. The echo path in `src/main.rs` adds only the price check
[R1].

So the controller of a name is whoever can read memos at the bound address. For a Zigs group, these
people can each point the name at their own address, alone:

- every signer, because every signer holds the viewing key (PRIVACY.md, "Signers and invite links");
- every holder of the invite link, because the sealed wallet document holds the viewing key
  (PROTOCOL.md 5);
- a signer that "Change signers" removed, while the name still points at the old wallet address;
- the Mint, because it makes the code.

The steps take one person and about 1 USD: send the Request from any wallet, read the Relay in the
group wallet, and send the Respond from any wallet. After that, every payer who resolves the name
pays that person. The t-of-n rule of the wallet does not protect the name. Zigs cannot change this.
It can show the change to every seat when it happens.

**What would fix it.** ZNS would need an authorization that proves spend authority, not only
viewing access. A FROST group can make a RedPallas signature under its spend key t-of-n, as for a
payment. To tie that key to the address without showing the viewing key needs a zero-knowledge
proof, as ZIP 304 does for Sapling. The whitepaper names "a future off-chain zero-knowledge name
circuit" for the Mint trust, not for this. The roadmap of the project lists "Users choose how to
authorize changes (one-time passcodes, keypairs)" for Alpha v2 [D3]. The whitepaper and the Mint
have only the code. This is a question for ZcashMe, through a ZNSIP.

### 3.4 Updates from a group, in practice

- The Relay is a note with a memo to the group address. A signer sees it only with memo reading on.
  Memo reading is off by default. When it is on, the light-wallet server learns which transactions
  the device fetches (PRIVACY.md, "Light-wallet server").
- A Respond as a group payment needs t seats online at the same time. In less than 30 minutes, they
  must approve, sign, prove in the browser and get one block. A normal group payment takes hours.
- The engine refuses a payment of zero (`wasm/src/chain.rs`). A Respond for `update:none` must
  carry a small amount, which the Mint keeps.
- A yearly liveness update needs this flow too. So a group that keeps a name must repeat it each
  year, or let one signer do it alone.

## 4. Privacy for a group wallet

Today, PRIVACY.md and README.md promise this for a group wallet: chain observers see a normal
shielded transaction, and no signers, amounts or addresses. The app shows the wallet address only
after the seat checked it, and gives it to others in payment requests. A name changes these points:

| Point | Without a name | With a name |
|---|---|---|
| Link between name and address | None | Public and permanent. A release keeps the released address in the history [D6] |
| Address to name | Not possible | `reverse_lookup` gives the names of an address. A payment request that shows the address also shows the name |
| Change signers | The move to the new wallet is hidden on chain | An update to the new address publishes the link from the old address to the new one |
| Mainnet cap | At 0.5 ZEC the app hides the address and warns | The name still gives the address to every payer. The cap no longer hides it |
| Inbound spam | Only people who got the address can send notes and memos | Anyone can. Each memo that a signer reads is one more transaction fetch |
| Amounts, balance, senders, signers, threshold | Hidden | Still hidden. Payments to the address stay shielded |
| The claim payment | n/a | It goes to the treasury, whose viewing key is not published. The Mint sees the memo and the time. Chain observers see a normal transaction |
| Group server | Sees no address | No change if the app keeps the name as a sealed field |

Two points from the ZNS docs apply [D6]:

- "The biggest disclosure is usually the name you choose, not the address underneath it."
- "Use a dedicated unified address for your name." A group wallet uses only address index 0 today
  (`address_of` in `wasm/src/lib.rs`). A second diversified address for the name keeps the name
  apart from the address in requests. It needs the address check, the screens and a check that the
  sync finds notes at that address. It does not hide the update link of "Change signers".

For the payer, the privacy depends on the resolver option (section 2.5). With option A, ZcashMe
learns each name that a Zigs user pays.

## 5. Design and size

### 5.1 Pay to a name (web app, option B)

1. **Input.** In a recipient field, an address stays an address, as today. Other text is trimmed
   and lowercased, and one `.zcash` or `.zec` is removed. A result that matches `^[a-z0-9]{1,63}$`
   is a name.
2. **Registry copy.** The page downloads the registry of the wallet's network through a Worker
   route (`/zns`, with the same password gate and a per-IP limit as `/lwd`). The route lets only
   `status`, `list_names` and `events` through. The page checks that `status` shows the pinned
   registry key. It updates the copy with `events` since the last height, with no name filter. It
   keeps the copy sealed in IndexedDB, as the sync state.
3. **Show.** The form shows the name, the full address, the expiry, the last change (action,
   height and date) and the source: "ZNS registry (zcashnames.com), not checked on chain". It
   warns when the last change is recent, and when the name lapses before the payment expires.
4. **Propose.** The PCZT pays the address, as today. The payee gets an optional `name` in the
   signed `payees` field, as memos did (PROTOCOL.md 7.1). To check: older web apps and the iPhone
   and Mac apps must accept a payee with an unknown `name` key. If one of them refuses it, a web
   proposal with a name stops that approver.
5. **Approve.** Each approving device looks the name up in its own copy. If it gets another
   address, it refuses to approve and says why. The PCZT check does not change.
6. **Errors.** "Name not found" for no record. A clear retry message when the registry cannot be
   reached. No fallback to a query for one name.

Tests: the name parser (63 and 64 bytes, suffixes, upper case, text that is also an address), the
copy and its deltas (`since_height` is strict), the key pin, the approver refusal, the Worker route
allow list, and one live testnet run (pay `craftsoldier`, or a name of our own).

| Part | Days |
|---|---|
| Worker route `/zns`, allow list, limit, tests | 1 |
| Registry copy: download, pages, deltas, key pin, sealed cache, tests | 1 to 1.5 |
| Send form, approval screen, `name` in `payees` (engine and page), approver check, tests. Add 0.5 if older or native readers refuse an unknown payee key | 1.5 to 2.5 |
| PRIVACY.md, README.md, live testnet run | 0.5 to 1 |
| **Web app total** | **4 to 6** |
| iPhone and Mac apps (Swift screens; the engine part is shared) | 3 to 4 more |
| Option C instead of B: deploy and run `zns-resolver` next to the testnet node | 1 to 2 more, plus upkeep |
| Option D: own Name Note decryption, `zns-verify` kernel, scan from the ceremony height, anchors and nullifiers, reorganisations, tests | 7 to 10 more |

### 5.2 Register a name for a group

Minimal design, recommended now:

1. **Guided claim.** A screen explains the public link, the 1-of-n control, the yearly update and
   the cost. The signer gets the ZIP 321 link from zcashnames.com, which has the daily rate, and
   pastes it. The approval screen shows the memo as "ZNS claim: name, term, address". It refuses a
   claim whose recipient is not the treasury address that `status` returns for the pinned
   registry key. It also refuses a claim whose memo address is not this wallet's checked address.
   It warns that the rate can change before the Mint sees the payment.
2. **Last check.** Before the device that sends the transaction broadcasts it, it checks in its
   registry copy that the name is still free. If not, it stops: the payment would be lost.
3. **Name status.** The wallet shows its name, the expiry and the liveness deadline (last claim or
   update plus 365.25 days). Every seat gets an alert when the name stops pointing at the wallet
   address, and when a Relay memo (`ZNS:otp:...`) arrives, because someone started a change.

| Part | Days |
|---|---|
| Claim screen, memo display and address check, last check | 1.5 to 2 |
| Name status and alerts (needs the registry copy of 5.1) | 1 to 1.5 |
| Live testnet claim | 0.5 |
| **Web app total** | **3 to 4** |

Full design, not recommended until ZNS changes: update, renewal and release from the app. The
Request is a group payment. The Respond is a group payment in a "fast session" that must finish in
30 minutes, or a payment from one signer's personal account. Both keep the 1-of-n control. Size: 3
to 5 more days.

### 5.3 Risks

1. **1-of-n control** (section 3.3). One signer, an invite link holder or a removed signer can take
   the name. Payers then pay that person. The app can detect this, not prevent it.
2. **Lapse.** A name with no accepted update for one year goes back to the open pool, and anyone
   can claim it. The Mint sends no reminder.
3. **30-minute window** against group approvals that take hours (section 3.4).
4. **Lost payments.** A claim can be too small after a rate change, or come after another claim.
   ZNS keeps such payments.
5. **Trust in the Mint.** One registrar. The attestation check is Open in the whitepaper and absent
   from the reference resolver. The audit report is expected on 21 October 2026. A wrong Mint can
   write false bindings. It cannot remove confirmed ones.
6. **Resolver trust.** A resolver can serve stale or false records. Option B trusts the resolver of
   ZcashMe. Options C and D remove that trust.
7. **Protocol changes.** The whitepaper is "a work in progress". The SDK is a release candidate.
   The registries restarted near 15 October 2026. Earlier wallet integrations follow an older
   design (section 1.2).
8. **Privacy** (section 4): a permanent public link, reverse lookup, the link of "Change signers",
   the mainnet cap, inbound spam.
9. **Confusion with zcashnames.co.** The same name can point elsewhere in that registry. Name the
   registry in every screen. A claim link from a false site can carry a correct memo and another
   recipient, so the app checks the recipient against the treasury address (5.2).
10. **Look-alike names.** Names are ASCII only, but `l` and `1`, or `o` and `0`, look alike. Always
    show the address next to the name.

### 5.4 Answer and order

How far is Zigs from ZNS: nothing exists yet. Pay to a name is 4 to 6 days of web work. A group can
probably claim a name today by pasting a link, with the 1-of-n control as the main limit.

Order of work:

1. Wait for the audit report (expected 21 October 2026) and open registration (30 October 2026).
2. Build pay to a name on testnet with option B. Measure the registry size.
3. Turn it on for mainnet after the audit, and after the owner accepts the trust in the Mint.
4. Build the guided claim and the name status.
5. Ask ZcashMe for an authorization by spend authority that a FROST group can make t-of-n. Build
   updates only after that.

Owner decisions:

- Resolver option: B, C or D.
- Mainnet: whether to wait for the audit report, and whether to accept the trust in the Mint.
- Groups: whether to offer group names while control is 1-of-n.

### 5.5 Changes to other documents when code lands

Not done in this spike:

- PRIVACY.md: a "Names (ZNS)" section. It says who learns a looked-up name, what the registry
  makes public, the 1-of-n control and the risk of a lapse. Also add a line to "Not protected".
- README.md: the privacy table gets a row for the resolver. "Known limits" gets the name limits.
- PROTOCOL.md 7.1: the optional `name` of a payee.

## Sources

Project documents (zcashnames.com, read on 18 October 2026, all "Last updated on October 15,
2026"):

- [D1] Docs home: https://www.zcashnames.com/docs
- [D2] Ecosystem and status: https://www.zcashnames.com/docs/ecosystem
- [D3] Roadmap: https://www.zcashnames.com/docs/roadmap
- [D4] Early Access: https://www.zcashnames.com/docs/blogs/users/early-access
- [D5] Resolution: https://www.zcashnames.com/docs/learn/resolution and
  https://www.zcashnames.com/docs/integrate/wallet-resolution
- [D6] Privacy: https://www.zcashnames.com/docs/learn/privacy
- [D7] Claiming and managing: https://www.zcashnames.com/docs/use/claiming and
  https://www.zcashnames.com/docs/use/managing
- [D8] OTP verification and treasury addresses: https://www.zcashnames.com/docs/use/otp-verification
- [D9] The Mint and trust model: https://www.zcashnames.com/docs/protocol/mint and
  https://www.zcashnames.com/docs/protocol/trust-model
- [D10] Endpoints: https://www.zcashnames.com/docs/integrate/testing
- [D11] JSON-RPC reference: https://www.zcashnames.com/docs/resolver/rpc-reference
- [D12] Running a resolver and verifying state: https://www.zcashnames.com/docs/resolver/running
  and https://www.zcashnames.com/docs/resolver/verifying-state
- [D13] Pricing: https://www.zcashnames.com/docs/protocol/pricing
- Also read: memo format, address types, name lifecycle, wallet compatibility
  (https://www.zcashnames.com/docs/protocol/memo-format, .../protocol/address-types,
  .../learn/name-lifecycle, .../use/wallets).

Specification and code (public repos of `zcashme`, shallow clones of 18 October 2026):

- [W1] Whitepaper, https://github.com/zcashme/zns-whitepaper at `5a6c4c6` (1 October 2026):
  `sections/02_requests.tex` to `07_trust_assumptions.tex`, `privacy_considerations.tex`.
- [R1] Mint, https://github.com/zcashme/zns-mint at `9fa071f` (15 October 2026):
  `src/main.rs` (echo path), `src/mint/treasury/otp.rs` (`D_OTP`, `MAX_ATTEMPTS`, `answer`),
  `src/mint.rs` (`LIVENESS_INTERVAL`, `decode_controller_ua`), `src/mint/registry/anchor_pool.rs`,
  `src/mint.changelog.md`.
- [R2] Resolver, https://github.com/zcashme/zns-resolver at `acf8f72` (15 October 2026):
  `Cargo.toml` (the `orchard` fork patch), `src/sync.rs`. A search of `src/` for "attest" finds
  nothing.
- [R3] Verification kernel, https://github.com/zcashme/zns-verify at `910ce07` (11 October 2026):
  `README.md`, `src/decrypt.rs`.
- [R4] SDKs, https://github.com/zcashme/ZNS at `40808b9` (30 July 2026): `sdk/go/zip321.go`.
  The TypeScript SDK is in `zns-resolver/sdk/typescript`.

Live calls (18 October 2026): `status` and `list_names` with `limit` 1 on the three public
endpoints of [D10].

Other sources:

- [P1] Press release of 15 October 2026 (GlobeNewswire, source "Zcash"):
  https://www.globenewswire.com/news-release/2026/10/15/3382072/0/en/zcash-names-make-private-payments-easier-to-send.html
- [F1] Grant thread, first post 19 May 2026, updates to 8 October 2026:
  https://forum.zcashcommunity.com/t/grant-proposal-zcash-name-service/55737
- [F2] Office hours announcement of 31 March 2026:
  https://forum.zcashcommunity.com/t/apr-7-1pm-utc-zcash-engineering-office-hours-7-zcashnames/55175
- [F3] The unrelated zcashnames.co, 10 August 2026:
  https://forum.zcashcommunity.com/t/zcashnames-human-readable-names-for-unified-addresses-live-on-mainnet-fair-launch-no-pre-registration/56958
- [U1] Unstoppable iOS, merged 28 September 2026:
  https://github.com/horizontalsystems/unstoppable-wallet-ios/pull/7253
- Secondary wiki (the claims of section 1.3): https://iq.wiki/wiki/zcash-names

Zigs files: PRIVACY.md, README.md, PROTOCOL.md (sections 5 and 7), `wasm/src/chain.rs`,
`wasm/src/lib.rs`, `wasm/src/request.rs`, `wasm/src/memo.rs`, `cf/src/index.js`.
