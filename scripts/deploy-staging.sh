#!/bin/sh
# Deploys main to the staging copy of the app at staging.zigs.app (VEL-2), then checks it from
# outside. Run it after each merge:
#   sh scripts/deploy-staging.sh          deploys origin/main, after a fetch
#   sh scripts/deploy-staging.sh <ref>    deploys another commit, for example a branch to try
#
# - It deploys a clean export of the ref with `wrangler deploy --env staging`: never the working
#   tree, and never production.
# - Staging has its own Worker, Durable Object data and password (cf/wrangler.jsonc, env.staging).
#   The password is the secret APP_PASSWORD. It lives only in ~/.config/zigs/staging-password
#   (mode 600), which the first run makes, and it is never printed.
# - HELIUS_DEVNET_URL is the secret of production, read from ~/.config/zigs/helius-app.url. The
#   Helius key answers only the origins on its Allowed Domains list.
# - It needs Node 20 or later, a wrangler login, and git access to devzigs/zigs.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONF=$HOME/.config/zigs
PASSWORD=$CONF/staging-password
HELIUS=$CONF/helius-app.url
URL=https://staging.zigs.app
REF=${1:-origin/main}

fail() {
  echo "deploy-staging: $*" >&2
  exit 1
}

mode() {
  stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"
}

[ -s "$HELIUS" ] || fail "missing $HELIUS (the Helius Devnet URL)"
if [ ! -s "$PASSWORD" ]; then
  mkdir -p "$CONF"
  (umask 077 && openssl rand -base64 33 | tr -d '\n/+=' > "$PASSWORD")
fi
[ "$(mode "$PASSWORD")" = 600 ] || fail "$PASSWORD must have mode 600"

if [ "$REF" = origin/main ]; then
  GH_CONFIG_DIR=${GH_CONFIG_DIR:-$HOME/.config/gh-zigs} git -C "$ROOT" fetch --quiet origin main
fi
COMMIT=$(git -C "$ROOT" rev-parse --short "$REF^{commit}")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive "$COMMIT" cf web | tar -x -C "$WORK"

cd "$WORK/cf"
npm ci --no-audit --no-fund --silent
npx wrangler deploy --env staging
tr -d '\n' < "$PASSWORD" | npx wrangler secret put APP_PASSWORD --env staging
tr -d '\n' < "$HELIUS" | npx wrangler secret put HELIUS_DEVNET_URL --env staging

# status PATH [with]: the HTTP status of PATH, with the password when the second argument is set.
# The password goes to curl on stdin, so it never shows in a process list.
status() {
  if [ -n "${2:-}" ]; then
    printf 'user = "staging:%s"\n' "$(cat "$PASSWORD")" \
      | curl -s -o /dev/null -w '%{http_code}' -K - "$URL$1"
  else
    curl -s -o /dev/null -w '%{http_code}' "$URL$1"
  fi
}

# expect CODE PATH [with]: waits up to 30 seconds for the answer CODE, because a new secret takes a
# few seconds to reach every Cloudflare location.
expect() {
  tries=10
  until [ "$(status "$2" "${3:-}")" = "$1" ]; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || fail "$URL$2 ${3:+with the password }must answer $1"
    sleep 3
  done
}

expect 401 /
expect 200 / with
expect 200 /sol/config.json with
echo "deploy-staging: $COMMIT ($REF) is live at $URL"
