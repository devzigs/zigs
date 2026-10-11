// Passkey lock for the secrets this browser keeps. A passkey cannot make a RedPallas signature,
// so it guards the key shares instead: the WebAuthn PRF extension gives a 32-byte secret on each
// Face ID or Touch ID check, and that secret is the AES-GCM key for the stored secrets.

const AAD = new TextEncoder().encode("zigs vault v1");
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")),
  (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Returns the AES-GCM key for 32 PRF output bytes. */
export function aesKey(prf) {
  return crypto.subtle.importKey("raw", prf, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts `data` (any JSON value) for the vault record `{cred, salt}`. */
export async function seal(key, rec, data) {
  const iv = random(12), plain = new TextEncoder().encode(JSON.stringify(data));
  const box = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plain);
  return { v: 1, cred: rec.cred, salt: rec.salt, iv: b64u(iv), box: b64u(box) };
}

/** Decrypts a sealed vault record. Throws if the key is wrong or the record was changed. */
export async function open(key, rec) {
  const alg = { name: "AES-GCM", iv: unb64u(rec.iv), additionalData: AAD };
  const plain = await crypto.subtle.decrypt(alg, key, unb64u(rec.box));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Reads a stored vault record, or null if the text is not one. */
export function parseVault(text) {
  try {
    const r = JSON.parse(text);
    const fields = r ? [r.cred, r.salt, r.iv, r.box] : [];
    const ok = r && r.v === 1 && fields.every((x) => typeof x === "string" && x);
    return ok ? r : null;
  } catch { return null; }
}

async function prfFrom(cred, salt) {
  const got = await navigator.credentials.get({ publicKey: {
    challenge: random(32), userVerification: "required", timeout: 120000,
    allowCredentials: [{ type: "public-key", id: unb64u(cred) }],
    extensions: { prf: { eval: { first: unb64u(salt) } } },
  } });
  const out = got && got.getClientExtensionResults().prf;
  if (!out || !out.results || !out.results.first) {
    throw new Error("This passkey cannot unlock Zigs. It does not support the PRF extension.");
  }
  return new Uint8Array(out.results.first);
}

/** Makes a passkey for this site and returns its vault record and AES key. */
export async function createPasskey() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error("This browser has no passkey support.");
  }
  const salt = random(32);
  const made = await navigator.credentials.create({ publicKey: {
    rp: { name: "Zigs" },
    user: { id: random(16), name: "Zigs signer", displayName: "Zigs signer" },
    challenge: random(32), timeout: 120000,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    extensions: { prf: { eval: { first: salt } } },
  } });
  const prf = made && made.getClientExtensionResults().prf;
  if (!prf || (!prf.enabled && !prf.results)) {
    throw new Error("This browser or passkey provider does not support the PRF extension. "
      + "Use a current Chrome, Edge or Safari, or a security key.");
  }
  const rec = { cred: b64u(made.rawId), salt: b64u(salt) };
  // The key comes from a sign-in, as at unlock, even when creation already gave a PRF output:
  // this proves the passkey gives the same key back before the plain copy is deleted.
  return { rec, key: await unlockKey(rec) };
}

/** Asks for the passkey of a stored vault record and returns its AES key. */
export async function unlockKey(rec) {
  return aesKey(await prfFrom(rec.cred, rec.salt));
}
