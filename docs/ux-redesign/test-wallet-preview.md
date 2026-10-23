# Local Test wallet preview

The local web preview offers **Test wallet**, a read-only **2-of-3** UI sample. Its sidebar
entry sits outside the real wallet entries. The empty welcome screen and the wallet lobby also
offer a direct entry. These links appear only on port `8792` at `localhost`, `127.0.0.1`, or
`[::1]`; they do not appear on production hosts or the isolated QA ports.

The link opens `http://localhost:8793/` in a separate tab with `rel="noopener"`. It neither
creates a real wallet nor changes the selected wallet, browser shares, or data in the original
tab. The sample is a separate loopback origin and serves presentation snapshots only.

## What the sample represents

The builder uses the existing web renderers and isolated synthetic browser stores to generate
Overview, Approvals, Activity, Address book, Swap, Chats, Security & Recovery, Settings, Send,
and Receive snapshots. The sample demonstrates the application layout with a synthetic
2-of-3 shared wallet. Values, addresses, device names, messages, and payment records are sample
content. They are not real balances, current network observations, or transactions to sign.

Navigation between snapshots is available. Wallet actions are inert: the preview cannot create
or join wallets, sign or broadcast payments, import recovery files, edit recipients, or send
messages. The server does not serve wallet JavaScript, WASM engines, worker code, or backend
service endpoints. Its content security policy disables scripts, workers, network connections,
frames, and form submission. Only allowlisted snapshot pages, styles, fonts, and artwork are
served. Unknown paths and write requests are rejected.

There is no seeded user wallet behind the sample. Recovery and passkey screens are explanatory
presentation; they contain no usable recovery material and do not request the user's passkey.
The isolated builder can use synthetic virtual WebAuthn credentials to exercise the existing
setup journey before exporting snapshots. Those credentials are not hardware-passkey evidence
and are not exposed as an account in the sample.

## Build and run

From the repository root, with **Node 24** and the existing local development/browser
dependencies available:

```sh
node solspike/tools/test_wallet_preview.mjs
```

This checks the source fingerprint, rebuilds missing or stale snapshots using the isolated
browser harness, and serves the sample at `http://localhost:8793/`. It does not reuse the user's
browser profile or stores at port `8792`. The build uses the isolated development port `8794`;
that port must be available before rebuilding.

To regenerate without starting the sample server:

```sh
node solspike/tools/test_wallet_preview.mjs --rebuild --build-only
```

The builder accepts the existing `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, and `WRANGLER_CLI`
environment overrides when their dependencies are not available at the configured defaults.
Generated HTML, sample styling, source fingerprint, build validation, and build logs live under
the ignored `solspike/.state/` directory. They are not production web assets or wallet backups.

The lower-level command below serves already generated snapshots with the current web styles:

```sh
node solspike/tools/test_wallet_server.mjs
```

## Keep snapshots current

Restart the preview helper after changing renderers, navigation, dialogs, or other UI structure.
Its fingerprint covers the web UI and browser harness sources and triggers regeneration when
they change. CSS is served from the current checkout, so serving old HTML alone after a
structural change can produce a misleading sample. Use `--rebuild` when changing supporting
inputs outside the fingerprint or when a snapshot appears stale.

The sample is for reviewing presentation. Use the existing synthetic browser journey and
regression tests to validate active controls, keyboard behavior, passkey protection, payment
gates, and backend interactions. A snapshot does not establish those outcomes.

## Validation

- Isolated sample generation: 32 journey checks passed, with no uncaught browser errors.
- Node 24 registered fast regression suite: 40 suites passed in 22 seconds.
- Five server/sanitizer tests passed, covering script and connection restrictions, explicit
  themes, rejected wallet endpoints and write methods, Host checks, and file/symlink escapes.
- Strict lint passed for 165 JavaScript files and two Python files.
- Sample browser QA passed 4,208 assertions across 120 screen/width/theme views and 23
  preference views, with no issues or page errors. All ten routes were checked at 320, 390,
  768 and 1440px in dark/light/system themes, with additional doubled text, forced colors,
  reduced motion/transparency, keyboard navigation and 48px target checks.
- Final rendered layouts and browser isolation checks are recorded in
  [the sample browser report](test-wallet-preview-validation.json), with synthetic captures in
  [the screenshot directory](visuals/test-wallet-preview).

Run the additional server tests with Node 24:

```sh
node --test solspike/test/test-wallet-preview.test.mjs
```

These checks use synthetic stores and emulation. The sample does not validate active payment
flows, passkey hardware, assistive technology, or physical-device behavior. This addition changes
no native application paths and performs no merge or deployment.
