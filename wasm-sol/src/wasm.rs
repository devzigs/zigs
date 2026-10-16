//! The browser entry points. The checker (`check_message`, `rule_list`) and the template compiler
//! (`compile_message`) take plain bytes. The ceremony, the roles and the signing calls (`sol_*`)
//! take and return hex and JSON strings, as the Zcash engine does, and throw on an error. Each
//! `sol_*` function is a thin wrapper of a function in `frost`, `roles` or `sign`, which the
//! native tests call.

use wasm_bindgen::prelude::{wasm_bindgen, JsError};

use crate::approve::{Approved, Device};
use crate::beta::{approve_message, approve_payment, Signer};
use crate::bytes::hex;
use crate::check::Refusal;
use crate::codec::{unhex, unhex_array};
use crate::fee;
use crate::frost;
use crate::pay::{approve_pay, Payment, Seen};
use crate::pins::Pins;
use crate::plan::Proposal;
use crate::program::{approval_digest, Body};
use crate::roles;
use crate::rule::INFO;
use crate::sign::{self, ApprovalCheck, Check};
use crate::snapshot::Snapshot;
use crate::spend::{Amount, Summary};
use crate::template;
use crate::transact;
use crate::v1;

fn amounts(label: &str, list: &[Amount]) -> String {
    list.iter()
        .map(|a| format!("\n{label} {} {}", hex(&a.mint), a.amount))
        .collect()
}

fn payee_line(summary: &Summary) -> String {
    summary.payee.as_ref().map_or_else(String::new, |p| {
        format!(
            "\npayee {} {} {}",
            hex(&p.tag),
            hex(&p.owner_hash),
            hex(&p.viewing_pk)
        )
    })
}

/// The lines of the public values that the message commits to: the withdrawal recipient and the
/// expiry of a spend.
fn commitment_lines(summary: &Summary) -> String {
    let recipient = summary
        .recipient
        .map_or_else(String::new, |key| format!("\nrecipient {}", hex(&key)));
    let expiry = summary
        .expiry
        .map_or_else(String::new, |at| format!("\nexpiry {at}"));
    recipient + &expiry
}

fn accepted(approved: &Approved) -> String {
    summary_lines(&approved.summary)
}

fn summary_lines(summary: &Summary) -> String {
    format!(
        "accepted{}{}{}\nwithdrawn {}{}\ntree_fee {}",
        payee_line(summary),
        amounts("paid", &summary.paid),
        amounts("change", &summary.change),
        summary.withdrawn,
        commitment_lines(summary),
        summary.tree_fee
    )
}

pub(crate) fn refused(refusal: &Refusal) -> String {
    let lines: Vec<String> = refusal
        .violations
        .iter()
        .map(|v| format!("{}\t{}", v.rule.id(), v.detail))
        .collect();
    format!("refused\n{}", lines.join("\n"))
}

fn run(
    message: &[u8],
    intent: &[u8],
    pins: &[u8],
    snapshot: &[u8],
    now: u64,
) -> Result<String, String> {
    let proposal = Proposal::decode(intent)?;
    let snapshot = Snapshot::decode(snapshot)?;
    let pins = Pins::decode(pins)?;
    let device = Device {
        pins: &pins,
        snapshot: &snapshot,
        now,
    };
    Ok(
        match approve_message(message, &proposal, &device, Signer::Fee) {
            Ok(approved) => accepted(&approved),
            Err(refusal) => refused(&refusal),
        },
    )
}

/// The `accepted` lines of a payment: its commitment, proposal address, digest and body, then
/// the lines of the approval screen.
fn payment_lines(payment: &Payment) -> String {
    let head = format!(
        "\ncommitment {}\nproposal {}\ndigest {}\nbody {}",
        hex(&payment.commitment),
        hex(&payment.proposal),
        hex(&payment.digest),
        hex(&payment.body)
    );
    let screen = summary_lines(&payment.summary);
    let rest = screen.strip_prefix("accepted").unwrap_or(&screen);
    format!("accepted{head}{rest}")
}

