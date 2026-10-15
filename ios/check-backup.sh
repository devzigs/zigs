#!/usr/bin/env bash
# Checks that a backup from the web app opens in the iOS code, and the reverse. It also checks the
# signed writes of version 3 wallets in both directions: the iOS code accepts the signatures of
# documents that the web code made, and the web code accepts the ones that the iOS code made. It
# compiles the app sources with a small test program, so it needs ZigsCore.xcframework (run
# ios/build-core.sh) and node. It never touches the Keychain: the test program does not start the
# app.
set -euo pipefail
cd "$(dirname "$0")"
fw=ZigsCore.xcframework/macos-arm64
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sed 's/^@main$//' Zigs/ZigsApp.swift > "$work/ZigsApp.swift"
swiftc -swift-version 5 -enable-bare-slash-regex -module-name Zigs -I "$fw/Headers" -L "$fw" \
  -lzigs_engine -lc++ $(ls Zigs/*.swift | grep -v ZigsApp.swift) "$work/ZigsApp.swift" \
  CheckBackup/main.swift -o "$work/check"
node CheckBackup/web.mjs make "$work"
"$work/check" "$work"
node CheckBackup/web.mjs verify "$work"
echo "backup interop ok"
