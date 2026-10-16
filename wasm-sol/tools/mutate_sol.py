"""Mutation check of the new code of wasm-sol (frost, sign, roles, codec, wasm compile, fee key)
and of the fee payer rules and template lines of the checker (CHECKER_PIN lists them as modified).

Run from the crate directory: python3 -I tools/mutate_sol.py [--check] [name ...]
Each case is an exact string replacement that breaks one line of the new code. The script saves
the file, replaces the text once, runs the tests of the new code, restores the file, compares the
SHA-256 before and after, and requires that the named test fails. --check only tests the anchors.
The copied checker (CHECKER_PIN) has its own mutation run in the P3 crate. One heavy command
runs at a time (lockf on heavy.lock, two folders above the clone). The tests run with the debug
profile in target-mut, so the release build of the page stays as it is.
"""

import hashlib
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "heavy.lock")
TARGET = os.path.join(ROOT, "target-mut")
ENV = dict(os.environ, RUSTUP_TOOLCHAIN="stable", CARGO_TARGET_DIR=TARGET)
TESTS = ["frost_dkg", "sign_split", "roles", "compile_message", "fee_payer", "fee_key"]
TEST = ["lockf", "-k", LOCK, "cargo", "test", "-j", "4", "--no-fail-fast"]
TEST += [arg for name in TESTS for arg in ("--test", name)] + ["--", "--test-threads", "2"]

COMMIT_TEST = "the_commitment_is_blake2b_with_the_personalization_over_the_named_fields"
ECHO_TEST = "the_echo_is_blake2b_over_the_wallet_the_safety_number_the_cluster_and_each_package"
SEED_TEST = "sol_seed_is_blake2b_over_the_wallet_the_echo_and_the_parts_in_seat_order"
LIMITS_TEST = "n_t_and_the_seat_number_have_limits"
ROLES_TEST = "the_role_secrets_of_a_seed_equal_the_independent_javascript_derivation"
CHANGED_BYTE = "sign_share_refuses_a_message_with_one_changed_byte_at_every_position"
OWN_ECHO_TEST = "a_seat_whose_saved_echo_differs_from_the_documents_ends"
PEER_ECHO_TEST = "a_peer_that_signed_another_echo_ends_the_seat_and_is_named"
PEER_ROSTER_TEST = "the_peer_echoes_must_be_those_of_the_other_seats"
TWICE_TEST = "a_key_written_twice_is_refused_at_every_depth"
TWICE_SIGN_TEST = "a_key_written_twice_in_a_signing_input_is_refused"
SHARE_DAMAGED_TEST = "a_damaged_or_foreign_key_share_does_not_fit"
STRICT_TEST = "verify_strict_refuses_a_weak_key_that_plain_verify_accepts"
LABEL_TEST = "the_program_label_names_the_cluster_the_pool_and_the_registry"
HONEST_TEST = "a_2_of_3_dkg_gives_every_seat_one_group_key_and_one_sol_seed"
P3_VECTORS = (
    "every_message_that_the_p3_vectors_refuse_gets_no_share_and_the_rest_reach_the_group_check"
)

