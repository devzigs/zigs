// Sends Devnet SOL from the funder key to the group address: one ordinary System transfer, signed
// by the funder. The funder key is read from its file here, inside this module, and never leaves
// it (rpc.mjs keeps the Helius URL the same way, every error text is redacted, and the key forms
// are needles of the redactor and of the leak scan).
//   import { fund } from "./fund.mjs";   await fund({ to, shown, lamports });
// It refuses unless the address equals the one that the app shows (`shown`), the amount is a
// whole number of lamports up to MAX_LAMPORTS, the funder can pay it with a margin, and the
// address does not hold that much already (a rerun must not fund twice).
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { redact } from "../harness/redact.mjs";
import { funderFile } from "./paths.mjs";
import { balanceOf, readText, rpcCall, sleep } from "./rpc.mjs";

/** The most that one call sends: 0.05 SOL (the brief). The budget of the whole run is 0.1 SOL. */
export const MAX_LAMPORTS = 50_000_000n;
const MARGIN = 2_000_000n;
const SYSTEM = address("11111111111111111111111111111111");

function check({ to, shown, lamports }) {
  if (typeof to !== "string" || to !== shown) {
    throw new Error("fund: the address differs from the one that the app shows");
  }
  address(to); // throws on text that is not a 32 byte address
  if (typeof lamports !== "bigint" || lamports <= 0n || lamports > MAX_LAMPORTS) {
    throw new Error(`fund: the amount must be 1 to ${MAX_LAMPORTS} lamports`);
  }
}

/** The transfer instruction of the System program: tag 2, then the lamports. */
function transferIx(signer, to, lamports) {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, lamports, true);
  const accounts = [
    { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
    { address: address(to), role: AccountRole.WRITABLE },
  ];
  return { programAddress: SYSTEM, accounts, data };
}

async function confirmed(signature) {
  for (let i = 0; i < 60; i += 1) {
    const { value } = await rpcCall("getSignatureStatuses", [[signature]]);
    const seen = value[0];
    if (seen?.err)
      throw new Error(`fund: the transfer failed on chain: ${JSON.stringify(seen.err)}`);
    if (["confirmed", "finalized"].includes(seen?.confirmationStatus)) return;
    await sleep(1500);
  }
  throw new Error("fund: the transfer was not confirmed in 90 s");
}

async function signedTransfer(signer, { to, lamports }) {
  const { value } = await rpcCall("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const last = BigInt(value.lastValidBlockHeight);
  const latest = { blockhash: value.blockhash, lastValidBlockHeight: last };
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstruction(transferIx(signer, to, lamports), m),
    signTransactionMessageWithSigners,
  );
}

/**
 * Sends `lamports` (a bigint) to `to`. `shown` is the address text that the app shows: it must
 * equal `to`. Returns { signature, slot, fee, computeUnits, funder, before, after }.
 */
export async function fund(request) {
  try {
    check(request);
    const signer = await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readText(funderFile()))),
    );
    if (signer.address === request.to) throw new Error("fund: the funder cannot fund itself");
    const holds = await Promise.all([balanceOf(signer.address), balanceOf(request.to)]);
    const [funderHas, before] = holds;
    if (funderHas < request.lamports + MARGIN) throw new Error("fund: the funder holds too little");
    if (before >= request.lamports) throw new Error("fund: the address holds that much already");
    const signed = await signedTransfer(signer, request);
    const signature = getSignatureFromTransaction(signed);
    const options = { encoding: "base64", preflightCommitment: "confirmed" };
    await rpcCall("sendTransaction", [getBase64EncodedWireTransaction(signed), options]);
    await confirmed(signature);
    const seen = { commitment: "confirmed", maxSupportedTransactionVersion: 0 };
    const info = await rpcCall("getTransaction", [signature, seen]);
    return {
      signature,
      slot: info.slot,
      fee: info.meta.fee,
      computeUnits: info.meta.computeUnitsConsumed ?? null,
      funder: signer.address,
      before: String(before),
      after: String(await balanceOf(request.to)),
    };
  } catch (err) {
    throw new Error(redact(String(err?.message ?? err)));
  }
}
