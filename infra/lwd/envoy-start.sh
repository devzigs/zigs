#!/bin/sh
# Starts Envoy on envoy.yaml with the key of the tunnel listener in place of __LWD_KEY__.
# Without a key of exactly 64 lowercase hex characters it stops, so a missing key never opens the
# tunnel listener, and sed never sees a special character. Arguments go to Envoy. The envoy user
# reads the rendered file, so it keeps the default mode.
set -eu
key=${LWD_KEY:-}
case "$key" in *[!0123456789abcdef]*) key= ;; esac
if [ "${#key}" -ne 64 ]; then
  echo "envoy-start: LWD_KEY must be 64 lowercase hex characters (openssl rand -hex 32)" >&2
  exit 1
fi
sed "s/__LWD_KEY__/$key/" /etc/envoy/envoy.yaml.tmpl > /tmp/envoy.yaml
exec /docker-entrypoint.sh envoy -c /tmp/envoy.yaml "$@"