PAYER_TEST = "a_message_paid_by_another_key_than_the_payer_of_the_proposal_is_refused"
GROUP_PAYS_TEST = "a_proposal_that_names_the_group_key_as_its_payer_is_refused"
THIRD_SIGNER_TEST = "a_third_signer_is_refused_with_the_signer_set_rule"
SIGNERS_TEST = "two_keys_sign_every_intent_but_shield_and_the_payer_signs_first"
SEED_FUNDER_TEST = "a_create_account_with_seed_funded_by_the_group_key_is_refused"
CREATE_ACCOUNT_TEST = "a_create_account_from_the_group_key_is_refused"
TRANSACT_LAYOUT_TEST = (
    "transact_lists_the_payer_first_and_the_owner_signer_after_the_nullifier_accounts"
)
WITHDRAWAL_LAYOUT_TEST = "a_withdrawal_lists_the_owner_signer_before_the_settlement_accounts"
NONCE_LAYOUT_TEST = (
    "the_nonce_account_is_funded_by_the_payer_and_the_group_signs_as_its_base"
)
REGISTER_LAYOUT_TEST = "register_lists_the_owner_then_the_payer"
COMPILE_GROUP_TEST = "the_compiler_refuses_the_group_key_as_payer"
DUMMY_TEST = (
    "a_dummy_may_name_the_group_key_that_signs_as_owner_when_no_real_output_pays_it"
)
FEE_NOT_PAYER_TEST = "a_fee_key_that_is_not_the_payer_of_the_proposal_signs_nothing"
FEE_REFUSED_TEST = "the_fee_key_signs_nothing_that_approve_refuses"
WIRE_TEST = "the_wire_of_the_pins_holds_the_payer_last"
FEE_RAW_TEST = "the_seed_equals_the_independent_node_derivation_for_every_raw_vector"
FEE_PACKAGE_TEST = "the_fee_key_of_a_key_package_equals_the_independent_node_derivation"
FEE_DAMAGED_TEST = "a_damaged_share_a_share_of_another_seat_or_junk_gives_no_key"

