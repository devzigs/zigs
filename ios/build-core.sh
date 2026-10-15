#!/usr/bin/env bash
# Builds the Rust engine for iOS devices, the simulator and Apple silicon Macs, and packs it as
# ZigsCore.xcframework.
set -euo pipefail
cd "$(dirname "$0")/../wasm"

export RUSTFLAGS="--remap-path-prefix=$HOME=/build"
export IPHONEOS_DEPLOYMENT_TARGET=17.0
export MACOSX_DEPLOYMENT_TARGET=14.0
for target in aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin; do
  cargo build --release --lib --target "$target"
done

lib=libzigs_engine.a
out=../ios/ZigsCore.xcframework
rm -rf "$out"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/$lib -headers ../ios/ZigsCore/include \
  -library target/aarch64-apple-ios-sim/release/$lib -headers ../ios/ZigsCore/include \
  -library target/aarch64-apple-darwin/release/$lib -headers ../ios/ZigsCore/include \
  -output "$out"
