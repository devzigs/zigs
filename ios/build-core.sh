#!/usr/bin/env bash
# Builds the Rust engine for iOS devices and the simulator, and packs it as ZigsCore.xcframework.
set -euo pipefail
cd "$(dirname "$0")/../wasm"

export RUSTFLAGS="--remap-path-prefix=$HOME=/build"
export IPHONEOS_DEPLOYMENT_TARGET=17.0
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo build --release --lib --target "$target"
done

out=../ios/ZigsCore.xcframework
rm -rf "$out"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libzec_frost_wasm.a -headers ../ios/ZigsCore/include \
  -library target/aarch64-apple-ios-sim/release/libzec_frost_wasm.a -headers ../ios/ZigsCore/include \
  -output "$out"