# (name, file, exact old text, new text, test that must fail)
CASES = [
    ("cluster-any", "src/frost.rs", "    if cluster == CLUSTER {", "    if true {",
     "the_commitment_refuses_bad_input"),
    ("limit-n", "src/frost.rs", "    if !(2..=MAX_SEATS).contains(&n) {", "    if false {",
     LIMITS_TEST),
    ("limit-t", "src/frost.rs", "    if t < 2 || t > n {", "    if false {", LIMITS_TEST),
    ("limit-id", "src/frost.rs", "    if id < 1 || id > n {", "    if false {", LIMITS_TEST),
    ("commit-no-seat", "src/frost.rs",
     "    data.extend_from_slice(&seat.to_le_bytes());\n    data.extend_from_slice(box_pk);",
     "    data.extend_from_slice(box_pk);", COMMIT_TEST),
    ("commit-no-cluster", "src/frost.rs",
     "    push_len_prefixed(&mut data, cluster.as_bytes())?;\n", "", COMMIT_TEST),
    ("echo-no-seat", "src/frost.rs",
     "        data.extend_from_slice(&seat.to_le_bytes());\n"
     "        push_len_prefixed(&mut data, &canonical)?;",
     "        push_len_prefixed(&mut data, &canonical)?;", ECHO_TEST),
    ("echo-no-length", "src/frost.rs", "        push_len_prefixed(&mut data, &canonical)?;",
     "        data.extend_from_slice(&canonical);", ECHO_TEST),
    ("seed-no-echo", "src/frost.rs", "        data.extend_from_slice(echo);\n", "",
     SEED_TEST),
    ("commitment-unchecked", "src/frost.rs", "            if want != doc.commit {",
     "            if false {", "one_changed_r_sol_names_the_seat"),
    ("commitments-after-nothing", "src/frost.rs", "    ceremony.check_commitments(&docs)?;\n", "",
     "one_changed_commitment_names_the_seat"),
    ("roster-unchecked", "src/frost.rs",
     "        if self.parts.keys().copied().collect::<Vec<_>>() != seats {",
     "        if false {", "a_round_3_context_for_other_seats_than_round_1_is_refused"),
    ("digest-any-cluster", "src/sign.rs",
     "    check_cluster(cluster)?;\n    Ok(blake2b_256(DIGEST_PERSONAL",
     "    Ok(blake2b_256(DIGEST_PERSONAL",
     "the_digest_is_blake2b_with_the_personalization_over_the_cluster_and_the_bytes"),
    ("digest-order", "src/sign.rs",
     "Ok(blake2b_256(DIGEST_PERSONAL, &[cluster.as_bytes(), message]))",
     "Ok(blake2b_256(DIGEST_PERSONAL, &[message, cluster.as_bytes()]))",
     "the_digest_is_blake2b_with_the_personalization_over_the_cluster_and_the_bytes"),
    ("nonce-digest-unchecked", "src/sign.rs", "    if round.digest != digest {", "    if false {",
     "the_nonces_of_one_digest_do_not_sign_another_message_that_passes_approve"),
    ("group-unchecked", "src/sign.rs", "    if group != pins.group {", "    if false {",
     "a_key_package_that_is_not_the_pinned_group_gets_no_share"),
    ("approve-ignored", "src/sign.rs",
     "approve(message, &proposal.intent, &proposal.plan, &device).map_err(|r| refused(&r))?;",
     "let _ = approve(message, &proposal.intent, &proposal.plan, &device);", P3_VECTORS),
    ("nonces-no-digest", "src/sign.rs", "    let mut saved = digest.to_vec();",
     "    let mut saved = Vec::new();", CHANGED_BYTE),
    ("label-nullifier", "src/roles.rs", 'b"zigs-sol/nullifier-secret/v1"',
     'b"zigs-sol/nullifier-secret/v2"', ROLES_TEST),
    ("label-viewing", "src/roles.rs", 'b"zigs-sol/viewing-scalar/v1"',
     'b"zigs-sol/viewing-scalar/v2"', ROLES_TEST),
    ("address-tag", "src/roles.rs", "        *tag = 1;", "        *tag = 2;",
     "the_owner_hash_and_the_address_layout_equal_the_values_of_the_p5_and_p6_runs"),
    ("seal-label", "src/roles.rs", 'b"Zigs_SolSnap__v1"', 'b"Zigs_SolSnap__v2"',
     "the_snapshot_seal_key_is_blake2b_of_the_seed_as_a_32_byte_base64url_secret"),
    ("hex-odd", "src/codec.rs", "    if !text.len().is_multiple_of(2) || !text.is_ascii() {",
     "    if !text.is_ascii() {",
     "hex_reads_both_cases_and_refuses_odd_length_and_bad_digits_without_a_panic"),
    ("base64-alphabet", "src/codec.rs", '0123456789-_";', '0123456789+/";',
     "base64url_equals_the_rfc_4648_vectors_without_padding_and_uses_the_url_alphabet"),
    ("seat-twice", "src/codec.rs",
     '        if seats.insert(seat, item).is_some() {\n'
     '            return Err(format!("seat {key} twice in {what}"));\n        }',
     "        seats.insert(seat, item);",
     "a_seat_written_twice_under_two_spellings_is_refused"),
    ("echo-own-unchecked", "src/frost.rs", "        if echo != self.echo {", "        if false {",
     OWN_ECHO_TEST),
    ("echo-peer-unchecked", "src/frost.rs", "find(|(_, theirs)| **theirs != echo)",
     "find(|(_, theirs)| false && **theirs != echo)", PEER_ECHO_TEST),
    ("echo-no-safety", "src/frost.rs", "    for text in [wallet_id, safety, cluster] {",
     "    for text in [wallet_id, cluster] {", ECHO_TEST),
    ("peer-roster-unchecked", "src/frost.rs",
     "        if self.peer_echoes.keys().copied().collect::<Vec<_>>() != others {",
     "        if false {", PEER_ROSTER_TEST),
    ("part3-others-include-me", "src/frost.rs", ".filter(|(seat, _)| *seat != ceremony.seat)",
     ".filter(|_| true)", HONEST_TEST),
    ("share-fits-always", "src/frost.rs",
     "        .is_ok_and(|kp| VerifyingShare::from(*kp.signing_share()) == *kp.verifying_share())",
     "        .is_ok()", SHARE_DAMAGED_TEST),
    ("label-pool", "src/frost.rs", "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6:",
     "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB7:", LABEL_TEST),
    ("label-registry", "src/frost.rs", "regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD",
     "regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PE", LABEL_TEST),
    ("verify-not-strict", "src/sign.rs",
     "key.verify_strict(message, &Signature::from_bytes(signature))",
     "ed25519_dalek::Verifier::verify(&key, message, &Signature::from_bytes(signature))",
     STRICT_TEST),
    ("key-twice-accepted", "src/codec.rs", "            if object.contains_key(&key) {",
     "            if false {", TWICE_TEST),
    ("from-json-plain", "src/codec.rs",
     "serde_json::from_value(parse_strict(text, what)?)", "serde_json::from_str(text)",
     TWICE_SIGN_TEST),
    ("seat-map-plain", "src/codec.rs",
     "    let Value::Object(object) = parse_strict(json, what)? else {",
     "    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(json) else {", TWICE_TEST),
    # The fee payer: the payer of the proposal pays, the group key signs as a readonly owner.
    ("payer-not-first", "src/check.rs", "if self.msg.keys.first() != Some(&self.pins.payer) {",
     "if false {", PAYER_TEST),
    ("payer-may-be-group", "src/check.rs", "        if self.pins.payer == self.pins.group {",
     "        if false {", GROUP_PAYS_TEST),
    ("signer-count-unchecked", "src/check.rs", "        if signers != want {", "        if false {",
     THIRD_SIGNER_TEST),
    ("shield-two-signers", "src/template.rs", "        Intent::Shield { .. } => 1,",
     "        Intent::Shield { .. } => 2,", SIGNERS_TEST),
    ("group-debit-unchecked", "src/rules_ix.rs",
     "            && self.msg.account_key(ix, 0) == Some(&self.pins.group)", "            && false",
     SEED_FUNDER_TEST),
    ("create-account-not-funding", "src/rules_ix.rs",
     "    SYS_CREATE_ACCOUNT,\n    SYS_TRANSFER,\n", "    SYS_TRANSFER,\n    SYS_TRANSFER,\n",
     CREATE_ACCOUNT_TEST),
    ("owner-signer-writable", "src/template.rs",
     "    accounts.push(acct(pins.group, true, false));",
     "    accounts.push(acct(pins.group, true, true));", TRANSACT_LAYOUT_TEST),
    ("owner-signer-missing", "src/template.rs",
     "    accounts.push(acct(pins.group, true, false));", "    let _ = &mut accounts;",
     WITHDRAWAL_LAYOUT_TEST),
    ("nonce-funded-by-group", "src/template.rs",
     "(pins.payer, true, true),\n                acct(pins.nonce_account, false",
     "(pins.group, true, true),\n                acct(pins.nonce_account, false",
     NONCE_LAYOUT_TEST),
    ("register-payer-is-group", "src/template.rs",
     "        acct(pins.group, true, false),\n        acct(pins.payer, true, true),",
     "        acct(pins.group, true, false),\n        acct(pins.group, true, true),",
     REGISTER_LAYOUT_TEST),
    ("compile-with-group-payer", "src/template.rs", "    if pins.payer == pins.group {",
     "    if false {", COMPILE_GROUP_TEST),
    ("dummy-group-not-participant", "src/spend.rs",
     "std::iter::once(self.group.key).chain(owners).collect()", "owners.collect()", DUMMY_TEST),
    ("fee-key-any-payer", "src/fee.rs", "    if pins.payer != public_bytes(&key) {",
     "    if false {", FEE_NOT_PAYER_TEST),
    ("fee-key-no-approve", "src/fee.rs",
     "    let pins = approved(message, check, now.ok_or(\"the fee round has no clock\")?)?;",
     "    let pins = crate::pins::Pins::decode(check.pins)?;", FEE_REFUSED_TEST),
    # The fee key is derived from the signing share, the group key and the seat (src/fee.rs).
    ("fee-label", "src/fee.rs", 'b"zigs-sol/fee-key/v1"', 'b"zigs-sol/fee-key/v2"', FEE_RAW_TEST),
    ("fee-no-group", "src/fee.rs", "    info.extend_from_slice(group);\n", "", FEE_RAW_TEST),
    ("fee-no-seat", "src/fee.rs", "    info.extend_from_slice(&seat.to_le_bytes());\n", "",
     FEE_RAW_TEST),
    ("fee-salt", "src/fee.rs", "Hkdf::<Sha256>::new(None, share)",
     'Hkdf::<Sha256>::new(Some(b"salt"), share)', FEE_RAW_TEST),
    ("fee-seat-fixed", "src/fee.rs", "        seat_of(package.identifier())?,", "        1,",
     FEE_PACKAGE_TEST),
    ("fee-public-share", "src/fee.rs",
     "        .signing_share()\n        .serialize()\n        .try_into()",
     "        .verifying_share()\n        .serialize()\n        .unwrap_or_default()\n"
     "        .try_into()", FEE_PACKAGE_TEST),
    ("fee-share-unchecked", "src/fee.rs", "    if !share_fits(key_package) {", "    if false {",
     FEE_DAMAGED_TEST),
    ("pins-wire-no-payer", "src/pins.rs", "            &self.payer[..],\n", "", WIRE_TEST),
    ("empty-transact", "src/wasm.rs", "        [] => None,",
     '        [] => Some(transact::parse(&[]).map_err(|why| format!("{why:?}"))?),',
     "a_cancel_a_register_and_a_shield_compile_without_transact_data"),
]


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def run_tests():
    done = subprocess.run(TEST, cwd=ROOT, env=ENV, capture_output=True, text=True, check=False)
    text = done.stdout + done.stderr
    failed = sorted(set(re.findall(r"^test (\S+) \.\.\. FAILED$", text, re.M)))
    return bool(re.search(r"^test result:", text, re.M)), failed, done.returncode, text