fn run_payment(input: &ApprovalCheck, now: u64) -> Result<String, String> {
    let proposal = Proposal::decode(input.check.intent)?;
    let snapshot = Snapshot::decode(input.check.snapshot)?;
    let pins = Pins::decode(input.check.pins)?;
    let device = Device {
        pins: &pins,
        snapshot: &snapshot,
        now,
    };
    let verdict = if input.seen.is_empty() {
        let Some(pay) = proposal.intent.pay() else {
            return Err("the intent is not a payment".to_string());
        };
        let pda = pins.for_pda()?;
        let device = Device {
            pins: &pda,
            ..device
        };
        approve_pay((pay, &proposal.plan, &proposal.transact), &device, None)
    } else {
        approve_payment(&proposal, &device, &Seen::decode(input.seen)?)
    };
    Ok(match verdict {
        Ok(payment) => payment_lines(&payment),
        Err(refusal) => refused(&refusal),
    })
}

/// Checks a message with every rule of ZOLANA.md section 5 and the beta policy of a message that
/// a fee key signs (`beta.rs`). `sol_sign_share` adds the policy of the group key.
///
/// - `intent`: the proposal, `Proposal::encode`: the intent and, for a spend, the approved
///   plaintext outputs.
/// - `pins`: 161 bytes, the group key, `nullifier_pk` and `viewing_pk` of the `soldone` document,
///   the payer of the proposal and the `nullifier_pk` of the PDA identity (`Pins::wire`). The
///   page takes the payer from the `solfee` document of the proposing seat. The `owner_hash` is
///   computed from the pins, and the snapshot secrets must derive exactly the pinned keys of the
///   identity that the intent uses (the PDA for Shield and the program messages).
/// - `snapshot`: the device snapshot, `Snapshot::encode`.
/// - `now`: the Unix time of the device, in seconds.
///
/// The answer starts with `accepted`, `refused` or `error`. `accepted` lists the payee (tag,
/// owner hash and viewing key, the fingerprint that the approvers confirm), the amounts, the
/// withdrawal recipient and the expiry of the approval screen, one per line. `refused` lists
/// every violated rule as `id<TAB>detail`, one per line. `error` gives the reason that the inputs
/// did not parse.
#[wasm_bindgen]
pub fn check_message(
    message: &[u8],
    intent: &[u8],
    pins: &[u8],
    snapshot: &[u8],
    now: u64,
) -> String {
    run(message, intent, pins, snapshot, now).unwrap_or_else(|why| format!("error\t{why}"))
}

/// Checks a payment of the program design (ZOLANA.md 7.2), with the rules of section 5 on the
/// `transact` data of its first proof.
///
/// - `proposal`: `Proposal::encode` of an `Approve` (or `Propose`) intent: the payment, the plan
///   and the `transact` data.
/// - `pins`, `snapshot`, `now`: as `check_message` takes them.
/// - `seen`: `Seen::encode`, the proposal account that the device read and the bodies that its
///   seats approved. Empty before the account exists: the chain rules do not run then.
///
/// `accepted` gives the commitment, the proposal address, the digest that the group signs, the
/// body, then the lines of `check_message`. `refused` and `error` as there.
#[wasm_bindgen]
pub fn check_payment(
    proposal: &[u8],
    pins: &[u8],
    snapshot: &[u8],
    seen: &[u8],
    now: u64,
) -> String {
    let input = ApprovalCheck {
        check: Check {
            intent: proposal,
            pins,
            snapshot,
        },
        seen,
    };
    run_payment(&input, now).unwrap_or_else(|why| format!("error\t{why}"))
}

/// The share of a seat over the approval digest of a payment. It runs `check_payment` with the
/// proposal account first and throws the refusal. `round` is `{"now", "cluster", "keyPackage",
/// "nonces", "commitments"}`, as for `sol_sign_share`; the nonces are those of the digest.
#[wasm_bindgen]
pub fn sol_approval_share(
    proposal: &[u8],
    pins: &[u8],
    snapshot: &[u8],
    seen: &[u8],
    round: &str,
) -> Result<String, JsError> {
    let input = ApprovalCheck {
        check: Check {
            intent: proposal,
            pins,
            snapshot,
        },
        seen,
    };
    js(sign::approval_share(&input, round))
}

