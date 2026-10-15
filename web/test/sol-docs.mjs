// The Solana documents (web/sol/docs.js): every path fits the group server, each document has one
// writer, and the reader ignores a document that a seat did not sign. Signatures are real
// (the Zcash engine builds the text, Web Crypto signs it), as in app.mjs.
// Run: node web/test/sol-docs.mjs   (Node 24)
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { newSignKey, signMsg, verifyMsg } from "../chat.js";
import { docFields, writerCheck, writerOf as zcashWriterOf } from "../signed.js";
import { COLLECTIONS, filterSol, writerOf } from "../sol/docs.js";

const web = new URL("../", import.meta.url);
Z.initSync({ module: fs.readFileSync(new URL("pkg/zigs_engine_bg.wasm", web)) });

const GID = "aaaaaaaaaaaaaaaaaaaa",
  SID = "ab12cd34ef56ab12cd34",
  N = 3;

// ── Paths: the group server takes a document only at an even number of segments ──
{
  const server = fs.readFileSync(new URL("../../cf/src/index.js", import.meta.url), "utf8");
  assert.ok(server.includes('path.split("/").length % 2 === 0'), "the rule is still this one");
  const base = "groups/" + GID + "/";
  const docs = [
    "solstart/1",
    "soldkg1/2",
    "soldkg2/2-3",
    "soldone/3",
    "solabort/2",
    "solsessions/" + SID,
    "solsessions/" + SID + "/commits/2",
    "solsessions/" + SID + "/shares/3",
  ];
  for (const rel of docs) {
    const path = base + rel;
    assert.equal(path.split("/").length % 2, 0, rel + " has an even number of segments");
    assert.ok(path.length <= 200, rel + " fits the path limit");
  }
  const collections = [
    ...COLLECTIONS,
    "solsessions",
    "solsessions/" + SID + "/commits",
    "solsessions/" + SID + "/shares",
  ];
  for (const rel of collections) {
    assert.equal((base + rel).split("/").length % 2, 1, rel + " is a collection of odd depth");
  }
  assert.deepEqual(COLLECTIONS, ["solstart", "soldkg1", "soldkg2", "soldone", "solabort"]);
}

// ── The writer of each document ──
{
  const want = {
    "solstart/1": 1,
    "soldkg1/2": 2,
    "soldkg2/2-3": 2,
    "soldkg2/3-1": 3,
    "soldone/3": 3,
    "solabort/1": 1,
    "solabort/3": 3,
    ["solsessions/" + SID + "/commits/2"]: 2,
    ["solsessions/" + SID + "/shares/1"]: 1,
  };
  for (const [rel, seat] of Object.entries(want)) assert.equal(writerOf(rel), seat, rel);
  const none = [
    "solstart/2",
    "solstart/01",
    "soldkg1/0",
    "soldkg1/100",
    "soldkg1/1/x",
    "soldone",
    "solabort",
    "solabort/0",
    "solabort/1-2",
    "soldkg2/1",
    "soldkg2/1-",
    "solsessions/" + SID,
    "solsessions/" + SID + "/commits",
    "solsessions/x y/commits/1",
    "soldkg1/1/../2",
    "seats/1",
    "dkg1/1",
    "meta/wallet",
  ];
  for (const rel of none) assert.equal(writerOf(rel), undefined, rel + " has no writer");
  // The Zcash reader knows no Solana name: an old app ignores these documents.
  for (const rel of Object.keys(want)) assert.equal(zcashWriterOf(rel), undefined, rel);
}

// ── The reader ──
const keys = { 1: await newSignKey(), 2: await newSignKey(), 3: await newSignKey() };
const attacker = await newSignKey();
const pins = { 1: keys[1].signPk, 2: keys[2].signPk, 3: keys[3].signPk };
const textOf = (rel, by, fields) => Z.docPayload(GID, rel, by, JSON.stringify(fields));
const signed = async (rel, seat, fields, key = keys[seat]) => ({
  ...fields,
  by: seat,
  sig: await signMsg(key.signSk, textOf(rel, seat, fields)),
});

// The verdicts need Web Crypto, which is async. This fills a table first, and `check` reads it,
// as partVerdict of app.js does with its memo.
async function checkerFor(raw, known = true) {
  const table = new Map();
  for (const [name, docs] of Object.entries(raw)) {
    for (const [id, d] of Object.entries(docs)) {
      const rel = name + "/" + id,
        pk = pins[d.by];
      const ok =
        pk && (await verifyMsg(pk, d.sig, textOf(rel, d.by, docFields(d))).catch(() => false));
      table.set(rel + "|" + d.by + "|" + d.sig, !!ok);
    }
  }
  return (rel, by, sig, fields, need) => {
    const gate = writerCheck(by, need, N, pins[by], known);
    if (gate !== "check") return gate;
    return table.get(rel + "|" + by + "|" + sig) ? "yes" : "no";
  };
}

