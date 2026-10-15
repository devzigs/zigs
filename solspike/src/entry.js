// Bundle entry: the whole SDK root plus the few helpers that the Worker needs. The module paths
// come from aliases in build.mjs, so every name resolves to the one copy that the SDK itself uses.
import { proofConfig } from "zolana-transact";

export * from "zolana-sdk";
export { verify as dcapStubVerify } from "@phala/dcap-qvl";
export { decodeTreeFees } from "zolana-interface";
export {
  getAddressDecoder,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";

/** Sets the expiry that the next transfer proof binds. build.mjs patches the SDK to read it. */
export function setProofExpiry(expiryUnixTs) {
  proofConfig.expiryUnixTs = expiryUnixTs;
}
