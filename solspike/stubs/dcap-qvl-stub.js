// Replaces @phala/dcap-qvl. The SDK imports only `verify` (src/client/prover/tee/dstack.ts).
// It throws on every call, so an enabled TEE policy can never accept an unchecked quote.
export function verify() {
  throw new Error("dcap-qvl stub: verify() is not available in the Zigs bundle");
}