const start = await signed("solstart/1", 1, { cluster: "devnet", at: 1 });
const r1 = (i) => signed("soldkg1/" + i, i, { package: { n: i }, commit: "c".repeat(64), at: 1 });
const honest = {
  solstart: { 1: start },
  soldkg1: { 1: await r1(1), 2: await r1(2), 3: await r1(3) },
  soldkg2: { "1-2": await signed("soldkg2/1-2", 1, { sealed: "s", echo: "e", at: 1 }) },
  soldone: { 1: await signed("soldone/1", 1, { groupKey: "k", at: 1 }) },
};

{
  const bad = [];
  const out = filterSol(honest, await checkerFor(honest), (rel) => bad.push(rel));
  assert.deepEqual([out.bad, out.wait, bad], [0, 0, []], "an honest wallet ignores nothing");
  assert.deepEqual(Object.keys(out.docs.soldkg1), ["1", "2", "3"]);
  assert.equal(out.docs.solstart[1].by, undefined, "the signature fields are not in the document");
  assert.deepEqual(out.docs.soldone[1], { groupKey: "k", at: 1 });
  assert.deepEqual(Object.keys(out.docs), COLLECTIONS);
}

// False documents are ignored, each for its own reason.
{
  const forged = structuredClone(honest);
  const one = honest.soldone[1];
  // A copied approval: seat 1's soldone, placed where seat 2 must write, and relabelled as seat 2.
  forged.soldone[2] = one;
  forged.soldone[3] = { ...one, by: 3 };
  // A wrong key: seat 2's name, the attacker's key.
  forged.soldkg1[2] = await signed(
    "soldkg1/2",
    2,
    { package: {}, commit: "d".repeat(64), at: 1 },
    attacker,
  );
  // A seat that is not the writer: the start document of seat 2.
  forged.solstart[1] = await signed("solstart/1", 2, { cluster: "devnet", at: 1 });
  // A made-up seat 4 in a wallet of 3, signed with the attacker key.
  forged.soldkg1[4] = await signed(
    "soldkg1/4",
    4,
    { package: {}, commit: "e".repeat(64) },
    attacker,
  );
  // A renamed seat: a signed document with a field changed after signing.
  forged.soldkg2["1-2"] = { ...honest.soldkg2["1-2"], sealed: "other" };
  // A document at a path that no seat may write.
  forged.soldkg2["1-"] = honest.soldkg2["1-2"];
  const bad = [];
  const out = filterSol(forged, await checkerFor(forged), (rel) => bad.push(rel));
  assert.deepEqual(
    bad.sort(),
    [
      "soldkg1/2",
      "soldkg1/4",
      "soldkg2/1-",
      "soldkg2/1-2",
      "soldone/2",
      "soldone/3",
      "solstart/1",
    ].sort(),
  );
  assert.equal(out.bad, 7);
  assert.deepEqual(Object.keys(out.docs.soldkg1).sort(), ["1", "3"]);
  assert.deepEqual([out.docs.solstart, out.docs.soldkg2], [{}, {}]);
  assert.deepEqual(Object.keys(out.docs.soldone), ["1"], "only the real soldone stays");
}

// A document whose seat key is not known yet waits. It is not used, and it is not "bad".
{
  const bad = [];
  const out = filterSol(honest, await checkerFor(honest, true), () => {});
  assert.equal(out.wait, 0);
  const pending = filterSol(
    { soldkg1: { 2: honest.soldkg1[2] } },
    (rel, by, sig, fields, need) => writerCheck(by, need, N, undefined, false),
    (r) => bad.push(r),
  );
  assert.deepEqual([pending.wait, pending.bad, bad, pending.docs.soldkg1], [1, 0, [], {}]);
  // A collection that the page has not loaded is empty, and another name is not read.
  const sparse = filterSol(
    { seats: { 1: honest.solstart[1] } },
    () => "yes",
    () => {},
  );
  assert.deepEqual(
    [sparse.bad, sparse.wait, Object.values(sparse.docs).flatMap(Object.keys)],
    [0, 0, []],
  );
}

console.log("sol-docs: ok");