/// The approval digest (hex) of a proposal account and its body (`program::approval_digest`).
/// It checks no rule: a seat runs `check_payment` before it signs this digest. The page counts
/// the commits and shares of a payment by it.
#[wasm_bindgen]
pub fn sol_approval_digest(proposal: &str, body: &str) -> Result<String, JsError> {
    js(digest_of_proposal(proposal, body))
}

fn digest_of_proposal(proposal: &str, body: &str) -> Result<String, String> {
    let proposal: [u8; 32] = unhex_array(proposal, "proposal")?;
    let body = unhex(body, "body")?;
    Body::parse(&body)?;
    Ok(hex(&approval_digest(&proposal, &body)))
}

/// The PDA identity of `solSeed` under the group key, as JSON: `pda`, `nullifier_secret`,
/// `nullifier_pk`, `owner_hash` and `address`.
#[wasm_bindgen]
pub fn sol_pda_roles(sol_seed: &str, group_key: &str) -> Result<String, JsError> {
    js(roles::pda_roles(sol_seed, group_key))
}

/// Every rule as `id<TAB>statement`, one per line.
#[wasm_bindgen]
pub fn rule_list() -> String {
    INFO.iter()
        .map(|info| format!("{}\t{}", info.id, info.text))
        .collect::<Vec<_>>()
        .join("\n")
}

fn js<T>(result: Result<T, String>) -> Result<T, JsError> {
    result.map_err(|why| JsError::new(&why))
}

/// The v1 message of a proposal, compiled from the fixed template.
///
/// - `proposal`: the bytes that `check_message` takes as `intent` (the intent and, for a spend,
///   the plan). Only the intent is read here.
/// - `pins`: the 161 bytes of `check_message`.
/// - `transact`: the data of the `transact` instruction, tag byte included, as the Worker cuts it
///   out of the SDK message. Empty for every intent but a Transfer and a Withdrawal.
pub fn compile_proposal(proposal: &[u8], pins: &[u8], transact: &[u8]) -> Result<Vec<u8>, String> {
    let proposal = Proposal::decode(proposal)?;
    let pins = Pins::decode(pins)?;
    let tx = match transact {
        [] => None,
        data => Some(transact::parse(data).map_err(|why| format!("transact data: {why:?}"))?),
    };
    v1::write(&template::compile(&proposal.intent, &pins, tx.as_ref())?)
}

/// The message bytes of a proposal. A message of another shape than the template is an error.
#[wasm_bindgen]
pub fn compile_message(proposal: &[u8], pins: &[u8], transact: &[u8]) -> Result<Vec<u8>, JsError> {
    js(compile_proposal(proposal, pins, transact))
}

/// Round 1 of the second DKG: `{"secret", "package"}`.
#[wasm_bindgen]
pub fn sol_dkg1(id: u16, n: u16, t: u16) -> Result<String, JsError> {
    js(frost::dkg1(id, n, t))
}

/// Round 2: `{"secret", "outgoing": {"<seat>": package}}`.
#[wasm_bindgen]
pub fn sol_dkg2(secret: &str, round1: &str) -> Result<String, JsError> {
    js(frost::dkg2(secret, round1))
}

/// Round 3: `{"key_package", "public_key_package", "group_key", "sol_seed"}`. `round1` holds the
/// round-1 documents of every seat (the text that `sol_echo` takes). The wasm computes the echo
/// from them and refuses a seat whose saved echo, or whose peer's signed echo, differs. Then it
/// checks every commitment, and only then runs the frost round 3. `ctx` is `{"walletId",
/// "safety", "cluster", "seat", "echo", "peerEchoes", "parts": {"<seat>": {"r", "boxPk"}}}`.
#[wasm_bindgen]
pub fn sol_dkg3(secret2: &str, round1: &str, round2: &str, ctx: &str) -> Result<String, JsError> {
    js(frost::dkg3(secret2, round1, round2, ctx))
}

