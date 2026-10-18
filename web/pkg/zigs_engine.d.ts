/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

export class ChainWallet {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Reads the memos of this wallet's notes from a full transaction (base64). `txid` is the
     * `txid` of `memoNeeds` for it. Returns `{"attached": <notes that left the pending state>}`.
     * A transaction with another id is an error.
     */
    attachTransaction(txid: string, raw: string): string;
    balance(): string;
    broadcast(tx_hex: string): Promise<string>;
    /**
     * A message on chain. `to` is a unified address with an Orchard receiver and `text` is the
     * message (`splitMessage` gives the rules). Each part is an output of zero value with its
     * memo, so the account pays the fee only. Returns `{"pczt", "pool", "fee", "parts",
     * "note_value", "change"}`. Sign it with `accountSign`, then `finalize`.
     */
    createMessage(to: string, text: string): Promise<string>;
    /**
     * `payees` is a JSON list: `[{"to": "<unified address>", "amount": <zat>, "memo": "<text>"},
     * …]`. The memo is optional: at most 512 UTF-8 bytes. `priority` pays 10 times the ZIP 317
     * fee. The payment expires one day after it is built (see `expiry`). `after` (optional) is
     * the PCZT of an expired payment that this one replaces: this one also spends every note of
     * it, and fails if one of them is spent now.
     */
    createSpend(payees: string, priority: boolean, after?: string | null): Promise<string>;
    /**
     * Transactions whose memos are not read yet: `[{"txid", "hash", "height"}, …]`. Pass `hash`
     * to `fetchTransaction`, then the result to `attachTransaction`.
     */
    memoNeeds(): string;
    constructor(ufvk: string, birthday: number, endpoint: string);
    received(): string;
    /**
     * A wallet that continues from `snapshot` (from `snapshot()`) instead of the birthday.
     */
    static restore(ufvk: string, birthday: number, endpoint: string, snapshot: string): ChainWallet;
    /**
     * Ids of mined transactions that spent this wallet's notes.
     */
    sent(): string;
    /**
     * Whether a payment is "done", "expired" or "unknown", from verified data only:
     * `{"state", "txid", "why"}`. `pczt` is the proposal, `signed` the combined signatures and
     * `approved` the sighash (hex) that this device approved; each may be empty. Only a device
     * that approved the payment can see "expired".
     */
    sessionState(pczt: string, signed: string, approved: string): string;
    /**
     * The sync state as JSON: notes, scan position and note commitment tree.
     */
    snapshot(): string;
    sync(on_progress: Function): Promise<string>;
}

declare class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}
export type { IntoUnderlyingByteSource };

declare class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}
export type { IntoUnderlyingSink };

declare class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}
export type { IntoUnderlyingSource };

export function accountKeys(seed: string, net: string): string;

export function accountNew(net: string): string;

export function accountSign(pczt: string, seed: string, net: string): string;

/**
 * `index` is a whole number from 0 to 4294967295. Anything else, also `undefined`, is an error.
 */
export function addressAt(ufvk: string, index: any): string;

export function backupOpen(passphrase: string, sealed: string): string;

export function backupSeal(passphrase: string, plaintext: string): string;

/**
 * The expected seconds from block `from` to block `to` on `network`, at the block time of each
 * block (75 seconds before NU7, 25 from it).
 */
export function blockSpanSeconds(network_name: string, from: number, to: number): number;

export function boxKeypair(): string;

export function boxOpen(sk: string, pk: string, ctx: string, ct: string): string;

export function boxSeal(sk: string, pk: string, ctx: string, pt: string): string;

export function dkgEcho(wallet_id: string, round1: string): string;

export function dkgPart1(id: number, n: number, t: number): string;

export function dkgPart2(secret: string, round1: string): string;

export function dkgPart3(secret2: string, round1: string, round2: string): string;

export function docPayload(wallet_id: string, path: string, seat: number, fields: string): string;

/**
 * For a payment that expires at block `expiry`, seen at chain height `tip`:
 * `{"expired", "blocks_left", "seconds_left"}`. An expired payment can no longer be sent.
 */
export function expiryState(network_name: string, expiry: number, tip: number): string;

/**
 * Downloads one full transaction from the light-wallet server. The server learns that this
 * device is interested in it. Needs no wallet, so no wallet is borrowed during the download.
 */
export function fetchTransaction(endpoint: string, hash: string): Promise<string>;

export function finalize(signed: string): string;

export function inspect(pczt: string, fvk: string): string;

/**
 * True when an error message says that a reorganisation was deeper than the wallet can undo.
 */
