// Synthetic browser credentials and one shared Web Locks coordinator; no authenticator is used.
export function fakeLocks() {
  const turns = new Map(), requested = [];
  return { requested, request: (name, fn) => {
    requested.push(name);
    const next = (turns.get(name) || Promise.resolve()).then(fn);
    turns.set(name, next.catch(() => {}));
    return next;
  } };
}
export function fakePasskey(locks = fakeLocks(), bytes = new Uint8Array(32).fill(7)) {
  return { locks, credentials: {
    create: async () => ({ rawId: new Uint8Array(16).fill(1),
      getClientExtensionResults: () => ({ prf: { enabled: true } }) }),
    get: async () => ({ getClientExtensionResults: () =>
      ({ prf: { results: { first: bytes } } }) }),
  } };
}
