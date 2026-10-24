#!/bin/bash
# The Zcash baseline gate. Usage: baseline.sh record | check
# It runs every web/test/*.mjs in TESTS, cf/test/gate.mjs, and cf/test/limits.mjs (against a dev
# server that it starts on port 8795 and stops by PID), then tools/baseline.mjs hashes wasm/,
# web/pkg/ and web/signed.js, extracts policy(), reads the headers that the server sent, and writes
# baseline.json (record) or compares with it (check). SOLSPIKE_PORT moves the port. The sol-*
# tests need no server. HELPERS are imported by the tests and are no test: sol-setup.mjs runs a
# ceremony and never exits on its own. A web/test/*.mjs in neither list stops the gate.
# Three tests run at once (JOBS), the slowest first (SLOW_FIRST): the tests share no port and no
# file, and each keeps its own log in .state/baseline-logs. EXITS keeps the order of TESTS.
# check runs no test when a passing run of the same files, Node version, .dev.vars, TZ and
# installed packages left a stamp that is not older than 24 h (tools/baseline.mjs). It
# replays the exit codes of that run, starts the server again to read the headers, and compares
# with baseline.json as always. A fresh checkout has no stamp.
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
JOBS=3
case "$(node -v)" in
  v26.*) ;;
  *) echo "baseline: Node 26 is needed, found $(node -v)" >&2; exit 2 ;;
esac
mkdir -p "$OUT"
: >"$EXITS"
cd "$ROOT" || exit 2

# run_test NAME COMMAND...: runs a test, keeps its output in a log and its exit code in a file.
run_test() {
  local name=$1 start code
  shift
  start=$(date +%s)
  "$@" >"$OUT/$(basename "$name").log" 2>&1
  code=$?
  echo "$code" >"$OUT/$(basename "$name").exit"
  echo "baseline: $name exit $code ($(($(date +%s) - start)) s)"
}

# read_headers: starts the dev server and keeps the headers that it sends for "/". They depend on
# cf/node_modules and cf/.dev.vars, so a reused run reads them again.
read_headers() {
  # An empty file makes baseline.mjs fail, so an old answer is never read.
  : >"$HEADERS"
  "$HERE/serve.sh" start || return 1
  # A curl that fails leaves the file empty, and baseline.mjs fails on it.
  curl -s -D "$HEADERS" -o /dev/null --max-time 10 "http://localhost:$PORT/" || true
}

# The dev server lives as long as the one test that needs it.
limits_test() {
  if ! read_headers; then
    echo 1 >"$OUT/limits.mjs.exit"
    return
  fi
  run_test cf/test/limits.mjs node cf/test/limits.mjs "ws://localhost:$PORT"
  "$HERE/serve.sh" stop
}

# job NAME: one entry of the queue. A name with a slash is a test of cf/test.
job() {
  case "$1" in
    cf/test/limits) limits_test ;;
    cf/test/*) run_test "$1.mjs" node "$1.mjs" ;;
    *) run_test "web/test/$1.mjs" node "web/test/$1.mjs" ;;
  esac
}
export -f run_test read_headers limits_test job
export OUT HERE PORT HEADERS

stopped=0
stop_server() { [ "$stopped" = 1 ] || "$HERE/serve.sh" stop; stopped=1; }
trap stop_server EXIT

TESTS=(messaging-presentation messaging-cost-review messaging-account-view premium-motion
  homepage-motion
  outcome-seal passkey-setup optional-passkey guided-create wallet-description
  backup-check guided-setup
  recipients swap-preview
  chat signed app
  requests account personal payees
  vault util qr shim shim-status
  lwd zns
  sol-config sol-docs sol-ceremony sol-app sol-wasm sol-sessions sol-limits sol-pay sol-pay-exec
  sol-pay-seats sol-pay-lease sol-pay-look sol-pay-end sol-transfer
  unified-setup help
  graph sol-fee sol-rent sol-errors sol-prove demo-check mainnet-off chain-fallback smoke
  contrast overview setup-stage approvals recovery security-dashboard payment-model
  sol-nonce-tabs no-storage)
HELPERS=(passkey-fixture sol-rig sol-setup sol-chain sol-vector sol-fixture sol-pay-rig page)
# The tests that take more than 20 s, slowest first, then the server test. Each must be in TESTS.
SLOW_FIRST=(sol-pay app sol-pay-seats sol-pay-exec sol-pay-lease sol-pay-look sol-ceremony sol-app
  unified-setup sol-sessions sol-pay-end sol-limits cf/test/limits)
for f in web/test/*.mjs; do
  name=$(basename "$f" .mjs)
  if [[ " ${TESTS[*]} ${HELPERS[*]} " != *" $name "* ]]; then
    echo "baseline: $f is neither in TESTS nor in HELPERS of baseline.sh" >&2
    exit 2
  fi
done

# The queue: the slow tests, then the others in the order of TESTS. qr needs qrencode.
queue=("${SLOW_FIRST[@]}")
for t in "${TESTS[@]}" cf/test/gate; do
  [[ " ${SLOW_FIRST[*]} " == *" $t "* ]] && continue
  [ "$t" = qr ] && ! command -v qrencode >/dev/null && continue
  queue+=("$t")
done
for t in "${SLOW_FIRST[@]}"; do
  if [[ " ${TESTS[*]} cf/test/limits " != *" $t "* ]]; then
    echo "baseline: $t is in SLOW_FIRST and in no other list of baseline.sh" >&2
    exit 2
  fi
done

reused=no
if [ "$MODE" = check ]; then
  note=$(node "$HERE/tools/baseline.mjs" reuse "$EXITS")
  case "$note" in reuse:*) echo "baseline: $note" ;; esac
  case "$note" in "reuse: yes"*) reused=yes ;; esac
fi
if [ "$reused" = no ]; then
  node "$HERE/tools/baseline.mjs" begin >/dev/null ||
    echo "baseline: begin failed, this run leaves no stamp" >&2
  rm -f "$OUT"/*.exit
  printf '%s\0' "${queue[@]}" | xargs -0 -n 1 -P "$JOBS" "$BASH" -c 'job "$0"'
  stopped=1 # limits_test stopped the server; the trap stops it if this run ends before
  # The results in the order of TESTS, whatever test ended first.
  for t in "${TESTS[@]}" cf/test/gate cf/test/limits; do
    file=web/test/$t.mjs
    case "$t" in cf/*) file=$t.mjs ;; esac
    if [ "$t" = qr ] && ! command -v qrencode >/dev/null; then
      printf '%s\tskipped\tqrencode is not installed\n' "$file" >>"$EXITS"
      continue
    fi
    code=$(cat "$OUT/$(basename "$file").exit" 2>/dev/null)
    [ -n "$code" ] || { echo "baseline: $file left no exit code" >&2; code=1; }
    printf '%s\t%s\n' "$file" "$code" >>"$EXITS"
  done
else
  read_headers || exit 1
  stop_server
fi
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
