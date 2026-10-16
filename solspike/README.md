# solspike: checks of the Solana beta

This folder holds the checks that guard the Solana beta (ZOLANA.md). The name is from the spike
that made them. Run every command from the root of the repo with Node 24.

## What is here

| Path | Purpose |
|---|---|
| `baseline.sh`, `baseline.json`, `tools/baseline.mjs` | The Zcash baseline gate. It runs every `web/test/*.mjs` and `cf/test/limits.mjs`, hashes `wasm/`, `web/pkg/` and `web/signed.js`, and compares the page policy and the served headers with `baseline.json`. The Solana work must leave all of them equal |
| `serve.sh` | The local `wrangler dev` server on port 8795, started and stopped by PID. It reads `cf/.dev.vars` |
| `test/` | Tests of the Worker routes (`policy.test.mjs`), the Solana Worker (`worker*.test.mjs`, `prepare.test.mjs`, `transfer.test.mjs`, `client.test.mjs`), the gate (`gate.test.mjs`), the funding tool (`fund.test.mjs`), the chain reader (`verify-chain.test.mjs`), the SDK bundle build (`build.test.mjs`) and the harness (`harness.test.mjs`) |
| `mock/` | The mock run: the Solana Worker in headless Chrome against a replay of one real Devnet sync. No network and no key |
| `harness/` | Headless Chrome with in-memory browser contexts, and the live scenarios |
| `build.mjs`, `src/`, `stubs/` | Builds `web/sol/zolana.bundle.js` and copies the hasher wasm files. The build rewrites no SDK source: it has no plugin, only module aliases |
| `tools/` | The leak scan, the mutation check, the process counter and the Devnet tools (fund, read, verify) |
| `lint.sh` | oxlint (complexity 8, 100 lines per function, 5 parameters), the same limits for Python, and the 100 character line limit |

## Files outside the repo

A tool names each outside file by an environment variable and stops with the name if it is not set.
No tool writes a secret into the repo. Keep these files outside the repo.

| Variable | File | Used by |
|---|---|---|
| `ZOLANA_REPO` | A checkout of github.com/helius-labs/zolana at commit c232da1b (the full sha is `PIN` in `build.mjs`), with `npm ci` and `npm run build:ts` run in it | `build.mjs`, `build.test.mjs`, `mock/`, the SDK references of the harness |
| `HELIUS_URL_FILE` | The Helius Devnet URL, with its API key. Default: `~/.config/zigs/helius-app.url` | The live scenarios, `tools/rpc.mjs`, the leak scan |
| `SOLSPIKE_FUNDER` | The Devnet funder key (a JSON array of 64 bytes) | `tools/fund.mjs`, the leak scan |
| `SOLSPIKE_KEY_B` | A JSON file with the field `seedHex`: key B, a registered Devnet key | `mock/roles.mjs`, `tools/key-b.mjs` |
| `SOLSPIKE_INTERIM` | A file for the interim passphrases of `scenario-f.mjs`, mode 600 | `harness/scenario-f.mjs` |
| `OXLINT` | An oxlint binary | `lint.sh` |

`tools/node_modules` must link to `node_modules` of the Zolana checkout (it gives `@solana/kit` to
the Devnet tools). `solspike/node_modules` holds esbuild: run `npm ci` here. `cf/node_modules` holds
wrangler: run `npm ci` in `cf/`.

## The local server

`serve.sh` and the harness start `wrangler dev` with `cf/.dev.vars`. That file is not tracked.
Put `DEV_NO_AUTH=1` in it. A live scenario also needs `HELIUS_DEVNET_URL=<the Helius URL>`: the
page gets it from `/sol/config.json`. `harness/sol-route.mjs` and `harness/restore-neg.mjs` change
single lines of the file and put them back.

## Run the checks

Offline, with no key:

```bash
bash solspike/baseline.sh check                  # the Zcash baseline gate (about 2 minutes)
node solspike/test/policy.test.mjs               # the /sol routes and /sol/config.json
for t in client worker-schema worker prepare transfer fund verify-chain gate; do
  node solspike/test/$t.test.mjs
done
node --test-timeout=60000 solspike/test/harness.test.mjs
ZOLANA_REPO=... node solspike/test/build.test.mjs
ZOLANA_REPO=... SOLSPIKE_KEY_B=... node solspike/mock/run.mjs
OXLINT=... bash solspike/lint.sh
python3 -I solspike/tools/leak_scan.py           # counts secrets in the repo: needs the files above
ZOLANA_REPO=... node solspike/tools/mutate.mjs   # every mutant must be killed (long)
```

`baseline.sh record` writes `baseline.json` again. Record it only on a commit without Solana
changes to the Zcash files, and read the diff.

Headless Chrome, local server, no Helius key: `harness/live-check.mjs`, `harness/selftest.mjs`,
`harness/sol-route.mjs` (the Worker routes on the real dev server) and `harness/restore-neg.mjs`
(it needs the light-wallet servers). Run one heavy command at a time and
stop Chrome with its own `Browser.close`, as the harness does.

## Live scenarios (Devnet)

`harness/scenario-d.mjs` (ceremony and sync), `scenario-e.mjs` (four landed transactions),
`scenario-f.mjs` (payment, restore, second payment, seven landed transactions), `sol-live.mjs`
and `sol-cors.mjs` read or spend on Devnet. They ran at the spike. The spike had a
browser setting for the Helius URL, which the beta removed, so they have not run in this tree yet
(TICKETS.md, SOL-30). `scenario-e.mjs` and `scenario-f.mjs` also predate the fee keys: they fund
the group address and tap the Shield button. Fund the fee address of the proposing seat and use
Add SOL before they run again. The key of the app accepts only the origin `https://app.zigs.app`, so a run
from `http://localhost:8795` needs a key without Allowed Domains or a rewrite of the Origin header
(SOL-19).
