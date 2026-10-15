#!/bin/bash
# Local wrangler dev server of this repo. It never deploys and never logs in. It reads cf/.dev.vars.
# Usage: serve.sh start | stop | status
# The server runs on port 8795 (SOLSPIKE_PORT moves it). Start and stop work by PID. The pid file
# (.state/serve.pid) holds the PID. Before any signal the process must be this repo's wrangler dev
# server on this port: its command line and its working directory (cf/) must match. A PID that
# another process reused is a stale entry, and nothing is signalled. Nothing here reads a time or
# a locale.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
STATE=$HERE/.state
PIDFILE=$STATE/serve.pid
PORT=${SOLSPIKE_PORT:-8795}
INSPECTOR=${SOLSPIKE_INSPECTOR_PORT:-0}
URL=http://localhost:$PORT/

alive() { kill -0 "$1" 2>/dev/null; }
# True when $1 is the wrangler dev server of this clone on this port. lsof reports the real path
# of the working directory, so cf/ is compared as a real path too.
is_server() {
  local cmd cf cwd
  cmd=$(ps -ww -o command= -p "$1" 2>/dev/null)
  case "$cmd" in *"wrangler-dist/cli.js dev --local --port $PORT "*) ;; *) return 1 ;; esac
  cf=$(cd "$ROOT/cf" 2>/dev/null && pwd -P) || return 1
  cwd=$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [ "$cwd" = "$cf" ]
}
# The first word of the pid file. A last line without a newline still counts.
recorded_pid() { local pid; { read -r pid _ || [ -n "$pid" ]; } <"$PIDFILE" && echo "$pid"; }
# True when the pid file names the live server of this clone.
running() {
  local pid
  [ -f "$PIDFILE" ] || return 1
  pid=$(recorded_pid)
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  is_server "$pid"
}
# A pid file that no live server matches: say so and remove it. Nothing is signalled.
drop_stale() {
  [ -f "$PIDFILE" ] || return 0
  echo "serve: stale pid file ($(tr '\n' ' ' <"$PIDFILE")): no matching process, removed" >&2
  rm -f "$PIDFILE"
}

# Prints the PIDs of every descendant of $1, children first.
descendants() {
  ps -A -o pid=,ppid= | awk -v root="$1" '
    { parent[$1] = $2 }
    END {
      queue[1] = root; head = 1; tail = 1
      while (head <= tail) {
        cur = queue[head++]
        for (p in parent) if (parent[p] == cur) { queue[++tail] = p; print p }
      }
    }'
}

port_busy() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }

wait_ready() {
  local pid=$1 i
  for i in $(seq 1 120); do
    alive "$pid" || { echo "serve: wrangler exited, see .state/serve.log" >&2; return 1; }
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$URL")" = 200 ] && return 0
    sleep 0.5
  done
  echo "serve: no answer from $URL after 60 s" >&2
  return 1
}

start() {
  if running; then echo "serve: already running"; return 0; fi
  drop_stale
  port_busy && { echo "serve: port $PORT is busy, not starting" >&2; return 1; }
  mkdir -p "$STATE/xdg" "$STATE/wrangler-logs"
  cd "$ROOT/cf" || return 1
  WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME="$STATE/xdg" \
    WRANGLER_LOG_PATH="$STATE/wrangler-logs" WRANGLER_REGISTRY_PATH="$STATE/registry" CI=1 \
    nohup node --no-warnings node_modules/wrangler/wrangler-dist/cli.js dev --local --port "$PORT" \
    --inspector-port "$INSPECTOR" --persist-to "$STATE" --show-interactive-dev-session=false \
    >"$STATE/serve.log" 2>&1 </dev/null &
  local pid=$!
  echo "$pid" >"$PIDFILE"
  wait_ready "$pid" || { stop; return 1; }
  echo "serve: ready at $URL (pid $pid)"
}

stop() {
  [ -f "$PIDFILE" ] || { echo "serve: not running"; return 0; }
  running || { drop_stale; return 0; }
  local pid kids left p
  pid=$(recorded_pid)
  kids=$(descendants "$pid" | tr '\n' ' ')
  alive "$pid" && kill -TERM "$pid"
  for _ in $(seq 1 40); do
    left=""
    for p in $pid $kids; do alive "$p" && left="$left $p"; done
    [ -z "$left" ] && break
    sleep 0.5
  done
  for p in $left; do
    echo "serve: pid $p survived SIGTERM, sending SIGKILL" >&2
    kill -KILL "$p"
  done
  rm -f "$PIDFILE"
  echo "serve: stopped (pid $pid, descendants: ${kids:-none})"
}

status() {
  if running; then echo "running pid $(recorded_pid)"; else echo stopped; fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: serve.sh start|stop|status" >&2; exit 2 ;;
esac
