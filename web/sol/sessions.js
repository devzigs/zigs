// The Solana signing sessions (ZOLANA.md 5 and 7.2; PROTOCOL.md 7 and 15.5). A session is one
// document, `solsessions/<id>`, with several writers. Each part has its own writer and signature
// over only its own fields, as in web/signed.js, which stays as it is: its part table is Zcash
// specific. The commits and shares sit below the session (`solsessions/<id>/commits/<i>` and
// `shares/<i>`), each signed as a whole by its seat (docs.js). A part counts only when the part
// before it counts.
//
// A payment (the intent `approve`) is approved once: the group signs the digest of its proposal
// account, and any seat executes it later with a fresh proof. The other sessions are the move of
// the beta funds to the PDA (`createNonce` and `transfer`), which sign a v1 message with a nonce.
import { base58, readDocs } from "./docs.js";
import { decodeIntent } from "./intent.js";

export const SESSIONS = "solsessions";

/**
 * `needs` names the part that must count first. The status and the progress marks are not signed.
 * `plan`, `inputIds`, `salt` and `expiry` belong to the private spends: a part holds a field
 * only when the proposal has a value for it. `feeSig` is the signature of the payer (the fee key
 * of the proposing seat) on `message`: the first signature of the transaction. A payment has no
 * message: it holds the `transact` data of its first proof, its proposal `account` and `body`
 * (hex) and `createTx`, the transaction that created the account.
 */
export const PARTS = {
  proposal: {
    by: "by",
    sig: "sig",
    fields: [
      "intent",
      "plan",
      "inputIds",
      "salt",
      "expiry",
      "message",
      "feeSig",
      "transact",
      "account",
      "body",
      "createTx",
      "createdAt",
    ],
  },
  package: { by: "packageBy", sig: "packageSig", fields: ["package", "signers", "digest"] },
  signed: { by: "signedBy", sig: "signedSig", fields: ["signature"], needs: "package" },
  sent: {
    by: "sentBy",
    sig: "sentSig",
    fields: ["txId", "slot", "outcome"],
    needs: "signed",
  },
  failure: { by: "errorBy", sig: "errorSig", fields: ["error"] },
};

const ENDED = new Set(["sent", "failed"]);
const has = (d, ...keys) => keys.some((k) => d[k] !== undefined);
// A part is there when the document holds any of its fields, its writer or its signature.
const PRESENT = {
  proposal: () => true,
  package: (d) => has(d, "package", "signers", "digest", "packageBy", "packageSig"),
  signed: (d) => has(d, "signature", "signedBy", "signedSig"),
  sent: (d) => has(d, "txId", "slot", "outcome", "sentBy", "sentSig"),
  failure: (d) => has(d, "error", "errorBy", "errorSig"),
};

