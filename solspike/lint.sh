#!/bin/bash
# Lints the Solana code: oxlint (complexity 8, 100 lines per function, 5 parameters, depth 3),
# the same limits for Python, and a check for lines over 100 characters. It covers the tools,
# the Solana files in web/sol (not the bundle) and the mock run, and it checks the imports of the
# page modules (solspike/oxlintrc-page.json). oxlint is a dev dependency of solspike at one
# version, because its rules and its browser globals change between versions: run `npm ci` in
# solspike first. oxlint refuses paths with "..", so it runs from the root of the repo.
cd "$(dirname "$0")/.." || exit 1
OX=solspike/node_modules/.bin/oxlint
[ -x "$OX" ] || { echo "lint.sh: $OX is missing, run npm ci in solspike" >&2; exit 2; }
JS=(solspike/harness/*.mjs solspike/tools/*.mjs solspike/build.mjs solspike/src/*.js
  solspike/stubs/*.js solspike/test/*.mjs solspike/mock/*.mjs
  solspike/mock/page/*.js web/sol/guard.js web/sol/prepare.js web/sol/worker.js web/sol/client.js
  web/sol/main.js web/sol/docs.js web/sol/secrets.js web/sol/ceremony.js web/sol/view.js
  web/sol/store.js web/sol/backup.js web/sol/session.js web/sol/abort.js
  web/sol/approve.js web/sol/gate.js web/sol/intent.js web/sol/nonces.js web/sol/payview.js
  web/sol/propose.js web/sol/sessions.js web/sol/signing.js web/sol/fee.js web/sol/addsol.js
  web/sol/execute.js web/test/sol-rig.mjs web/test/sol-fixture.mjs web/test/page.mjs
  web/test/graph.mjs
  web/test/sol-config.mjs web/test/sol-docs.mjs web/test/sol-ceremony.mjs web/test/sol-app.mjs
  web/test/sol-wasm.mjs web/test/sol-chain.mjs web/test/sol-sessions.mjs
  web/sol/spend.js web/sol/transfer.js web/test/sol-limits.mjs web/test/sol-setup.mjs
  web/test/sol-transfer.mjs web/test/sol-vector.mjs web/test/sol-pay.mjs web/test/sol-fee.mjs)
PY=(solspike/tools/*.py)
# The page modules first: no unbound name, no assignment of an import, no missing named import.
# This is the only check for an import that a function body needs and that no test runs. The full
# rules below do not apply to the page modules yet: they keep the findings of the old app.js.
"$OX" -c solspike/oxlintrc-page.json --deny-warnings web/app.js web/app-*.js || exit 1
"$OX" -c solspike/oxlintrc.json --deny-warnings "${JS[@]}" || exit 1
python3 -I solspike/tools/check_py.py "${PY[@]}" || exit 1
long=$(awk 'length($0)>100 {print FILENAME":"FNR": "length($0)}' "${JS[@]}" "${PY[@]}" \
  solspike/*.sh)
if [ -n "$long" ]; then echo "lines over 100 characters:"; echo "$long"; exit 1; fi
echo "lint ok: ${#JS[@]} js files, ${#PY[@]} python files"
