"""Mutation check of the new code of wasm-sol (frost, sign, roles, codec, wasm compile, fee key),
of the fee payer rules and template lines of the checker, and of the program design (program,
pay, beta, the PDA roles and the create and execute templates; CHECKER_PIN lists them).

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
TESTS = ["frost_dkg", "sign_split", "roles", "compile_message", "fee_payer", "fee_key", "program",
         "payment", "pay_vectors"]
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
WIRE_TEST = "the_wire_of_the_pins_holds_the_payer_then_the_pda_key"
FEE_RAW_TEST = "the_seed_equals_the_independent_node_derivation_for_every_raw_vector"
FEE_PACKAGE_TEST = "the_fee_key_of_a_key_package_equals_the_independent_node_derivation"
FEE_DAMAGED_TEST = "a_damaged_share_a_share_of_another_seat_or_junk_gives_no_key"

LANDED_DIGEST = "the_digest_and_the_ed25519_data_are_those_that_landed_and_the_signature_verifies"
LANDED_COMMITMENT = "the_commitment_of_the_landed_transact_data_is_the_commitment_of_the_body"
LANDED_PDA = "the_owner_pda_of_the_spike_group_is_the_landed_owner"
LANDED_ADDRESSES = "the_proposal_and_cancellation_addresses_are_the_landed_accounts"
PDA_ROLES = "the_pda_identity_of_a_seed_equals_the_independent_node_and_sdk_derivation"
PAY_SDK = "the_approval_recomputes_the_private_tx_hash_of_the_sdk_and_accepts_the_payment"
PRIVATE = "a_private_tx_hash_that_is_not_the_recompute_is_refused"
ACCOUNT = "a_missing_or_foreign_proposal_account_is_refused"
ACCOUNT_DATA = "an_account_of_another_kind_bump_or_length_is_refused"
BODY = "each_field_of_the_stored_body_must_be_the_body_of_the_payment"
RENT = "a_rent_recipient_that_is_an_address_of_the_program_is_refused"
ONCE = "a_second_body_for_an_approved_commitment_is_refused"
MIGRATION = "a_nonce_payment_to_another_payee_or_with_change_is_refused"
RETIRED = (
    "nothing_signs_a_withdrawal_a_register_or_a_cancel_and_the_group_key_signs_no_program_message"
)
CREATE = "the_create_message_carries_the_body_of_the_payment_and_the_fee_key_signs_it_alone"
CREATE_COMMIT = "a_create_message_for_another_commitment_is_refused"
EXECUTE_OK = "any_seat_executes_a_fresh_proof_with_the_approval_and_pays_with_its_own_fee_key"
EXECUTE_BAD = "an_execute_of_another_payment_body_or_signature_is_refused"
EXECUTE_LATE = "an_execute_after_the_expiry_is_refused"
SHIELD_PDA = "add_sol_deposits_to_the_pda_identity_and_not_to_the_group_key"
SHARE_DIGEST = "a_share_needs_the_proposal_account_and_nonces_of_the_same_digest"
SHARE_GROUP = "a_key_package_of_another_group_gets_no_share_of_the_payment"
KEYS = "the_group_key_signs_no_add_sol_and_a_fee_key_signs_the_create_message_of_its_seat"
ED25519 = "an_ed25519_instruction_outside_an_execute_is_refused"
PDA_WIRE = "the_wire_of_the_pins_holds_the_payer_then_the_pda_key"
COMPILE_PDA = "the_compile_entry_builds_add_sol_and_the_create_message_for_the_pda_identity"
DIGEST_ENTRY = "the_digest_entry_of_the_page_gives_the_landed_digest_and_refuses_a_bad_body"

# The program design (ZOLANA.md 7.2): the client of the approvals program, the approval of a
# payment, the beta policy and the two templates.
PROGRAM_CASES = [
    ("digest-no-genesis", "src/program.rs", "        .chain_update(DEVNET_GENESIS)\n", "",
     LANDED_DIGEST),
    ("digest-no-program", "src/program.rs", "        .chain_update(MULTISIG_DEVNET)\n", "",
     LANDED_DIGEST),
    ("digest-no-proposal", "src/program.rs", "        .chain_update(proposal)\n", "",
     LANDED_DIGEST),
    ("digest-no-domain", "src/program.rs", "        .chain_update(APPROVAL_DOMAIN)\n", "",
     LANDED_DIGEST),
    ("approval-offset", "src/program.rs", "[48, u16::MAX, 16,", "[47, u16::MAX, 16,",
     LANDED_DIGEST),
    ("external-not-be", "src/program.rs", "        *first = 0;", "        *first ^= 0;",
     LANDED_COMMITMENT),
    ("owner-seed", "src/program.rs", "derive(&[SEED_OWNER, group], ", "derive(&[SEED_OWNER], ",
     LANDED_PDA),
    ("proposal-seed", "src/program.rs", "derive(&[SEED_PROPOSAL, group, commitment], ",
     "derive(&[SEED_PROPOSAL, commitment], ", LANDED_ADDRESSES),
    ("pda-label", "src/roles.rs", 'b"zigs-sol/pda-nullifier-secret/v1"',
     'b"zigs-sol/pda-nullifier-secret/v2"', PDA_ROLES),
    ("pda-tag", "src/roles.rs", "const TAG_PDA: u8 = 2;", "const TAG_PDA: u8 = 1;", PDA_ROLES),
    ("pda-wire", "src/pins.rs", "            &self.pda_nullifier_pk[..],\n", "", PDA_WIRE),
    ("private-unchecked", "src/pay.rs", "    if private != tx.private_tx_hash {",
     "    if false {", PRIVATE),
    ("private-dummy-hash", "src/pay.rs", "            if slot.role == Role::Dummy {",
     "            if false {", PAY_SDK),
    ("account-any-owner", "src/pay.rs", "account.filter(|a| a.owner == pins.program)",
     "account.filter(|_| true)", ACCOUNT),
    ("account-any-bump", "src/pay.rs", "    if head != [KIND_PROPOSAL, bump] {",
     "    if head.first() != Some(&KIND_PROPOSAL) {", ACCOUNT_DATA),
    ("body-commitment", "src/pay.rs", "            have.commitment != want.commitment,",
     "            false,", BODY),
    ("body-group", "src/pay.rs", "            have.group != want.group,", "            false,",
     BODY),
    ("body-expiry", "src/pay.rs", "            have.expiry != want.expiry,", "            false,",
     BODY),
    ("body-rent", "src/pay.rs", "            have.rent_recipient != want.rent_recipient,",
     "            false,", BODY),
    ("body-authorities", "src/pay.rs", "            have.authorities != want.authorities,",
     "            false,", BODY),
    ("rent-banned", "src/pay.rs", "    if banned.contains(&pins.payer) {", "    if false {", RENT),
    ("body-once", "src/pay.rs", "approved == commitment && *body_hash != hash",
     "approved == commitment && false", ONCE),
    ("migration-any", "src/beta.rs", "    if payee_bytes == own && !change {", "    if true {",
     MIGRATION),
    ("migration-change", "src/beta.rs", "    if payee_bytes == own && !change {",
     "    if payee_bytes == own {", MIGRATION),
    ("retired-none", "src/beta.rs",
     '        _ => Some(format!("nothing signs the intent {name}")),',
     "        _ => None,", RETIRED),
    ("group-signs-program", "src/beta.rs", "(signer == Signer::Group).then(", "(false).then(",
     CREATE),
    ("execute-unverified", "src/beta.rs",
     "digest.map(|digest| verify_strict(&pins.multisig, &digest, signature))",
     "digest.map(|_| Ok::<(), String>(()))", EXECUTE_BAD),
    ("execute-late", "src/beta.rs", "    if tx.expiry != *expiry || device.now >= *expiry {",
     "    if tx.expiry != *expiry {", EXECUTE_LATE),
    ("propose-any-commitment", "src/beta.rs",
     "        Ok(payment) if payment.commitment == *commitment => Vec::new(),",
     "        Ok(_) => Vec::new(),", CREATE_COMMIT),
    ("identity-group", "src/beta.rs", "    if intent.uses_pda() {", "    if false {", SHIELD_PDA),
    ("create-tag", "src/template.rs", "    let data = [&[MS_CREATE][..], &body].concat();",
     "    let data = [&[1u8][..], &body].concat();", CREATE),
    ("execute-pda-signs", "src/template.rs", "    accounts.push(acct(pins.group, false, false));",
     "    accounts.push(acct(pins.group, true, false));", EXECUTE_OK),
    ("execute-rent-payer", "src/template.rs", "        acct(*rent_recipient, false, true),",
     "        acct(pins.payer, false, true),", EXECUTE_OK),
    ("execute-approval-last", "src/template.rs",
     "        ix(ED25519_PROGRAM, Vec::new(), Data::Exact(approval)),\n"
     "        ix(pins.program, accounts, Data::Execute),",
     "        ix(pins.program, accounts, Data::Execute),\n"
     "        ix(ED25519_PROGRAM, Vec::new(), Data::Exact(approval)),", EXECUTE_OK),
    ("ed25519-anywhere", "src/rules_ix.rs",
     "        if *program == ED25519_PROGRAM\n"
     "            && matches!(self.intent, Intent::Program(Program::Execute { .. }))\n"
     "        {",
     "        if *program == ED25519_PROGRAM {", ED25519),
    ("share-any-digest", "src/sign.rs", "    if round.digest != payment.digest {", "    if false {",
     SHARE_DIGEST),
    ("share-any-group", "src/sign.rs",
     "    if key_bytes(round.key_package.verifying_key())? != pins.multisig {", "    if false {",
     SHARE_GROUP),
    ("group-share-fee-policy", "src/sign.rs",
     "    let pins = approved(message, check, round.now, Signer::Group)?;",
     "    let pins = approved(message, check, round.now, Signer::Fee)?;", KEYS),
    ("fee-group-policy", "src/fee.rs",
     "    let pins = approved(message, check, now, beta::Signer::Fee)?;",
     "    let pins = approved(message, check, now, beta::Signer::Group)?;", KEYS),
    ("compile-group-pins", "src/wasm.rs",
     "    let pins = identity(&proposal.intent, &Pins::decode(pins)?).map_err(|r| refused(&r))?;",
     "    let pins = Pins::decode(pins)?;\n    let _ = identity;", COMPILE_PDA),
    ("digest-any-body", "src/wasm.rs", "    Body::parse(&body)?;\n", "", DIGEST_ENTRY),
]

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
    ("group-unchecked", "src/sign.rs", "    if group != pins.multisig {", "    if false {",
     "a_key_package_that_is_not_the_pinned_group_gets_no_share"),
    ("approve-ignored", "src/sign.rs",
     "approve_message(message, &proposal, &device, signer).map_err(|r| refused(&r))?;",
     "let _ = approve_message(message, &proposal, &device, signer);", P3_VECTORS),
    ("nonces-no-digest", "src/sign.rs", "    let mut saved = digest.to_vec();",
     "    let mut saved = Vec::new();", CHANGED_BYTE),
    ("label-nullifier", "src/roles.rs", 'b"zigs-sol/nullifier-secret/v1"',
     'b"zigs-sol/nullifier-secret/v2"', ROLES_TEST),
    ("label-viewing", "src/roles.rs", 'b"zigs-sol/viewing-scalar/v1"',
     'b"zigs-sol/viewing-scalar/v2"', ROLES_TEST),
    ("address-tag", "src/roles.rs", "        *first = tag;", "        *first = 2;",
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
    ("payer-may-be-group", "src/check.rs",
     "        if self.pins.payer == self.pins.group || self.pins.payer == self.pins.multisig {",
     "        if false {", GROUP_PAYS_TEST),
    ("signer-count-unchecked", "src/check.rs", "        if signers != want {", "        if false {",
     THIRD_SIGNER_TEST),
    ("shield-two-signers", "src/template.rs",
     "        Intent::Shield { .. } | Intent::Program(_) => 1,",
     "        Intent::Program(_) => 1,", SIGNERS_TEST),
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
    ("compile-with-group-payer", "src/template.rs",
     "    if pins.payer == pins.group || pins.payer == pins.multisig {",
     "    if false {", COMPILE_GROUP_TEST),
    ("dummy-group-not-participant", "src/spend.rs",
     "std::iter::once(self.group.key).chain(owners).collect()", "owners.collect()", DUMMY_TEST),
    ("fee-key-any-payer", "src/fee.rs", "    if pins.payer != public_bytes(&key) {",
     "    if false {", FEE_NOT_PAYER_TEST),
    ("fee-key-no-approve", "src/fee.rs",
     "    let pins = approved(message, check, now, beta::Signer::Fee)?;",
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
] + PROGRAM_CASES


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
