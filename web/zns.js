// Pay to a ZNS name on testnet (docs/zns-spike.md 5.1). The page downloads the whole registry
// from /zns (cf/src/index.js) and looks names up here, so no resolver learns which name a person
// pays. No DOM code. cf/src/index.js holds the same ZNS_KEY, and web/test/zns.mjs checks both.
export const ZNS_KEY = [
  "uviewtest1gkq78nsemsvs4qekadrv6qlqdmvcv2cct8k3c8cwycedpk90p8rtkx24qe8q73gg2ark8crqmmaavrer",
  "f7cxu0sp50an54crmeaalfxl72aetxnr89ksad4lvxzmnkyejhhwn65euzamt9wsukgfemeayhcesreasarmq600lf",
  "eju3qenh05e5e5cz6nhhsw3cfdcd3d08d0nxswxmkkxl2fq0hzv6t5dm3ftnz4y76236a49v3us4uq2tlsewf86tjt",
  "fwm6kue348me04rm7dw6uawv8myw7t5tyx2t453clhjz5f55lvh7hnvr8g8zt8lf4sy5rzq23ntp7g5ly6kyz2nkwf",
  "ek06llhjtuz2fft9rg6cuuwg4n7299vajnmq6swg3sf563r0jjzuwuvfpjhmfmydar9dcu3fkuawt6u8qu08vhg5mt",
  "hrcggrjuhht6f0perh0tqmdfrtgzvhjymay7h9ymvfxgd4r56uz6zrsf5gnvw5jy",
].join("");

// The same checks as the Worker. The address has at most 1,000 characters: "utest1" and 994 more.
const TEXT = {
  name: /^[a-z0-9]{1,63}$/, address: /^utest1[0-9a-z]{1,994}$/, txid: /^[0-9a-f]{64}$/,
  expires_at: /^(?:none|[0-9]+)$/,
};

// A transparent address as typed (t and 34 characters of base58), and the TEX forms (ZIP 320).
// Their letters could pass as a name, and a name could be squatted to catch a pasted address.
const T_ADDRESS = /^t[1-9A-HJ-NP-Za-km-z]{34}$/;
const TEX_ADDRESS = /^tex(?:test)?1/i;

// The name in what a person typed, or null: one .zcash or .zec removed, ASCII letters and digits
// only, in lower case. A unified address is too long to match, and transparent forms are refused.
export function nameOf(text) {
  if (typeof text !== "string") return null;
  const typed = text.trim().replace(/\.(?:zcash|zec)$/i, "");
  if (T_ADDRESS.test(typed) || TEX_ADDRESS.test(typed)) return null;
  return /^[A-Za-z0-9]{1,63}$/.test(typed) ? typed.toLowerCase() : null;
}

export const zecName = (name) => name + ".zec";
const isHeight = (n) => Number.isSafeInteger(n) && n >= 0;

function validRecord(r) {
  const text = ([field, re]) => typeof r[field] === "string" && re.test(r[field]);
  return r !== null && typeof r === "object" && Object.entries(TEXT).every(text)
    && isHeight(r.height) && ["claim", "update"].includes(r.last_action);
}

const headOk = (b) => !!b && b.network === "test" && b.key === ZNS_KEY && isHeight(b.height)
  && typeof b.synced === "boolean";

// The registry of an answer of /zns, or null when the answer is not sound.
function parse(body) {
  if (!headOk(body) || !Array.isArray(body.names) || !body.names.every(validRecord)) return null;
  const byName = new Map(body.names.map((r) => [r.name, r]));
  const { height, synced } = body;
  return byName.size === body.names.length ? { height, synced, byName } : null;
}

// A registry copy that is far below the synced tip of the wallet may be stuck or still scanning.
export const ZNS_MAX_LAG = 10;

// Why a copy cannot be used at the tip of the wallet (a block height), or null. A missing or
// invalid tip is a reason too: nothing then tells how old the copy is.
function lagNote(reg, tip) {
  if (!isHeight(tip)) return "This wallet has no synced chain height to compare with the registry";
  const lag = tip - reg.height;
  return lag > ZNS_MAX_LAG ? `The ZNS registry is ${lag} blocks behind the chain` : null;
}

// `get()` gives `{height, synced, byName}`: the last good answer for `ttlMs`, one shared request
// with a time limit, and a new request after a failure. The default fetch is looked up per call,
// because a browser refuses a fetch that is called as the method of another object.
export function createRegistry({
  fetch = (...a) => globalThis.fetch(...a), now = Date.now, ttlMs = 60_000, url = "/zns",
  timeoutMs = 15_000,
} = {}) {
  let last = null, loading = null;
  async function load() {
    const at = now();
    let reg = null, cause;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      reg = res.status === 200 ? parse(await res.json()) : null;
    } catch (e) { cause = e; }
    if (!reg) throw new Error("The ZNS registry cannot be read. Try again.", { cause });
    last = { at, reg };
    return reg;
  }
  return {
    get() {
      if (last && now() - last.at < ttlMs) return Promise.resolve(last.reg);
      loading ??= load().finally(() => { loading = null; });
      return loading;
    },
  };
}

export const registry = createRegistry();

// The address of a typed name: `{name, address, record}`, or null when `text` is no name. `tip`
// is the synced chain height of the wallet.
export function resolveRecipient(text, network, reg, tip) {
  const name = nameOf(text);
  if (name === null) return null;
  if (network !== "test") throw new Error("ZNS names work on testnet only.");
  const note = lagNote(reg, tip);
  if (note) throw new Error(note + ", so a ZNS name cannot be used now.");
  const record = reg.byName.get(name);
  if (!record) throw new Error(`${text.trim()} is not a unified address, and the testnet ZNS `
    + `registry has no name ${name}.`);
  return { name, address: record.address, record };
}

export const movedNote = (record) => record.last_action === "update"
  ? `This name moved to a new address at block ${record.height}.` : null;

// One day of blocks (25 s each). A name that got its address in this time may be a takeover.
export const ZNS_RECENT_BLOCKS = 3456;

// What the Send form says about a name at the tip of the wallet: a warning when the address is
// less than a day old (a claim after a release counts too), else the note of a moved name.
export const recentNote = (record, tip) => tip - record.height < ZNS_RECENT_BLOCKS
  ? `This name got this address at block ${record.height}, less than a day ago. `
    + "Check the address with the payee." : movedNote(record);

// The reason, without its ending, that a payee with a `name` key cannot be approved, or null.
function payeeNote(p, reg, tip) {
  const name = p.name, record = reg.byName.get(name);
  if (typeof name !== "string" || nameOf(name) !== name) {
    return "This payment names an invalid ZNS name";
  }
  const lag = lagNote(reg, tip);
  if (lag) return lag;
  if (!record) return `The ZNS name ${zecName(name)} has no address in the registry now`;
  return record.address === p.to ? null
    : `The ZNS name ${zecName(name)} now gives another address than this payment`;
}

// An approving device resolves each payee name on its own copy: the first reason to refuse, or
// null. A payee without a `name` key is a plain address. `tip` is the synced chain height.
export function nameRefusal(payees, reg, tip) {
  for (const p of payees) {
    const note = p && Object.hasOwn(p, "name") ? payeeNote(p, reg, tip) : null;
    if (note) return note + ", so this browser did not approve.";
  }
  return null;
}
