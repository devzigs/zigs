#!/bin/bash
# The live Devnet batch: scenario-e, scenario-f and scenario-g of solspike/harness, on Devnet.
# Only the coordinator session runs it, after the owner's yes in its chat: no other session runs a
# live chain write. Run it from a clean checkout of the approved commit; it refuses any other
# checkout before it does anything else.
#   BATCH_COMMIT=<sha> solspike/live-batch.sh [step ...]
#   steps: scenario-e scenario-f scenario-g (default: scenario-e scenario-f)
# BATCH_PORT and BATCH_CHROME_PORTS move the ports (default 8798 and 9400-9409), and BATCH_ARGS is
# added to each command (for example --resume). The keys come from the export lines of
# ~/.config/zigs/live-env.sh, and the Helius URL goes from ~/.config/zigs/helius-app.url into
# cf/.dev.vars (never printed, removed at exit). Logs and interim files: solspike/logs (ignored).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$(dirname "$HERE")" || exit 1
want=${BATCH_COMMIT:?set BATCH_COMMIT to the approved commit}
head=$(git rev-parse HEAD)
if [ "$head" != "$(git rev-parse "$want^{commit}")" ] || [ -n "$(git status --porcelain)" ]; then
  echo "live-batch: this is not a clean checkout of $want" >&2
  exit 1
fi
case "$(node -v 2>/dev/null)" in
  v24.*) ;;
  *) echo "live-batch: Node 24 is needed" >&2; exit 2 ;;
esac
echo "live-batch: commit $(git rev-parse --short HEAD)"
env_file=$HOME/.config/zigs/live-env.sh
eval "$(grep -E '^export (ZOLANA_REPO|SOLSPIKE_FUNDER|SOLSPIKE_KEY_B)=' "$env_file")"
export SOLSPIKE_PORT=${BATCH_PORT:-8798} SOLSPIKE_CHROME_PORTS=${BATCH_CHROME_PORTS:-9400-9409}
export SOLSPIKE_ORIGIN=https://app.zigs.app
LOGS=solspike/logs
mkdir -p "$LOGS"

dev_url() { # set | drop the HELIUS_DEVNET_URL line of cf/.dev.vars
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { setDevVar } from "./solspike/harness/server.mjs";
    const [mode, file] = process.argv.slice(1);
    setDevVar("HELIUS_DEVNET_URL", mode === "set" ? readFileSync(file, "utf8").trim() : null);
  ' "$1" "$HOME/.config/zigs/helius-app.url"
}
# A cf/.dev.vars that the checkout lacks is made with DEV_NO_AUTH=1 and removed at exit.
fresh_vars=0
[ -f cf/.dev.vars ] || fresh_vars=1
cleanup() {
  dev_url drop
  if [ "$fresh_vars" = 1 ]; then rm -f cf/.dev.vars; fi
}
trap cleanup EXIT
if [ "$fresh_vars" = 1 ]; then (umask 077 && printf 'DEV_NO_AUTH=1\n' >cf/.dev.vars); fi
dev_url set || exit 1

# The heavy-slot script and caffeinate of the machine, when it has them.
wrap=()
command -v caffeinate >/dev/null && wrap+=(caffeinate -s -i)
[ -x "$HOME/.config/zigs/heavy.sh" ] && wrap+=("$HOME/.config/zigs/heavy.sh")
steps=("$@")
[ ${#steps[@]} -gt 0 ] || steps=(scenario-e scenario-f)
for step in "${steps[@]}"; do
  case $step in
    scenario-e | scenario-f | scenario-g) ;;
    *) echo "$step: no such step"; continue ;;
  esac
  # Each step keeps its backups in its own file. A run refuses the file of an earlier group, so
  # move it away after a finished run (or pass BATCH_ARGS=--resume to continue a stopped one).
  export SOLSPIKE_INTERIM=$LOGS/interim-$step.json
  # shellcheck disable=SC2086 # BATCH_ARGS is a list of words
  ${wrap[@]+"${wrap[@]}"} node "solspike/harness/$step.mjs" ${BATCH_ARGS:-} \
    >"$LOGS/live-$step.log" 2>&1
  echo "$step: exit $?"
done
