#!/bin/bash
# The Zcash baseline gate. Usage: baseline.sh record | check
# It runs every web/test/*.mjs in TESTS and cf/test/limits.mjs (against a dev server that it
# starts on port 8795 and stops by PID), then tools/baseline.mjs hashes wasm/, web/pkg/ and
# web/signed.js, extracts policy(), reads the headers that the server sent, and writes
# baseline.json (record) or compares with it (check). SOLSPIKE_PORT moves the port. The ten
# sol-* tests need no server. HELPERS are imported by the tests and are no test: sol-setup.mjs
# runs a ceremony and never exits on its own. A web/test/*.mjs in neither list stops the gate.
# The server runs with cf/.dev.vars: it must hold DEV_NO_AUTH=1 (see README.md). Run it as:
#   bash solspike/baseline.sh check
set -u
MODE=${1:-}
case "$MODE" in record | check) ;; *) echo "usage: baseline.sh record|check" >&2; exit 2 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
OUT=$HERE/.state/baseline-logs
EXITS=$HERE/.state/baseline-exits.tsv
HEADERS=$HERE/.state/served-headers.txt
PORT=${SOLSPIKE_PORT:-8795}
case "$(node -v)" in
  v24.*) ;;
  *) echo "baseline: Node 24 is needed, found $(node -v)" >&2; exit 2 ;;
esac
mkdir -p "$OUT"
: >"$EXITS"
cd "$ROOT" || exit 2

# run NAME COMMAND...: runs a test, keeps its output in a log, adds one line to EXITS.
run() {
  local name=$1 start code
  shift
  start=$(date +%s)
  "$@" >"$OUT/$(basename "$name").log" 2>&1
  code=$?
  printf '%s\t%s\n' "$name" "$code" >>"$EXITS"
  echo "baseline: $name exit $code ($(($(date +%s) - start)) s)"
}

stopped=0
stop_server() { [ "$stopped" = 1 ] || "$HERE/serve.sh" stop; stopped=1; }
trap stop_server EXIT

TESTS=(chat signed app requests account personal payees vault util qr shim shim-status lwd zns
  sol-config sol-docs sol-ceremony sol-app sol-wasm sol-sessions sol-limits sol-pay sol-transfer
  unified-setup
  graph sol-fee sol-rent sol-errors sol-prove demo-check mainnet-off chain-fallback smoke
  contrast overview sol-nonce-tabs)
HELPERS=(sol-rig sol-setup sol-chain sol-vector sol-fixture page)
for f in web/test/*.mjs; do
  name=$(basename "$f" .mjs)
  if [[ " ${TESTS[*]} ${HELPERS[*]} " != *" $name "* ]]; then
    echo "baseline: $f is neither in TESTS nor in HELPERS of baseline.sh" >&2
    exit 2
  fi
done
for t in "${TESTS[@]}"; do
  if [ "$t" = qr ] && ! command -v qrencode >/dev/null; then
    printf 'web/test/qr.mjs\tskipped\tqrencode is not installed\n' >>"$EXITS"
    continue
  fi
  run "web/test/$t.mjs" node "web/test/$t.mjs"
done
"$HERE/serve.sh" start || exit 1
# An empty file makes baseline.mjs fail, so an old answer is never read.
: >"$HEADERS"
curl -s -D "$HEADERS" -o /dev/null --max-time 10 "http://localhost:$PORT/"
run cf/test/limits.mjs node cf/test/limits.mjs "ws://localhost:$PORT"
stop_server
# The tool must print its result line. A tool that ends with exit 0 and no line did not run the
# gate, so that is a failure and not a pass.
result=$(node "$HERE/tools/baseline.mjs" "$MODE" "$EXITS" "$HEADERS")
code=$?
printf '%s\n' "$result"
line="^$MODE: [0-9]+ tests, [0-9]+ hashed files, [0-9]+ problems$"
if ! grep -Eq "$line" <<<"$result"; then
  echo "baseline: tools/baseline.mjs printed no $MODE result line, the gate did not run" >&2
  exit 1
fi
exit "$code"
