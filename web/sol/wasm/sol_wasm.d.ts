/* tslint:disable */
/* eslint-disable */

/**
 * Checks a message with every rule of ZOLANA.md section 5 and the beta policy of a message that
 * a fee key signs (`beta.rs`). `sol_sign_share` adds the policy of the group key.
 *
 * - `intent`: the proposal, `Proposal::encode`: the intent and, for a spend, the approved
 *   plaintext outputs.
 * - `pins`: 161 bytes, the group key, `nullifier_pk` and `viewing_pk` of the `soldone` document,
 *   the payer of the proposal and the `nullifier_pk` of the PDA identity (`Pins::wire`). The
 *   page takes the payer from the `solfee` document of the proposing seat. The `owner_hash` is
 *   computed from the pins, and the snapshot secrets must derive exactly the pinned keys of the
 *   identity that the intent uses (the PDA for Shield and the program messages).
 * - `snapshot`: the device snapshot, `Snapshot::encode`.
 * - `now`: the Unix time of the device, in seconds.
 *
 * The answer starts with `accepted`, `refused` or `error`. `accepted` lists the payee (tag,
 * owner hash and viewing key, the fingerprint that the approvers confirm), the amounts, the
 * withdrawal recipient and the expiry of the approval screen, one per line. `refused` lists
 * every violated rule as `id<TAB>detail`, one per line. `error` gives the reason that the inputs
 * did not parse.
 */
export function check_message(message: Uint8Array, intent: Uint8Array, pins: Uint8Array, snapshot: Uint8Array, now: bigint): string;

/**
 * Checks a payment of the program design (ZOLANA.md 7.2), with the rules of section 5 on the
 * `transact` data of its first proof.
 *
 * - `proposal`: `Proposal::encode` of an `Approve` (or `Propose`) intent: the payment, the plan
 *   and the `transact` data.
 * - `pins`, `snapshot`, `now`: as `check_message` takes them.
 * - `seen`: `Seen::encode`, the proposal account that the device read and the bodies that its
 *   seats approved. Empty before the account exists: the chain rules do not run then.
 *
 * `accepted` gives the commitment, the proposal address, the digest that the group signs, the
 * body, then the lines of `check_message`. `refused` and `error` as there.
 */
export function check_payment(proposal: Uint8Array, pins: Uint8Array, snapshot: Uint8Array, seen: Uint8Array, now: bigint): string;

/**
 * The message bytes of a proposal. A message of another shape than the template is an error.
 */
export function compile_message(proposal: Uint8Array, pins: Uint8Array, transact: Uint8Array): Uint8Array;

/**
 * Every rule as `id<TAB>statement`, one per line.
 */
export function rule_list(): string;

/**
 * The signature (hex) of the shares, checked with `verify_strict`.
 */
export function sol_aggregate(message: Uint8Array, public_key_package: string, commitments: string, shares: string): string;

/**
 * The approval digest (hex) of a proposal account and its body (`program::approval_digest`).
 * It checks no rule: a seat runs `check_payment` before it signs this digest. The page counts
 * the commits and shares of a payment by it.
 */
export function sol_approval_digest(proposal: string, body: string): string;

/**
 * The share of a seat over the approval digest of a payment. It runs `check_payment` with the
 * proposal account first and throws the refusal. `round` is `{"now", "cluster", "keyPackage",
 * "nonces", "commitments"}`, as for `sol_sign_share`; the nonces are those of the digest.
 */
export function sol_approval_share(proposal: Uint8Array, pins: Uint8Array, snapshot: Uint8Array, seen: Uint8Array, round: string): string;

/**
 * The commitment of a seat to its secret part, as hex.
 */
export function sol_commit(wallet_id: string, seat: number, box_pk: string, cluster: string, r_sol: string): string;

/**
 * The digest of the exact message bytes, as hex. The page stores nonces under it.
 */
export function sol_digest(cluster: string, message: Uint8Array): string;

/**
 * Round 1 of the second DKG: `{"secret", "package"}`.
 */
export function sol_dkg1(id: number, n: number, t: number): string;

/**
 * Round 2: `{"secret", "outgoing": {"<seat>": package}}`.
 */
export function sol_dkg2(secret: string, round1: string): string;

/**
 * Round 3: `{"key_package", "public_key_package", "group_key", "sol_seed"}`. `round1` holds the
 * round-1 documents of every seat (the text that `sol_echo` takes). The wasm computes the echo
 * from them and refuses a seat whose saved echo, or whose peer's signed echo, differs. Then it
 * checks every commitment, and only then runs the frost round 3. `ctx` is `{"walletId",
 * "safety", "cluster", "seat", "echo", "peerEchoes", "parts": {"<seat>": {"r", "boxPk"}}}`.
 */
export function sol_dkg3(secret2: string, round1: string, round2: string, ctx: string): string;

/**
 * The echo of round 1, as hex.
 */
export function sol_echo(wallet_id: string, safety: string, cluster: string, round1: string): string;

/**
 * The fee key of the seat that holds `key_package`: `{"secret", "public"}` as hex. Every copy of
 * the key package gives the same key.
 */
export function sol_fee_key(key_package: string): string;

/**
 * The signature (hex) of the fee key of a proposal. It runs `approve` on the exact bytes first,
 * as `sol_sign_share` does, and throws the refusal. `round` is `{"now", "secret"}`.
 */
export function sol_fee_sign(message: Uint8Array, intent: Uint8Array, pins: Uint8Array, snapshot: Uint8Array, round: string): string;

/**
 * True when `signature` (hex) is the `verify_strict` signature of `message` under the fee key
 * `public` (hex). False for anything else, never an error.
 */
export function sol_fee_verify(_public: string, message: Uint8Array, signature: string): boolean;

/**
 * Fresh nonces and the commitment of a seat for a digest: `{"nonces", "commitments"}`.
 */
export function sol_nonces(key_package: string, digest: string): string;

/**
 * The PDA identity of `solSeed` under the group key, as JSON: `pda`, `nullifier_secret`,
 * `nullifier_pk`, `owner_hash` and `address`.
 */
export function sol_pda_roles(sol_seed: string, group_key: string): string;

/**
 * The version label of the program ids: what a `soldone` document must carry.
 */
export function sol_program_label(): string;

/**
 * The role keys of `solSeed` under the group key, as JSON.
 */
export function sol_roles(sol_seed: string, group_key: string): string;

/**
 * True when the signing share of a key package makes its verifying share (the share times the
 * base point), with a scalar below the group order. False for anything else, never an error.
 */
export function sol_share_fits(key_package: string): boolean;

/**
 * The share of a seat. It runs `check_message`'s `approve` on `message` first and throws the
 * refusal. `round` is `{"now", "cluster", "keyPackage", "nonces", "commitments"}`.
 */
export function sol_sign_share(message: Uint8Array, intent: Uint8Array, pins: Uint8Array, snapshot: Uint8Array, round: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly check_message: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint) => void;
    readonly check_payment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint) => void;
    readonly compile_message: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly rule_list: (a: number) => void;
    readonly sol_aggregate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly sol_approval_digest: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sol_approval_share: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly sol_commit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly sol_digest: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sol_dkg1: (a: number, b: number, c: number, d: number) => void;
    readonly sol_dkg2: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sol_dkg3: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly sol_echo: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly sol_fee_key: (a: number, b: number, c: number) => void;
    readonly sol_fee_sign: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly sol_fee_verify: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly sol_nonces: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sol_pda_roles: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sol_program_label: (a: number) => void;
    readonly sol_roles: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sol_share_fits: (a: number, b: number) => number;
    readonly sol_sign_share: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