export function isDeepReorg(message: string): boolean;

/**
 * True when an error message says that the node answered and refused the transaction.
 */
export function isNodeRefusal(message: string): boolean;

export function joinMessage(memos: string): string;

export function latestHeight(endpoint: string): Promise<number>;

export function makeRequest(payees: string, net: string): string;

export function normalizeAddress(addr: string): string;

export function parseRequest(uri: string, net: string): string;

export function safetyNumber(wallet_id: string, t: number, n: number, network: string, seats: string): string;

export function secretOpen(secret: string, aad: string, ct: string): string;

export function secretSeal(secret: string, aad: string, pt: string): string;

export function signAggregate(pczt: string, pkp: string, _package: string, shares: string): string;

export function signCommit(pczt: string, fvk: string, kp: string, tip: number): string;

export function signPackage(pczt: string, fvk: string, commitments: string, min: number): string;

export function signShare(pczt: string, fvk: string, _package: string, approval: string, kp: string, id: number): string;

export function skCommit(wallet_id: string, seat: number, box_pk: string, r: string): string;

export function splitMessage(text: string): string;

export function start(): void;

export function vaultSk(wallet_id: string, echo: string, parts: string): string;

export function walletCreate(pkp: string, net: string): string;

export function walletCreateV2(pkp: string, net: string, sk: string): string;

export function walletVerify(wallet: string, pkp: string): string;

export function walletVerifyV2(wallet: string, pkp: string, sk: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_chainwallet_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly accountKeys: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly accountNew: (a: number, b: number) => [number, number, number, number];
    readonly accountSign: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly addressAt: (a: number, b: number, c: any) => [number, number, number, number];
    readonly backupOpen: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly backupSeal: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly blockSpanSeconds: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly boxKeypair: () => [number, number];
    readonly boxOpen: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly boxSeal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly chainwallet_attachTransaction: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly chainwallet_balance: (a: number) => [number, number];
    readonly chainwallet_broadcast: (a: number, b: number, c: number) => any;
    readonly chainwallet_createMessage: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly chainwallet_createSpend: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly chainwallet_memoNeeds: (a: number) => [number, number, number, number];
    readonly chainwallet_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly chainwallet_received: (a: number) => [number, number];
    readonly chainwallet_restore: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly chainwallet_sent: (a: number) => [number, number];
    readonly chainwallet_sessionState: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly chainwallet_snapshot: (a: number) => [number, number, number, number];
    readonly chainwallet_sync: (a: number, b: any) => any;
    readonly dkgEcho: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly dkgPart1: (a: number, b: number, c: number) => [number, number, number, number];
    readonly dkgPart2: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly dkgPart3: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly docPayload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly expiryState: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly fetchTransaction: (a: number, b: number, c: number, d: number) => any;
    readonly finalize: (a: number, b: number) => [number, number, number, number];
    readonly inspect: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly isDeepReorg: (a: number, b: number) => number;
    readonly isNodeRefusal: (a: number, b: number) => number;
    readonly joinMessage: (a: number, b: number) => [number, number, number, number];
    readonly latestHeight: (a: number, b: number) => any;
    readonly makeRequest: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly normalizeAddress: (a: number, b: number) => [number, number, number, number];
    readonly parseRequest: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly safetyNumber: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly secretOpen: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly secretSeal: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly signAggregate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly signCommit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly signPackage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly signShare: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number, number];
    readonly skCommit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly splitMessage: (a: number, b: number) => [number, number, number, number];
    readonly start: () => void;
    readonly vaultSk: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly walletCreate: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly walletCreateV2: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly walletVerify: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly walletVerifyV2: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly rustsecp256k1_v0_14_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_14_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_14_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_14_context_create: (a: number) => number;
    readonly wasm_bindgen_731503a097e03799___convert__closures_____invoke___js_sys_5d8c77ac1d4ec89f___Function_fn_wasm_bindgen_731503a097e03799___JsValue_____wasm_bindgen_731503a097e03799___sys__Undefined___js_sys_5d8c77ac1d4ec89f___Function_fn_wasm_bindgen_731503a097e03799___JsValue_____wasm_bindgen_731503a097e03799___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_731503a097e03799___convert__closures_____invoke___wasm_bindgen_731503a097e03799___JsValue__core_f0fd674eaa06beef___result__Result_____wasm_bindgen_731503a097e03799___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_731503a097e03799___convert__closures_____invoke___wasm_bindgen_731503a097e03799___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_731503a097e03799___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
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
