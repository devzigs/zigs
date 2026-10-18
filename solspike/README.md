# solspike: checks of the Solana beta

This folder holds the checks that guard the Solana beta (ZOLANA.md). The name is from the spike
that made them. Run every command from the root of the repo with Node 24.

## What is here

| Path | Purpose |
|---|---|
| `baseline.sh`, `baseline.json`, `tools/baseline.mjs` | The Zcash baseline gate. It runs every `web/test/*.mjs` and `cf/test/limits.mjs`, hashes `wasm/`, `web/pkg/` and `web/signed.js`, and compares the page policy and the served headers with `baseline.json`. The Solana work must leave all of them equal |
| `serve.sh` | The local `wrangler dev` server on port 8795, started and stopped by PID. It reads `cf/.dev.vars`. With an https `SOLSPIKE_ORIGIN` it serves https on 127.0.0.1 |
| `test/` | Tests of the Worker routes (`policy.test.mjs`), the Solana Worker (`worker*.test.mjs`, `prepare.test.mjs`, `transfer.test.mjs`, `client.test.mjs`), the gate (`gate.test.mjs`), the funding tool (`fund.test.mjs`), the chain reader (`verify-chain.test.mjs`), the SDK bundle build (`build.test.mjs`) and the harness (`harness.test.mjs`) |
| `mock/` | The mock run: the Solana Worker in headless Chrome against a replay of one real Devnet sync. No network and no key. It is the counterpart of `harness/sol-live.mjs` with no network |
| `harness/` | Headless Chrome with in-memory browser contexts, and the live scenarios |
| `build.mjs`, `src/`, `stubs/` | Builds `web/sol/zolana.bundle.js` and copies the hasher wasm files. The build rewrites no SDK source: it has no plugin, only module aliases |
| `tools/` | The leak scan, the mutation check, the process counter and the Devnet tools (fund, read, verify) |
| `lint.sh` | oxlint (complexity 8, 100 lines per function, 5 parameters), the same limits for Python, and the 100 character line limit. oxlint is the version of `package-lock.json`. CI runs it (`.github/workflows/lint.yml`) |

## Files outside the repo

A tool names each outside file by an environment variable and stops with the name if it is not set.
No tool writes a secret into the repo. Keep these files outside the repo.

| Variable | File | Used by |
|---|---|---|
| `ZOLANA_REPO` | A checkout of github.com/helius-labs/zolana at commit c232da1b (the full sha is `PIN` in `build.mjs`), with `npm ci` and `npm run build:ts` run in it | `build.mjs`, `build.test.mjs`, `mock/`, the SDK references of the harness |
| `HELIUS_URL_FILE` | The Helius Devnet URL, with its API key. Default: `~/.config/zigs/helius-app.url` | The live scenarios, `tools/rpc.mjs`, the leak scan |
| `SOLSPIKE_FUNDER` | The Devnet funder key (a JSON array of 64 bytes) | `tools/fund.mjs`, the leak scan |
| `SOLSPIKE_KEY_B` | A JSON file with the field `seedHex`: key B, a registered Devnet key | `mock/roles.mjs`, `tools/key-b.mjs` |
| `SOLSPIKE_INTERIM` | A file for the backup passphrases of the test group of `scenario-f.mjs`, mode 600 | `harness/scenario-f.mjs` |

`tools/node_modules` must link to `node_modules` of the Zolana checkout (it gives `@solana/kit` to
the Devnet tools). `solspike/node_modules` holds esbuild and oxlint: run `npm ci` here. `cf/node_modules` holds
wrangler: run `npm ci` in `cf/`.

## The local server

`serve.sh` and the harness start `wrangler dev` with `cf/.dev.vars`. That file is not tracked.
Put `DEV_NO_AUTH=1` in it. A live scenario also needs `HELIUS_DEVNET_URL=<the Helius URL>`: the
page gets it from `/sol/config.json`. The Zcash tab of a testnet wallet needs `LWD_KEY=<the key of
infra/lwd/.env.lwd-key>`: without it `/lwd` answers 503 and the page uses the ChainSafe server.
`harness/sol-route.mjs` and `harness/restore-neg.mjs` change single lines of the file and put them
back.

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
bash solspike/lint.sh                            # needs npm ci in solspike
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

The Helius key of the app accepts only the origin `https://app.zigs.app`. So a live scenario runs
with `SOLSPIKE_ORIGIN=https://app.zigs.app`:

- `serve.sh` serves https on 127.0.0.1 with its own self-signed key and cert (`.state/tls`).
- Chrome maps the host to that port and trusts only the key of that cert (`harness/chrome.mjs`).
  `SOLSPIKE_HOST_RULES` adds Chrome host rules.
- The Node tools send the same Origin (`tools/rpc.mjs`, `tools/key-b.mjs`).
- The page gets the Helius URL from `HELIUS_DEVNET_URL` in `cf/.dev.vars`.

| Script | What it does on Devnet |
|---|---|
| `harness/scenario-e.mjs` | A new group. Seat 2 restores its Zcash seat on a blank page before seat 1 taps Add Solana (a restored seat joins the Solana ceremony). The fee address of seat 1 gets 0.003 SOL, and seat 1 adds 0.002 SOL. Two transactions |
| `harness/scenario-f.mjs` | A new group with the unified setup: the create dialog chooses Solana too, and the Solana part starts with no button. Then backups, the fee addresses, Add SOL, a payment to key B, a restore on blank pages, a second payment and a withdrawal to a public address. Ten transactions. `--resume` continues a run that stopped |
| `harness/sol-live.mjs` | Read only: the Worker syncs an empty wallet and reads a nonce account and the tree fees, and the policy probes |
| `harness/scenario-d.mjs`, `harness/sol-cors.mjs` | Checks of the spike. They have not run in this tree |

Run `scenario-e.mjs` and `scenario-f.mjs` with `--mock` first. A mock run makes no Devnet call:

- `tools/paths.mjs` refuses the Helius URL and the funder key.
- Chrome resolves the Helius host to nothing.
- The dev server gets a Helius URL with a fake key. `cf/.dev.vars` gets its old line back after
  the run, also after SIGINT or SIGTERM (not after SIGKILL).

The fake chain of the web tests (`web/test/sol-chain.mjs`) answers the Solana Worker of every
page (`harness/mock-chain.mjs`). So the group, the backups, the funding of the fee addresses, Add
SOL, the private balance and the restore run in full. A payment is live only: the model has no
SDK payment for a new group, so the tap of each payment must be refused at prepare. The results
and the plan of the transactions go to `logs/mock-e.json` or `logs/mock-f.json`. A mock run needs
`ZOLANA_REPO` and `SOLSPIKE_KEY_B`, and no other stack may run from this clone at the same time
(`serve.sh` keeps one pid file):

```bash
SOLSPIKE_ORIGIN=https://app.zigs.app node solspike/harness/scenario-f.mjs --mock
```
