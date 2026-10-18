#!/bin/sh
# The read-only preflight of the demo days (M8 of docs/hackathon-release.md). Run it by hand at
# least every two days until the demo, after any Helius release note, and one hour before the demo
# (docs/demo.md section 3). scripts/deploy-staging.sh runs its --app-only part.
#   sh solspike/demo-check.sh [--dry-run] [--app-only] [--config FILE]
# Each check prints PASS, FAIL or SKIP with a reason. The exit code is 1 on any FAIL and 2 on a
# bad config. --dry-run lists the checks and sends nothing. tools/demo-check.mjs has the checks
# and the config format. It sends no write to a chain and prints no secret. Node 22 or later.
# The browser smoke check of staging (no console error, M1, S1) is node solspike/smoke.mjs (S19).
HERE=$(cd "$(dirname "$0")" && pwd)
case "$(node -v 2>/dev/null)" in
  v2[2-9].* | v[3-9][0-9].*) ;;
  *)
    echo "demo-check: Node 22 or later is needed, found $(node -v 2>/dev/null || echo none)" >&2
    exit 2
    ;;
esac
exec node "$HERE/tools/demo-check.mjs" "$@"