def mutate(case):
    name, rel, old, new, must_fail = case
    path = os.path.join(ROOT, rel)
    with open(path, encoding="utf-8") as handle:
        original = handle.read()
    if original.count(old) != 1:
        return {"name": name, "error": f"old text found {original.count(old)} times in {rel}"}
    before = sha(path)
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(original.replace(old, new, 1))
        built, failed, _, text = run_tests()
    finally:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(original)
    result = {"name": name, "test": must_fail, "built": built, "failed": failed,
              "killed": must_fail in failed, "sha_restored": before == sha(path)}
    if not built:
        result["build_output"] = text[-1500:]
    return result


def check_anchors():
    bad = 0
    for name, rel, old, _, _ in CASES:
        with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
            count = handle.read().count(old)
        if count != 1:
            bad += 1
            print(f"{name}: old text found {count} times in {rel}")
    print(f"{len(CASES)} cases, {bad} with a bad anchor")
    sys.exit(1 if bad else 0)


def selected(args):
    only = {a for a in args if not a.startswith("--")}
    return [case for case in CASES if not only or case[0] in only]


def show(result):
    mark = "KILLED" if result.get("killed") else "SURVIVED"
    print(f"{mark:8} {result['name']:26} test {result.get('test')} "
          f"failed={len(result.get('failed', []))} restored={result.get('sha_restored')} "
          f"{result.get('error', '')}", flush=True)
    if result.get("build_output"):
        print(result["build_output"], flush=True)


def passed(results, built, failed):
    return all(r.get("killed") and r.get("sha_restored") for r in results) and built and not failed


def main():
    args = sys.argv[1:]
    if "--check" in args:
        check_anchors()
    results = []
    for case in selected(args):
        results.append(mutate(case))
        show(results[-1])
    built, failed, code, _ = run_tests()
    print(f"final full run: built={built} failed={failed} exit={code}")
    sys.exit(0 if passed(results, built, failed) else 1)


main()
