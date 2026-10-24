#!/bin/sh
# The fast suite (VEL-4): the web tests that end in seconds, for every change. It runs the unit
# tests of the pure modules, the engine calls through the wasm build, the short Solana tests and
# the link test of the page modules: about 10 s in all, three tests at a time. Run it from the
# root of the repo:
#   sh scripts/test-fast.sh
# The long page tests (SLOW: minutes) and the browser and live checks run before a merge:
# bash solspike/baseline.sh check. qr.mjs needs the qrencode command; without it, the suite skips
# qr.mjs and says so. A test that runs longer than 60 s counts as failed.
cd "$(dirname "$0")/.." || exit 2
case "$(node -v 2>/dev/null)" in
  v26.*) ;;
  *) echo "test-fast: Node 26 is needed, found $(node -v 2>/dev/null || echo none)" >&2; exit 2 ;;
esac
FAST="optional-passkey demo-check chain-fallback chat backup-check graph personal sol-rent
  sol-config sol-errors guided-create
  messaging-presentation messaging-cost-review messaging-account-view premium-motion homepage-motion
  outcome-seal passkey-setup wallet-description guided-setup
  recipients swap-preview
  payees vault lwd zns
  requests shim shim-status
  signed util account qr
  sol-docs sol-transfer sol-wasm mainnet-off
  smoke help contrast overview setup-stage approvals recovery security-dashboard
  payment-model
  cf/test/gate sol-nonce-tabs no-storage"
SLOW="app sol-fee sol-sessions sol-limits sol-ceremony sol-app sol-pay sol-pay-exec sol-pay-seats
  sol-pay-lease sol-pay-look sol-pay-end unified-setup sol-prove"
HELPERS="passkey-fixture sol-rig sol-setup sol-chain sol-vector sol-fixture sol-pay-rig page"
# A new test file goes into FAST or SLOW here, and into TESTS of solspike/baseline.sh. A name is
# a file of web/test; an entry with a slash is a path from the root (cf/test/gate).
all=" $(echo $FAST $SLOW $HELPERS) "
for f in web/test/*.mjs; do
  case "$all" in
    *" $(basename "$f" .mjs) "*) ;;
    *) echo "test-fast: $f is in no list of this script (FAST, SLOW or HELPERS)" >&2; exit 2 ;;
  esac
done
# Three tests run at once, the slowest first (the start of FAST): the tests share no port and no
# file. perl alarm is a portable time limit (macOS has no timeout command by default).
dir=$(mktemp -d) || exit 2
trap 'rm -rf "$dir"' EXIT
export dir
queue=""
ran=0
start=$(date +%s)
for t in $FAST; do
  if [ "$t" = qr ] && ! command -v qrencode >/dev/null; then
    echo "test-fast: qr skipped, qrencode is not installed"
    continue
  fi
  queue="$queue $t"
  ran=$((ran + 1))
done
printf '%s\n' $queue | xargs -P 3 -I{} sh -c '
  file="web/test/$1.mjs"
  case "$1" in */*) file="$1.mjs" ;; esac
  perl -e "alarm shift; exec @ARGV" 60 node "$file" >/dev/null 2>&1 && exit 0
  echo "test-fast: $1 FAILED or ran over 60 s (run: node $file)"
  echo "$1" >>"$dir/failed"
' sh {}
failed=$(sort "$dir/failed" 2>/dev/null | sed 's/^/ /' | tr -d '\n')
echo "test-fast: $ran tests in $(($(date +%s) - start)) s, ${failed:+failed:}${failed:-all pass}"
[ -z "$failed" ]
