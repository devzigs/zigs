#!/bin/sh
# Deploys main to the staging copy of the app at staging.zigs.app (VEL-2), then checks it from
# outside. Run it after each merge:
#   sh scripts/deploy-staging.sh          deploys origin/main, after a fetch
#   sh scripts/deploy-staging.sh <ref>    deploys another commit, for example a branch to try
#
# - It deploys a clean export of the ref with `wrangler deploy --env staging`: never the working
#   tree, and never production. It refuses a ref whose cf/wrangler.jsonc has no staging
#   environment: wrangler would then deploy the top level, with the production domain.
# - Staging has its own Worker, Durable Object data and password (cf/wrangler.jsonc, env.staging).
#   The password is the secret APP_PASSWORD. It lives only in ~/.config/zigs/staging-password
#   (mode 600), which the first run makes, and it is never printed.
# - HELIUS_DEVNET_URL is the secret of production, read from ~/.config/zigs/helius-app.url. The
#   Helius key answers only the origins on its Allowed Domains list (SOL-48).
# - It needs Node 22 or later, a wrangler login, and git access to devzigs/zigs.
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

# private FILE: the file exists, is not empty, and only its owner can read or write it.
private() {
  [ -s "$1" ] && [ -z "$(find "$1" ! -perm 600)" ]
}

private "$HELIUS" || fail "$HELIUS must hold the Helius Devnet URL, with mode 600"
if [ ! -s "$PASSWORD" ]; then
  mkdir -p "$CONF"
  rm -f "$PASSWORD"
  RANDOM_TEXT=$(openssl rand -base64 33)
  (umask 077 && printf '%s' "$RANDOM_TEXT" | tr -d '\n/+=' > "$PASSWORD")
  unset RANDOM_TEXT
fi
private "$PASSWORD" || fail "$PASSWORD must hold the password, with mode 600"

if [ "$REF" = origin/main ]; then
  GH_CONFIG_DIR=$HOME/.config/gh-zigs git -C "$ROOT" fetch --quiet origin main
fi
COMMIT=$(git -C "$ROOT" rev-parse --short "$REF^{commit}")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive "$COMMIT" cf web > "$WORK/export.tar"
tar -xf "$WORK/export.tar" -C "$WORK"
grep -q '"staging": {' "$WORK/cf/wrangler.jsonc" \
  && grep -q '"pattern": "staging.zigs.app"' "$WORK/cf/wrangler.jsonc" \
  || fail "$COMMIT has no staging environment in cf/wrangler.jsonc"

cd "$WORK/cf"
npm ci --no-audit --no-fund --loglevel=error
npx wrangler deploy --env staging --message "$COMMIT"
tr -d '\n' < "$PASSWORD" | npx wrangler secret put APP_PASSWORD --env staging
tr -d '\n' < "$HELIUS" | npx wrangler secret put HELIUS_DEVNET_URL --env staging

# status PATH [with]: the HTTP status of PATH, with the password when the second argument is set.
# The password goes to curl on stdin, so it never shows in a process list.
status() {
  if [ -n "${2:-}" ]; then
    printf 'user = "staging:%s"\n' "$(cat "$PASSWORD")" \
      | curl -s -m 10 -o /dev/null -w '%{http_code}' -K - "$URL$1"
  else
    curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL$1"
  fi
}

# expect CODE PATH [with]: waits for the answer CODE, at most 10 tries 3 seconds apart, because a
# new secret takes a few seconds to reach every Cloudflare location.
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