/// The commitment of a seat to its secret part, as hex.
#[wasm_bindgen]
pub fn sol_commit(
    wallet_id: &str,
    seat: u16,
    box_pk: &str,
    cluster: &str,
    r_sol: &str,
) -> Result<String, JsError> {
    js(frost::commit(wallet_id, seat, box_pk, cluster, r_sol))
}

/// The echo of round 1, as hex.
#[wasm_bindgen]
pub fn sol_echo(
    wallet_id: &str,
    safety: &str,
    cluster: &str,
    round1: &str,
) -> Result<String, JsError> {
    js(frost::echo(wallet_id, safety, cluster, round1))
}

/// True when the signing share of a key package makes its verifying share (the share times the
/// base point), with a scalar below the group order. False for anything else, never an error.
#[wasm_bindgen]
pub fn sol_share_fits(key_package: &str) -> bool {
    frost::share_fits(key_package)
}

/// The version label of the program ids: what a `soldone` document must carry.
#[wasm_bindgen]
pub fn sol_program_label() -> String {
    frost::PROGRAM_LABEL.to_string()
}

/// The fee key of the seat that holds `key_package`: `{"secret", "public"}` as hex. Every copy of
/// the key package gives the same key.
#[wasm_bindgen]
pub fn sol_fee_key(key_package: &str) -> Result<String, JsError> {
    js(fee::derive(key_package))
}

/// The signature (hex) of the fee key of a proposal. It runs `approve` on the exact bytes first,
/// as `sol_sign_share` does, and throws the refusal. `round` is `{"now", "secret"}`.
#[wasm_bindgen]
pub fn sol_fee_sign(
    message: &[u8],
    intent: &[u8],
    pins: &[u8],
    snapshot: &[u8],
    round: &str,
) -> Result<String, JsError> {
    let check = Check {
        intent,
        pins,
        snapshot,
    };
    js(fee::sign(message, &check, round))
}

/// True when `signature` (hex) is the `verify_strict` signature of `message` under the fee key
/// `public` (hex). False for anything else, never an error.
#[wasm_bindgen]
pub fn sol_fee_verify(public: &str, message: &[u8], signature: &str) -> bool {
    fee::verify(public, message, signature).is_ok()
}

/// The role keys of `solSeed` under the group key, as JSON.
#[wasm_bindgen]
pub fn sol_roles(sol_seed: &str, group_key: &str) -> Result<String, JsError> {
    js(roles::roles(sol_seed, group_key))
}

/// The digest of the exact message bytes, as hex. The page stores nonces under it.
#[wasm_bindgen]
pub fn sol_digest(cluster: &str, message: &[u8]) -> Result<String, JsError> {
    js(sign::digest(cluster, message))
}

/// Fresh nonces and the commitment of a seat for a digest: `{"nonces", "commitments"}`.
#[wasm_bindgen]
pub fn sol_nonces(key_package: &str, digest: &str) -> Result<String, JsError> {
    js(sign::nonces(key_package, digest))
}

/// The share of a seat. It runs `check_message`'s `approve` on `message` first and throws the
/// refusal. `round` is `{"now", "cluster", "keyPackage", "nonces", "commitments"}`.
#[wasm_bindgen]
pub fn sol_sign_share(
    message: &[u8],
    intent: &[u8],
    pins: &[u8],
    snapshot: &[u8],
    round: &str,
) -> Result<String, JsError> {
    let check = Check {
        intent,
        pins,
        snapshot,
    };
    js(sign::sign_share(message, &check, round))
}

/// The signature (hex) of the shares, checked with `verify_strict`.
#[wasm_bindgen]
pub fn sol_aggregate(
    message: &[u8],
    public_key_package: &str,
    commitments: &str,
    shares: &str,
) -> Result<String, JsError> {
    js(sign::aggregate(
        message,
        public_key_package,
        commitments,
        shares,
    ))
}
