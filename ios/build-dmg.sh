#!/usr/bin/env bash
# Builds the Mac app in Release and packs it into dist/Zigs-<version>-arm64.dmg. It refuses an app
# that contains a home folder path, so the download does not name the person who built it.
# The scan reads raw bytes: `strings` misses some of the paths that the Swift compiler stores.
set -euo pipefail
cd "$(dirname "$0")"
version=$(sed -n 's/.*MARKETING_VERSION: "\(.*\)"/\1/p' project.yml)
dd="${TMPDIR:-/tmp}/zigs-ZigsMac"
stage=$(mktemp -d)
xcodegen generate -q
xcodebuild -project Zigs.xcodeproj -scheme ZigsMac -destination 'platform=macOS' \
  -configuration Release -derivedDataPath "$dd" -quiet build
app="$dd/Build/Products/Release/Zigs.app"
if LC_ALL=C /usr/bin/grep -r -a -l -E '/Use[r]s/|/hom[e]/' "$app"; then
  echo "A home folder path is in the files above. The DMG was not made." >&2
  exit 1
fi
codesign --verify --deep --strict "$app"
ditto "$app" "$stage/Zigs.app"
ln -s /Applications "$stage/Applications"
mkdir -p ../dist
hdiutil create -volname Zigs -srcfolder "$stage" -fs APFS -format UDZO -ov \
  "../dist/Zigs-$version-arm64.dmg" | tail -1
