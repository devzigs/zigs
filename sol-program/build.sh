#!/bin/sh
# Builds the Zigs approvals program (ZOLANA.md 7.2) for SBF and checks the SHA-256 of the ELF.
#   sh sol-program/build.sh       builds target/deploy/zigs_min_multisig.so and checks its hash
#   sh sol-program/build.sh test  then runs the unit tests and the LiteSVM tests (svm-tests/), with
#                                 a stub pool and with the pool of the pinned Zolana commit
#   sh sol-program/build.sh v2    then rebuilds Devnet version 2 and compares the code of the two
#
# Toolchain: cargo-build-sbf of Agave v4.3.0 (solana-release-aarch64-apple-darwin.tar.bz2 of the
# GitHub release, SHA-256 0bfbd769a55e32f0a1fe1b92f76f360f01ee19475facf8c31cb90f99dcca7fe0)
# with platform-tools v1.54. Put it on PATH or set CARGO_BUILD_SBF. cargo-build-sbf removes the
# working folder from the source paths, so the ELF holds no home path; this script checks that.
#
# EXPECTED is version 5: version 2 with the fixes of the review, SOL withdrawals, its own
# transact CPI and the cluster as a build choice (ZOLANA.md 7.2). It is not deployed. Version 2 on
# Devnet (program 5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL) was built as a member of the
# Zolana workspace, with the default features of zolana-interface turned off in that workspace.
# Built on its own, the version 2 source gives another ELF:
# - zolana-program turns on the default features of zolana-interface again, which add the unused
#   Groth16 verifying keys as exported data (no code);
# - two panic paths are shorter (src/cpi.rs, src/instructions.rs);
# - the functions sit in another order.
# The v2 mode rebuilds version 2 from the import commit of src/ in that workspace layout, checks
# its hash, and lists the functions whose code differs from this build (on the import commit:
# none; since version 3: the functions that the fixes changed).
set -eu
cd "$(dirname "$0")"
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

EXPECTED=28509c6799e6a229c3378a09530088f80afbceb8f73c1c8ab776615f6a71fd16
V2=555f45801f32896c78eb55f962026507dec35ea6d673477326db7913e4475d92
SBF=${CARGO_BUILD_SBF:-cargo-build-sbf}
OBJDUMP=$HOME/.cache/solana/v1.54/platform-tools/llvm/bin/llvm-objdump
SO=target/deploy/zigs_min_multisig.so

fail() {
  echo "build.sh: $*" >&2
  exit 1
}

sha() {
  shasum -a 256 "$1" | cut -d' ' -f1
}

case "$("$SBF" --version 2>/dev/null | head -1)" in
  "cargo-build-sbf 4.3.0") ;;
  *) fail "needs cargo-build-sbf 4.3.0 (Agave v4.3.0); put it on PATH or set CARGO_BUILD_SBF" ;;
esac

"$SBF" --tools-version v1.54 --jobs 4 -- --locked --features devnet
if LC_ALL=C grep -q -F "$HOME" "$SO"; then
  fail "$SO holds a home path"
fi
echo "$(sha "$SO")  $SO ($(wc -c < "$SO" | tr -d ' ') bytes)"
[ "$(sha "$SO")" = "$EXPECTED" ] || fail "hash differs from EXPECTED (change it only with src/)"

# Sets ZOLANA to the pinned Zolana tree of cargo's git checkout, unchanged.
find_zolana() {
  ZOLANA=$(cargo metadata --format-version 1 --locked | python3 -I -c '
import json, os, sys
for p in json.load(sys.stdin)["packages"]:
    if p["name"] == "zolana-interface":
        print(os.path.dirname(os.path.dirname(os.path.dirname(p["manifest_path"]))))')
  [ "$(git -C "$ZOLANA" rev-parse HEAD)" = 89640630b3ed2402b83bd20c313406cb3fe906d4 ] \
    || fail "$ZOLANA is not at the pinned commit"
  [ -z "$(git -C "$ZOLANA" status --porcelain --untracked-files=no)" ] \
    || fail "$ZOLANA has local changes"
}

# Builds the shielded pool of the pinned commit for svm-tests/tests/real_pool.rs, in a copy
# without rust-toolchain.toml (it pins a host toolchain), kept under svm-tests/target so that the
# next build is incremental.
build_real_pool() {
  find_zolana
  POOL=svm-tests/target/zolana-pool
  mkdir -p "$POOL"
  rsync -a --delete --exclude .git --exclude .cargo-ok --exclude target \
    --exclude rust-toolchain.toml "$ZOLANA"/ "$POOL"/
  "$SBF" --tools-version v1.54 --jobs 4 --manifest-path "$POOL/programs/shielded-pool/Cargo.toml" \
    -- --features bpf-entrypoint --locked
  cp "$POOL/target/deploy/shielded_pool_program.so" svm-tests/target/deploy/
}

# SOL-42: a build names one cluster, and a mainnet build cannot carry the Devnet genesis hash or
# the development pool id. Each refused build must fail with its own message.
check_clusters() {
  DEV_POOL=sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6
  must_fail "choose the cluster" cargo check --locked -j 4
  must_fail "choose one cluster" cargo check --locked -j 4 --features devnet,mainnet
  must_fail "ZIGS_MAINNET_POOL_ID" env -u ZIGS_MAINNET_POOL_ID \
    cargo check --locked -j 4 --features mainnet
  must_fail "development pool id" env ZIGS_MAINNET_POOL_ID=$DEV_POOL \
    cargo check --locked -j 4 --features mainnet
  env ZIGS_MAINNET_POOL_ID=11111111111111111111111111111112 \
    cargo check --locked -j 4 --features mainnet > /dev/null 2>&1 \
    || fail "a mainnet build with another pool id must pass"
}

# must_fail TEXT COMMAND...: the command fails, and its output names TEXT.
must_fail() {
  TEXT=$1
  shift
  if OUT=$("$@" 2>&1); then
    fail "this build must fail: $*"
  fi
  echo "$OUT" | grep -q -F "$TEXT" || fail "this build failed without \"$TEXT\": $*"
}

case "${1:-}" in
  "") exit 0 ;;
  test)
    cargo test --locked -j 4 --features devnet -- --test-threads 2
    check_clusters
    "$SBF" --tools-version v1.54 --jobs 4 --manifest-path svm-tests/stub-pool/Cargo.toml -- --locked
    build_real_pool
    cargo test --manifest-path svm-tests/Cargo.toml --locked -j 4 -- --test-threads 2
    exit 0
    ;;
  v2) ;;
  *) fail "unknown mode $1" ;;
