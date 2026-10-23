// The read-only exporter permits only its fixed local artwork and inert controls.
import assert from "node:assert/strict";
import { assertInertSnapshot } from "../harness/test-wallet-snapshots.mjs";

for (const src of ["/logo.png", "/logo.png?v=sample", "/assets/zcash.svg",
  "/assets/solana.svg", "/assets/usdc.svg"]) {
  assert.doesNotThrow(() => assertInertSnapshot(`<img src="${src}" alt="Sample">`));
}
for (const src of ["https://external.invalid/logo.png", "/assets/other.svg",
  "/assets/../secret.svg", "data:image/svg+xml,sample", "blob:sample"]) {
  assert.throws(() => assertInertSnapshot(`<img src="${src}" alt="Sample">`));
}
assert.doesNotThrow(() => assertInertSnapshot('<button disabled>Preview</button>'));
assert.throws(() => assertInertSnapshot('<button>Live control</button>'));
assert.throws(() => assertInertSnapshot('<button disabled onclick="run()">Preview</button>'));
assert.throws(() => assertInertSnapshot('<script>run()</script>'));
console.log("test-wallet snapshot boundaries: ok");
