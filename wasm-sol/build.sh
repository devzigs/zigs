#!/bin/sh
# Builds the Solana wasm and its bindings. Run it from any folder: sh wasm-sol/build.sh
# The toolchain is stable: the repo toolchain has no wasm32 target. The CLI is wasm-bindgen 0.2.129.
# Output: ../web/sol/wasm/sol_wasm.js and sol_wasm_bg.wasm (the page), target/pkg-node (the checks
# tools/smoke.cjs and tools/diff_cases.cjs).
# Order of a full check on a fresh checkout: this script, then `node tools/smoke.cjs
# target/pkg-node` and `node tools/diff_cases.cjs target/pkg-node` (the second writes
# logs/diffcases/cases.json, which tests/wasm_native_diff.rs reads), then `cargo test --release`.
# The panic messages of the wasm hold source paths. The remaps keep the home folder and the
# folder of the checkout out of the file: the sources of this repo show as /zigs/..., and the
# files of the toolchain and of crates.io under the home folder show as /build/...
set -eu
cd "$(dirname "$0")"
export RUSTUP_TOOLCHAIN=stable
export RUSTFLAGS="--remap-path-prefix=$HOME=/build --remap-path-prefix=$(cd .. && pwd)=/zigs"
cargo build --release --target wasm32-unknown-unknown -j 4
WASM=target/wasm32-unknown-unknown/release/p3_check.wasm
wasm-bindgen "$WASM" --target web --out-name sol_wasm --out-dir ../web/sol/wasm
wasm-bindgen "$WASM" --target nodejs --out-name sol_wasm --out-dir target/pkg-node
wc -c ../web/sol/wasm/sol_wasm_bg.wasm