esac

find_zolana

# The source of version 2 is the commit that added src/lib.rs.
IMPORT=$(git log --diff-filter=A --format=%H -- src/lib.rs | tail -1)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
rsync -a --exclude .git --exclude .cargo-ok --exclude target "$ZOLANA"/ "$WORK"/
mkdir -p "$WORK/sol35-multisig/src"
for f in approval error instructions lib state; do
  git show "$IMPORT:./src/$f.rs" > "$WORK/sol35-multisig/src/$f.rs"
done
(cd "$WORK/sol35-multisig" && shasum -a 256 -c) <<'EOF'
77addac38903d40b653183df14d10895cd1e593235b1182c8636d76083b737a8  src/approval.rs
e264bda923d99b081e6ed88e8ecda93ff06727cef1d88af662847d39f43d0174  src/error.rs
98c3b4ed5b797f717420b3ec01d76a10cd7c0b8af0a9ffd60fd281c831926d20  src/instructions.rs
2600e58bea25a790250214c4f4ba1f80372e7419a6fea06227a67ff37e4fa156  src/lib.rs
ce9bd496fbf25408c96160a13fd97da093888aeb0597de85c457f221c553f16f  src/state.rs
EOF
cat > "$WORK/sol35-multisig/Cargo.toml" <<'EOF'
[package]
name = "zigs-min-multisig"
version = "0.1.0"
edition.workspace = true
license = "Apache-2.0"
publish = false

[lib]
name = "zigs_min_multisig"
crate-type = ["cdylib", "lib"]

[features]
default = ["bpf-entrypoint"]
bpf-entrypoint = []
no-entrypoint = []

[dependencies]
pinocchio = { workspace = true, features = ["cpi"] }
pinocchio-system = { workspace = true }
zolana-hasher = { workspace = true }
zolana-interface = { workspace = true }
zolana-program = { workspace = true, features = ["cpi"] }

[dev-dependencies]
sha2 = { workspace = true }

[lints.rust.unexpected_cfgs]
level = "allow"
check-cfg = ['cfg(target_os, values("solana"))']
EOF
# The three workspace changes of the version 2 build: the member, no default features of
# zolana-interface, and the release profile.
IFACE='zolana-interface = { path = "program-libs/interface", version = "0.1.0"' perl -pi \
  -e 's/^    "xtask",\n/    "xtask",\n    "sol35-multisig",\n/;' \
  -e 's/^\Q$ENV{IFACE}\E \}$/$ENV{IFACE}, default-features = false }/;' \
  "$WORK/Cargo.toml"
printf 'lto = "fat"\ncodegen-units = 1\nopt-level = 2\n' >> "$WORK/Cargo.toml"

"$SBF" --tools-version v1.54 --jobs 4 --manifest-path "$WORK/sol35-multisig/Cargo.toml" \
  -- --features bpf-entrypoint
echo "$(sha "$WORK/$SO")  version 2 rebuilt"
[ "$(sha "$WORK/$SO")" = "$V2" ] || fail "the version 2 rebuild differs from Devnet"
UNSTRIPPED=target/sbpf-solana-solana/release/zigs_min_multisig.so
python3 -I fncmp.py "$OBJDUMP" "$WORK/$UNSTRIPPED" "$UNSTRIPPED" \
  || echo "build.sh: the functions above differ from version 2"
