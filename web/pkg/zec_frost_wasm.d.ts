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
    balance(): string;
    broadcast(tx_hex: string): Promise<string>;
    createSpend(recipient: string, amount: number): Promise<string>;
    constructor(ufvk: string, birthday: number, endpoint: string);
    received(): string;
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

export function boxKeypair(): string;

export function boxOpen(sk: string, pk: string, ctx: string, ct: string): string;

export function boxSeal(sk: string, pk: string, ctx: string, pt: string): string;

export function dkgPart1(id: number, n: number, t: number): string;

export function dkgPart2(secret: string, round1: string): string;

export function dkgPart3(secret2: string, round1: string, round2: string): string;

export function finalize(signed: string): string;

export function inspect(pczt: string, fvk: string): string;

export function latestHeight(endpoint: string): Promise<number>;

export function normalizeAddress(addr: string): string;

export function secretOpen(secret: string, aad: string, ct: string): string;

export function secretSeal(secret: string, aad: string, pt: string): string;

export function signAggregate(pczt: string, pkp: string, _package: string, shares: string): string;

export function signCommit(pczt: string, fvk: string, kp: string): string;

export function signPackage(pczt: string, fvk: string, commitments: string, min: number): string;

export function signShare(pczt: string, fvk: string, _package: string, nonces: string, mine: string, kp: string, id: number): string;

export function start(): void;

export function walletCreate(pkp: string, net: string): string;

export function walletVerify(wallet: string, pkp: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_chainwallet_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly boxKeypair: () => [number, number];
    readonly boxOpen: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly boxSeal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly chainwallet_balance: (a: number) => [number, number];
    readonly chainwallet_broadcast: (a: number, b: number, c: number) => any;
    readonly chainwallet_createSpend: (a: number, b: number, c: number, d: number) => any;
    readonly chainwallet_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly chainwallet_received: (a: number) => [number, number];
    readonly chainwallet_sync: (a: number, b: any) => any;
    readonly dkgPart1: (a: number, b: number, c: number) => [number, number, number, number];
    readonly dkgPart2: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly dkgPart3: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
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
    readonly latestHeight: (a: number, b: number) => any;
    readonly normalizeAddress: (a: number, b: number) => [number, number, number, number];
    readonly secretOpen: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly secretSeal: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly signAggregate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly signCommit: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly signPackage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly signShare: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number, number];
    readonly start: () => void;
    readonly walletCreate: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly walletVerify: (a: number, b: number, c: number, d: number) => [number, number, number, number];
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