/** The fields that part `name` signs, as the document `d` holds them now. */
export function partFields(name, d) {
  const out = {};
  for (const k of PARTS[name].fields) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

/**
 * The writer and signature fields of part `name`. `sign(fields)` returns { by, sig } for the
 * signed fields. A field that the part does not list would stay unsigned, so it is an error.
 */
export async function signPart(name, fields, sign) {
  const part = PARTS[name],
    extra = Object.keys(fields).filter((k) => !part.fields.includes(k));
  if (extra.length) throw new Error("Unsigned field in the part " + name + ": " + extra.join(", "));
  const { by, sig } = await sign(partFields(name, fields));
  return { [part.by]: by, [part.sig]: sig };
}

function dropPart(ss, name) {
  const part = PARTS[name];
  for (const k of [...part.fields, part.by, part.sig]) delete ss[k];
}

// A transaction that landed stays landed, whatever failure text another seat wrote before.
function statusOf(ok) {
  if (ok.sent) return "sent";
  if (ok.failure) return "failed";
  if (ok.signed) return "signed";
  return ok.package ? "signing" : "collecting";
}

/** A payment of the program design: approved once, executed with a fresh proof. */
export const isPayment = (ss) => decodeIntent(ss?.intent)?.kind === "approve";

/** A proposal from before the fee keys has no `feeSig`: the group key paid and signed alone. */
export const beforeFee = (ss) => !isPayment(ss) && ss.feeSig === undefined;
export const BEFORE_FEE = "This proposal is from before the fee keys. Propose it again.";

// The sent mark must name the transaction that its signatures give: the first signature is its id.
// The payer signs first. A proposal from before the fee keys has the group signature only. The id
// of an execute is the signature of its executor, which no part holds: the mark names it, and the
// approval signature must be there.
const SIGNATURE = /^[0-9a-f]{128}$/;
const TX_ID = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
// A payment counts as sent only when its execute landed: a failed execute leaves the approval
// valid, so the session stays signed and a seat tries again.
const LANDED = new Set(["confirmed", "finalized"]);
const sentMatches = (d) => {
  if (isPayment(d)) {
    return SIGNATURE.test(d.signature) && TX_ID.test(String(d.txId)) && LANDED.has(d.outcome);
  }
  const first = beforeFee(d) ? d.signature : d.feeSig;
  return SIGNATURE.test(d.signature) && SIGNATURE.test(first) && d.txId === base58(first);
};

function askPart(name, d, check, verdict) {
  const need = PARTS[name].needs;
  if (need && verdict[need] !== "yes") return verdict[need] === "wait" ? "wait" : "no";
  if (name === "sent" && !sentMatches(d)) return "no";
  const part = PARTS[name];
  return check(name, d[part.by], d[part.sig], partFields(name, d));
}

// Asks every part that the document holds. Stops at a proposal that does not count.
function askAll(d, check) {
  const out = { ok: {}, bad: [], wait: 0 },
    verdict = {};
  for (const name of Object.keys(PARTS)) {
    if (!PRESENT[name](d)) continue;
    const v = (verdict[name] = askPart(name, d, check, verdict));
    out.ok[name] = v === "yes";
    if (v === "no") out.bad.push(name);
    if (v === "wait") out.wait++;
    if (name === "proposal" && v !== "yes") break;
  }
  return out;
}

function buildSession(id, d, ok) {
  const ss = { ...d, id };
  for (const name of Object.keys(PARTS)) if (name !== "proposal" && !ok[name]) dropPart(ss, name);
  if (ok.failure) ss.error = d.error;
  ss.status = statusOf(ok);
  return ss;
}

/**
 * Reads one session document. `check(name, by, sig, fields)` answers "yes", "no" or "wait" for a
 * part. A session with no valid proposal is dropped (`ss` null). Another part that is not valid is
 * taken out of it. `bad` names the parts that failed, and `wait` counts the unanswered ones.
 */
export function readSolSession(id, d, check) {
  const { ok, bad, wait } = askAll(d, check);
  return { ss: ok.proposal ? buildSession(id, d, ok) : null, bad, wait };
}

const num = (n) => (Number.isFinite(n) ? n : 0);

// The lifetime of a v1 message sits at bytes 8 to 40. For the intents with a nonce (01 to 05 but
// Add SOL, 02; the beta wrote 01, 04 and 05 too) it is the value of the nonce account. The nonce
// account (00) has a recent blockhash, and a payment (08) has no message.
const lifetimeOf = (ss) =>
  /^[0-9a-f]{80,}$/.test(String(ss.message)) ? ss.message.slice(16, 80) : "";
const usesNonce = (ss) => typeof ss.intent === "string" && /^0[1345]/.test(ss.intent);
const SUPERSEDED =
  "Another proposal on the same nonce landed first, so this one can never be sent. " +
  "Propose it again.";

/**
 * A transaction that landed (or failed on chain) used its nonce: it cannot be used again. Every
 * session that waits on that nonce ends, collecting or signed. This reads the signed documents
 * only, so it needs no RPC and a node that lags cannot end a live session.
 */
function endSuperseded(sessions) {
  const used = new Set(sessions.filter((ss) => ss.status === "sent").map(lifetimeOf));
  for (const ss of sessions) {
    if (ENDED.has(ss.status) || !usesNonce(ss) || !used.has(lifetimeOf(ss))) continue;
    Object.assign(ss, { status: "failed", error: SUPERSEDED });
  }
}

const SPENT =
  "Another payment spent the inputs of this one, so it can never execute. Propose it again.";

/** The input ids of the payments that are still open: a new payment must not take them. */
export function openInputs(sessions) {
  const open = sessions.filter((ss) => isPayment(ss) && !ENDED.has(ss.status));
  return [...new Set(open.flatMap((ss) => ss.inputIds ?? []))];
}

/** A payment that executed spent its inputs: every open payment over one of them ends. */
function endSpent(sessions) {
  const sent = sessions.filter((ss) => ss.status === "sent" && isPayment(ss));
  const spent = new Set(sent.flatMap((ss) => ss.inputIds ?? []));
  for (const ss of sessions) {
    const over = isPayment(ss) && (ss.inputIds ?? []).some((id) => spent.has(id));
    if (!ENDED.has(ss.status) && over) Object.assign(ss, { status: "failed", error: SPENT });
  }
}

/**
 * The sessions of `raw` and, for each valid one, its commits and shares. `raw` has `solsessions`
 * ({ id: document }), `solcommits` and `solshares` ({ id: { seat: document } }). `check(rel, by,
 * sig, fields, need)` is checkIn of app-filter.js. A session or document that is not valid is left
 * out, and `onBad(what)` hears it. Returns { sessions (newest first), commits, shares, bad, wait }.
 */
export function filterSessions(raw, check, onBad) {
  const out = { sessions: [], commits: {}, shares: {}, bad: 0, wait: 0 };
  for (const [id, d] of Object.entries(raw[SESSIONS] ?? {})) {
    const rel = SESSIONS + "/" + id;
    const res = readSolSession(id, d, (_name, by, sig, fields) =>
      check(rel, by, sig, fields, null),
    );
    out.wait += res.wait;
    for (const part of res.bad) {
      out.bad++;
      onBad(rel + " " + part);
    }
    if (!res.ss) continue;
    out.sessions.push(res.ss);
    for (const [kind, name] of [
      ["commits", "solcommits"],
      ["shares", "solshares"],
    ]) {
      const found = readDocs(rel + "/" + kind, raw[name]?.[id], check, onBad);
      out[kind][id] = found.docs;
      out.bad += found.bad;
      out.wait += found.wait;
    }
  }
  endSuperseded(out.sessions);
  endSpent(out.sessions);
  out.sessions.sort((a, b) => num(b.createdAt) - num(a.createdAt));
  return out;
}

/**
 * Signs the fields of part `name` as seat `seat` and writes them into the session `id`. The
 * proposal makes the document (`create`), every later part updates it.
 */
export async function writePart(c, id, name, fields, { seat, create = false }) {
  const rel = SESSIONS + "/" + id;
  const sig = await signPart(name, fields, async (signed) => {
    const doc = await c.host.signedDoc(c.gid, rel, seat, signed);
    return { by: doc.by, sig: doc.sig };
  });
  const ref = c.host.sdb.doc(c.base + "/" + rel);
  await (create ? ref.set({ ...fields, ...sig }) : ref.update({ ...fields, ...sig }));
}
