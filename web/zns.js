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

// The name in what a person typed, or null. A unified address is too long to match.
export function nameOf(text) {
  if (typeof text !== "string") return null;
  const name = text.trim().toLowerCase().replace(/\.(?:zcash|zec)$/, "");
  return TEXT.name.test(name) ? name : null;
}

export const zecName = (name) => name + ".zec";
const isHeight = (n) => Number.isSafeInteger(n) && n >= 0;

function validRecord(r) {
  const text = ([field, re]) => typeof r[field] === "string" && re.test(r[field]);
  return r !== null && typeof r === "object" && Object.entries(TEXT).every(text)
    && isHeight(r.height) && ["claim", "update"].includes(r.last_action);
}

// The registry of an answer of /zns, or null when the answer is not sound.
function parse(body) {
  const head = body && body.network === "test" && body.key === ZNS_KEY && isHeight(body.height);
  if (!head || !Array.isArray(body.names) || !body.names.every(validRecord)) return null;
  const byName = new Map(body.names.map((r) => [r.name, r]));
  return byName.size === body.names.length ? { height: body.height, byName } : null;
}

// `get()` gives `{height, byName}`: the last good answer for `ttlMs`, one shared request, and a
// new request after a failure. The default fetch is looked up per call, because a browser refuses
// a fetch that is called as the method of another object.
export function createRegistry(
  { fetch = (...a) => globalThis.fetch(...a), now = Date.now, ttlMs = 60_000, url = "/zns" } = {},
) {
  let last = null, loading = null;
  async function load() {
    const at = now();
    let reg = null, cause;
    try {
      const res = await fetch(url);
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

// The address of a typed name: `{name, address, record}`, or null when `text` is no name.
export function resolveRecipient(text, network, reg) {
  const name = nameOf(text);
  if (name === null) return null;
  if (network !== "test") throw new Error("ZNS names work on testnet only.");
  const record = reg.byName.get(name);
  if (!record) throw new Error(`${text.trim()} is not a unified address, and the testnet ZNS `
    + `registry has no name ${name}.`);
  return { name, address: record.address, record };
}

export const movedNote = (record) => record.last_action === "update"
  ? `This name moved to a new address at block ${record.height}.` : null;

// An approving device resolves each payee name on its own copy: the first reason to refuse, or
// null. A payee without a `name` key is a plain address.
export function nameRefusal(payees, reg) {
  const end = ", so this browser did not approve.";
  for (const p of payees) {
    if (!p || !Object.hasOwn(p, "name")) continue;
    const name = p.name, record = reg.byName.get(name);
    if (typeof name !== "string" || nameOf(name) !== name) {
      return "This payment names an invalid ZNS name" + end;
    }
    if (!record) return `The ZNS name ${zecName(name)} has no address in the registry now${end}`;
    if (record.address !== p.to) {
      return `The ZNS name ${zecName(name)} now gives another address than this payment${end}`;
    }
  }
  return null;
}
