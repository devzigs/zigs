// The signed abort document of a seat (ZOLANA.md 5; PROTOCOL.md 15). A seat that stopped the
// Solana part of a wallet tells the others: it writes `solabort/<i>` with the reason, signed with
// its seat key. Every browser reads the verified documents (secrets.js `stopOf`), so a stop by one
// seat reaches every seat, and it survives a restore because the group server holds it. A
// document that is not signed by its seat is ignored by the reader.
import { solOf } from "./secrets.js";

const sent = (c, i) => typeof c.docs.solabort?.[i]?.reason === "string";

async function publishAbort(c, i, text) {
  const rel = "solabort/" + i;
  const doc = await c.host.signedDoc(c.gid, rel, i, { reason: text, at: Date.now() });
  await c.host.sdb.doc(c.base + "/" + rel).set(doc);
  c.host.log("device " + i + ": Solana stop published");
}

/** Publishes the abort document of each local seat that stopped, until the store holds it. */
export function reactAborts(c) {
  for (const i of c.host.localSeats()) {
    const text = solOf(c.host, c.gid, i).aborted;
    if (text && c.host.canWriteAs(i) && !sent(c, i)) {
      c.host.once("sol:abort:" + i, () => publishAbort(c, i, text));
    }
  }
}
