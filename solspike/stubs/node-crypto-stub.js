// Replaces the bare `import("crypto")` in @hpke/common (algorithm.js, utils/misc.js).
// That code runs only when globalThis.crypto is missing. Here it fails with a clear error instead.
export const webcrypto = undefined;
