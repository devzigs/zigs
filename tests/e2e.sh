#!/usr/bin/env bash
# End-to-end tests driving the CLI the way separate participants would.
# Each command is a separate process that only reads public files plus its
# own participants/<id>/ secrets.
set -uo pipefail

export QUIET=1
BIN="${BIN:-./target/release/zec-frost}"
WORK="$(mktemp -d)"
PASS=0
FAIL=0

ok()   { echo "PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
expect_ok()   { local name="$1"; shift; if "$@" >/dev/null 2>"$WORK/err"; then ok "$name"; else bad "$name"; cat "$WORK/err"; fi; }
expect_fail() { local name="$1" pat="$2"; shift 2; if "$@" >/dev/null 2>"$WORK/err"; then bad "$name (unexpectedly succeeded)"; elif grep -qi -- "$pat" "$WORK/err"; then ok "$name"; else bad "$name (wrong error)"; cat "$WORK/err"; fi; }

D="$WORK/w"
z() { "$BIN" --dir "$D" "$@"; }

echo "== Setup: 3-of-5 group via separate CLI calls"
expect_ok "init 3-of-5" z init --names alice,bob,carol,dave,erin --threshold 3
for i in 1 2 3 4 5; do z dkg-round1 --id "$i" >/dev/null || bad "round1 $i"; done
expect_fail "round2 blocks until all round-1 packages exist" "missing" bash -c "rm -f $D/public/dkg/round1/5.json.bak; mv $D/public/dkg/round1/5.json $D/r1-5 && $BIN --dir $D dkg-round2 --id 1; rc=\$?; mv $D/r1-5 $D/public/dkg/round1/5.json; exit \$rc"
for i in 1 2 3 4 5; do z dkg-round2 --id "$i" >/dev/null || bad "round2 $i"; done
for i in 1 2 3 4 5; do z dkg-finish --id "$i" >/dev/null || bad "finish $i"; done
expect_ok "wallet-create" z wallet-create --network testnet
for i in 1 2 3 4 5; do expect_ok "participant $i verifies wallet" z wallet-verify --id "$i"; done

ADDR=$(python3 -c "import json;print(json.load(open('$D/public/wallet.json'))['address'])")
[[ "$ADDR" == utest1* ]] && ok "testnet unified address $ADDR" || bad "address prefix"

# No participant directory may contain the full spend key; only shares.
if grep -rqi '"ask"\|spending_key' "$D/participants" 2>/dev/null; then bad "a full key leaked to disk"; else ok "no full spend key on disk"; fi

echo "== Malicious coordinator swaps ak in the published wallet"
cp "$D/public/wallet.json" "$WORK/wallet.bak"
# Build a second, unrelated group to get another valid ak.
D2="$WORK/other"; "$BIN" --dir "$D2" init --names x,y --threshold 2 >/dev/null
for i in 1 2; do "$BIN" --dir "$D2" dkg-round1 --id $i >/dev/null; done
for i in 1 2; do "$BIN" --dir "$D2" dkg-round2 --id $i >/dev/null; done
for i in 1 2; do "$BIN" --dir "$D2" dkg-finish --id $i >/dev/null; done
"$BIN" --dir "$D2" wallet-create >/dev/null
cp "$D2/public/wallet.json" "$D/public/wallet.json"
expect_fail "participant rejects wallet whose ak is not the group key" "does not match" z wallet-verify --id 1
cp "$WORK/wallet.bak" "$D/public/wallet.json"

echo "== Signing session A: signers 2,4,5 (any 3 of 5)"
expect_ok "build unsigned PCZT" z tx-demo-create --session a --amount 250000 --note-value 2000000
for i in 2 4 5; do expect_ok "commit $i" z sign-commit --session a --id "$i"; done
expect_fail "coordinator cannot sign with only 2 signers" "need at least 3" z sign-package --session a --signers 2,4
expect_ok "package with 2,4,5" z sign-package --session a --signers 2,4,5
expect_fail "unselected participant 1 cannot sign" "not selected" z sign-share --session a --id 1

# Coordinator tampers with the randomizer it hands out.
cp "$D/sessions/a/package.json" "$WORK/pkg.bak"
python3 - "$D/sessions/a/package.json" <<'EOF'
import json,sys
p=sys.argv[1]; k=json.load(open(p))
a=k["spends"][0]["alpha"]; k["spends"][0]["alpha"]=("0" if a[0]!="0" else "1")+a[1:]
json.dump(k,open(p,"w"))
EOF
expect_fail "participant rejects a tampered randomizer" "do not match the PCZT" z sign-share --session a --id 2
cp "$WORK/pkg.bak" "$D/sessions/a/package.json"

# Coordinator lies about the sighash.
python3 - "$D/sessions/a/package.json" <<'EOF'
import json,sys
p=sys.argv[1]; k=json.load(open(p)); k["sighash"]="00"*32; json.dump(k,open(p,"w"))
EOF
expect_fail "participant rejects a wrong sighash" "sighash does not match" z sign-share --session a --id 2
cp "$WORK/pkg.bak" "$D/sessions/a/package.json"

for i in 2 4 5; do expect_ok "share $i" z sign-share --session a --id "$i"; done
expect_fail "nonces are single-use (second share attempt fails)" "reading" z sign-share --session a --id 2

# Signer 4 sends a well-formed but wrong share (here: a copy of signer 5's).
# Aggregation must fail and name participant 4 as the culprit.
cp "$D/sessions/a/shares/4.json" "$WORK/share4.bak"
cp "$D/sessions/a/shares/5.json" "$D/sessions/a/shares/4.json"
expect_fail "bad share is detected and attributed to signer 4" 'culprit: Identifier("0400' z sign-aggregate --session a
cp "$WORK/share4.bak" "$D/sessions/a/shares/4.json"
expect_ok "aggregate with honest shares -> valid transaction" z sign-aggregate --session a
[[ -s "$D/sessions/a/tx.hex" ]] && ok "tx.hex written ($(( $(wc -c <"$D/sessions/a/tx.hex") / 2 )) bytes)" || bad "tx.hex missing"

echo "== Signing session B: a different quorum (1,3,5) on a new tx"
expect_ok "build unsigned legacy-Orchard PCZT b" z tx-demo-create --session b --pool orchard
for i in 1 3 5; do z sign-commit --session b --id "$i" >/dev/null || bad "commit b $i"; done
expect_ok "package b" z sign-package --session b --signers 1,3,5
for i in 1 3 5; do z sign-share --session b --id "$i" >/dev/null || bad "share b $i"; done
expect_ok "aggregate b" z sign-aggregate --session b

echo "== Wallet from group 2 cannot be signed by group 1's shares"
# Point session c's unsigned PCZT (spending group-2 funds) at group 1.
"$BIN" --dir "$D2" tx-demo-create --session c >/dev/null
mkdir -p "$D/sessions/c"; cp "$D2/sessions/c/unsigned.pczt" "$D/sessions/c/"
expect_fail "group 1 refuses to commit to a spend it does not own" "verification failed" z sign-commit --session c --id 1

echo
echo "passed: $PASS  failed: $FAIL"
rm -rf "$WORK"
[[ $FAIL -eq 0 ]]
