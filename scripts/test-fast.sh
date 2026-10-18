#!/bin/sh
# The fast suite (VEL-4): the web tests that end in seconds, for every change. It runs the unit
# tests of the pure modules, the engine calls through the wasm build, the short Solana tests and
# the link test of the page modules: about 5 s in all. Run it from the root of the repo:
#   sh scripts/test-fast.sh
# The long page tests (SLOW: minutes) and the browser and live checks run before a merge:
# bash solspike/baseline.sh check. qr.mjs needs the qrencode command; without it, the suite skips
# qr.mjs and says so. A test that runs longer than 60 s counts as failed.
cd "$(dirname "$0")/.." || exit 2
case "$(node -v 2>/dev/null)" in
  v24.*) ;;
  *) echo "test-fast: Node 24 is needed, found $(node -v 2>/dev/null || echo none)" >&2; exit 2 ;;
esac
FAST="payees vault chat lwd requests shim signed util account qr personal graph
  sol-docs sol-transfer sol-wasm sol-config sol-rent sol-errors demo-check"
SLOW="app sol-fee sol-sessions sol-limits sol-ceremony sol-app sol-pay"
HELPERS="sol-rig sol-setup sol-chain sol-vector sol-fixture page"
# A new test file goes into FAST or SLOW here, and into TESTS of solspike/baseline.sh.
all=" $(echo $FAST $SLOW $HELPERS) "
for f in web/test/*.mjs; do
  case "$all" in
    *" $(basename "$f" .mjs) "*) ;;
    *) echo "test-fast: $f is in no list of this script (FAST, SLOW or HELPERS)" >&2; exit 2 ;;
  esac
done
failed=""
ran=0
start=$(date +%s)
for t in $FAST; do
  if [ "$t" = qr ] && ! command -v qrencode >/dev/null; then
    echo "test-fast: qr skipped, qrencode is not installed"
    continue
  fi
  ran=$((ran + 1))
  # perl alarm: a portable time limit (macOS has no timeout command by default).
  if ! perl -e 'alarm shift; exec @ARGV' 60 node "web/test/$t.mjs" >/dev/null 2>&1; then
    echo "test-fast: $t FAILED or ran over 60 s (run: node web/test/$t.mjs)"
    failed="$failed $t"
  fi
done
echo "test-fast: $ran tests in $(($(date +%s) - start)) s, ${failed:+failed:}${failed:-all pass}"
[ -z "$failed" ]
