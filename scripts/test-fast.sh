#!/bin/sh
# The fast suite (VEL-4): the web tests that end in seconds, for every change. It runs the unit
# tests of the pure modules, the engine calls through the wasm build, the short Solana tests and
# the link test of the page modules: about 5 s in all. Run it from the root of the repo:
#   sh scripts/test-fast.sh
# The long page tests (app, sol-fee, sol-sessions, sol-limits, sol-ceremony, sol-app, sol-pay:
# minutes) and the browser and live checks run before a merge: bash solspike/baseline.sh check.
# qr.mjs needs the qrencode command; without it, the suite skips qr.mjs and says so.
cd "$(dirname "$0")/.." || exit 2
case "$(node -v 2>/dev/null)" in
  v24.*) ;;
  *) echo "test-fast: Node 24 is needed, found $(node -v 2>/dev/null || echo none)" >&2; exit 2 ;;
esac
FAST="payees vault chat lwd requests shim signed util account qr personal graph
  sol-docs sol-transfer sol-wasm sol-config"
failed=""
start=$(date +%s)
for t in $FAST; do
  if [ "$t" = qr ] && ! command -v qrencode >/dev/null; then
    echo "test-fast: qr skipped, qrencode is not installed"
    continue
  fi
  if ! node "web/test/$t.mjs" >/dev/null 2>&1; then
    echo "test-fast: $t FAILED (run: node web/test/$t.mjs)"
    failed="$failed $t"
  fi
done
echo "test-fast: $(echo $FAST | wc -w | tr -d ' ') tests in $(($(date +%s) - start)) s," \
  "${failed:+failed:}${failed:-all pass}"
[ -z "$failed" ]
