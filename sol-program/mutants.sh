#!/bin/sh
# Mutation check of the program's rules (ZOLANA.md 7.2). Each mutant removes or weakens one rule
# in a copy of src/; the LiteSVM tests must then fail. Run after `sh sol-program/build.sh test`:
#   sh sol-program/mutants.sh            all mutants
#   sh sol-program/mutants.sh A4 C1      only these
# It builds each mutant with cargo-build-sbf (CARGO_BUILD_SBF as in build.sh), one at a time,
# and runs svm-tests with ZIGS_PROGRAM_DIR on the copy. A mutant that survives is a rule with no
# test; the script then ends with an error.
set -eu
cd "$(dirname "$0")"
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS
SBF=${CARGO_BUILD_SBF:-cargo-build-sbf}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
rsync -a --exclude target --exclude svm-tests ./ "$WORK/"
SURVIVED=""
MATCHED=""
ONLY=" $* "

fail() {
  echo "mutants.sh: $*" >&2
  exit 1
}

# Builds the copy in $WORK and runs svm-tests on it; returns the exit code of the tests.
build_and_test() {
  if ! "$SBF" --tools-version v1.54 --jobs 4 --manifest-path "$WORK/Cargo.toml" -- --locked \
    > "$WORK/build.log" 2>&1; then
    cat "$WORK/build.log" >&2
    fail "$1 does not build"
  fi
  ZIGS_PROGRAM_DIR="$WORK" cargo test --manifest-path svm-tests/Cargo.toml --locked -j 4 \
    --no-fail-fast -- --test-threads 2 > "$WORK/test.log" 2>&1
}

# mutant ID FILE RULE OLD NEW: replaces OLD, which must occur once in src/FILE, by NEW. A kill
# counts only when named tests fail, so a test run that cannot start is an error.
mutant() {
  case "$ONLY" in "  " | *" $1 "*) ;; *) return 0 ;; esac
  MATCHED="$MATCHED $1"
  rsync -a --delete src/ "$WORK/src/"
  OLD=$4 NEW=$5 perl -0pi -e \
    '$n = s/\Q$ENV{OLD}\E/$ENV{NEW}/g; die "no single match\n" unless $n == 1' "$WORK/src/$2" \
    || fail "$1: the old text does not occur exactly once in src/$2"
  if build_and_test "$1"; then
    echo "$1 SURVIVED  $3"
    SURVIVED="$SURVIVED $1"
    return 0
  fi
  KILLERS=$(grep -E '^test .* FAILED$' "$WORK/test.log" | cut -d' ' -f2 | tr '\n' ' ')
  if [ -z "$KILLERS" ]; then
    tail -20 "$WORK/test.log" >&2
    fail "$1: no test failed by name, so the test run itself failed"
  fi
  echo "$1 killed    $3 by: $KILLERS"
}

# The unchanged source must pass, or every mutant would count as killed.
rsync -a --delete src/ "$WORK/src/"
build_and_test baseline || fail "the tests fail on the unchanged source"

mutant A1 approval.rs "the approval is an Ed25519 precompile instruction" \
  'approval.get_program_id() != &ED25519_PROGRAM_ID || approval.num_account_metas() != 0' \
  'approval.num_account_metas() != 0'
mutant A2 approval.rs "the approval instruction has no accounts" \
  'approval.get_program_id() != &ED25519_PROGRAM_ID || approval.num_account_metas() != 0' \
  'approval.get_program_id() != &ED25519_PROGRAM_ID'
mutant A3 approval.rs "the approval is the instruction just before execute" \
  '.get_instruction_relative(-1)' '.get_instruction_relative(-2)'
mutant A4 approval.rs "one signature, all data in the approval instruction (pinned head)" \
  '
        && data[..DATA_START] == CANONICAL_HEAD' ''
mutant A5 approval.rs "the approval is by the group key" \
  '
        && data[PUBKEY_OFFSET..SIGNATURE_OFFSET] == multisig_pubkey[..]' ''
mutant A6 approval.rs "the approval signs this digest" \
  '
        && data[MESSAGE_OFFSET..] == digest[..]' ''
mutant A7 approval.rs "the digest binds the cluster" \
  '&[APPROVAL_DOMAIN, &DEPLOYMENT_ID, program_id, proposal, body]' \
  '&[APPROVAL_DOMAIN, program_id, proposal, body]'
mutant A8 approval.rs "the digest binds the proposal address" \
  '&[APPROVAL_DOMAIN, &DEPLOYMENT_ID, program_id, proposal, body]' \
  '&[APPROVAL_DOMAIN, &DEPLOYMENT_ID, program_id, body]'
mutant C1 instructions.rs "execute recomputes the commitment" \
  'if authorization_commitment(&ix, prefix, settlements)? != proposal.commitment {' \
  'if authorization_commitment(&ix, prefix, settlements)? == [0; 32] {'
mutant C2 instructions.rs "default ring only" '!default_ring || ' ''
mutant C3 instructions.rs "SOL withdrawals are the only interface transfers" \
  '.all(|leg| matches!(leg, InterfaceTransfer::SolWithdrawal { .. }));' '.all(|_| true);'
mutant W1 instructions.rs "the commitment binds the settlement accounts of each withdrawal" \
  'in settlements.as_chunks::<2>().0 {' 'in settlements[..0].as_chunks::<2>().0 {'
mutant W2 instructions.rs "the commitment binds the SOL interface account" \
  '                sol_interface.address().as_array(),' \
  '                recipient.address().as_array(),'
mutant W3 instructions.rs "the owner PDA sits right after the nullifier PDAs" \
  'let owner_at = 4 + ix.tree_contexts.len() + ix.inputs.len();' \
  'let owner_at = spp.len().saturating_sub(1);'
mutant C4 instructions.rs "inline owner tags only" ' || !inline_tags' ''
mutant E1 instructions.rs "execute refuses after the expiry" \
  'if now()? > proposal.expiry_unix_ts {' 'if now()? > u64::MAX - 1 {'
mutant E2 instructions.rs "execute accepts in the expiry second" \
  'if now()? > proposal.expiry_unix_ts {' 'if now()? >= proposal.expiry_unix_ts {'
mutant E3 instructions.rs "create refuses an expiry that is not in the future" \
  'if proposal.expiry_unix_ts <= now()? {' 'if proposal.expiry_unix_ts < now()? {'
mutant X1 instructions.rs "cancel needs the authority's signature" '!authority.is_signer() || ' ''
mutant X2 instructions.rs "cancel needs a listed abort authority" \
  ' || !proposal.is_abort_authority(authority.address().as_array())' ''
mutant X3 instructions.rs "a cancellation record blocks execute" \
  'if cancellation.owned_by(program_id) {
        return Err(MultisigError::Cancelled.into());' \
  'if false {
        return Err(MultisigError::Cancelled.into());'
mutant X4 instructions.rs "execute checks the cancellation address" \
  'if cancellation.address() != &cancel_address {' 'if false {'
mutant X5 instructions.rs "a second cancel of one body keeps its record" \
  'if cancellation.owned_by(program_id) {
        return Ok(());' \
  'if false {
        return Ok(());'
mutant X7 instructions.rs "cancel writes the record of this proposal only" \
  'if cancellation.address() != &address {' 'if false {'
mutant X8 instructions.rs "close_cancelled checks the record address" \
  'if record[0] != KIND_CANCELLED || cancellation.address() != &expected {' \
  'if record[0] != KIND_CANCELLED {'
mutant E4 instructions.rs "cancel needs an abort authority in the expiry second" \
  'if now()? <= proposal.expiry_unix_ts {' 'if now()? < proposal.expiry_unix_ts {'
mutant X6 instructions.rs "close_cancelled waits for the expiry" \
  'if now()? <= expiry {' 'if false {'
mutant N1 instructions.rs "execute and cancel pay the named rent recipient" \
  'if account.address().as_array() != &proposal.rent_recipient {' 'if false {'
mutant N2 instructions.rs "close_cancelled pays the recorded rent recipient" \
  'if rent_recipient.address().as_array()[..] != record[10..] {' 'if false {'
mutant P1 instructions.rs "version 2: a funded address does not block create or cancel" \
  'use pinocchio_system::create_account_with_minimum_balance_signed;' \
  'use pinocchio_system::instructions::CreateAccount;

/// Version 1: a plain CreateAccount, which fails on an address that holds lamports.
fn create_account_with_minimum_balance_signed(
    account: &mut AccountView,
    space: usize,
    owner: &Address,
    payer: &AccountView,
    _rent: Option<&AccountView>,
    signers: &[Signer],
) -> ProgramResult {
    let lamports = pinocchio::sysvars::rent::Rent::get()?.try_minimum_balance(space)?;
    let (from, to, space) = (payer, &*account, space as u64);
    CreateAccount { from, to, lamports, space, owner }.invoke_signed(signers)
}'
mutant N3 instructions.rs "the rent recipient is not the owner PDA (review R3)" \
  '[owner, *program_id, SYSTEM_PROGRAM_ID]' '[*program_id, SYSTEM_PROGRAM_ID]'
mutant N4 instructions.rs "the rent recipient is not this program (review R3)" \
  '[owner, *program_id, SYSTEM_PROGRAM_ID]' '[owner, SYSTEM_PROGRAM_ID]'
mutant N5 instructions.rs "the rent recipient is not the System Program (review R3)" \
  '[owner, *program_id, SYSTEM_PROGRAM_ID]' '[owner, *program_id]'
mutant O1 instructions.rs "execute checks the owner PDA account" \
  'if owner.address() != &owner_address {' 'if false {'
mutant L1 instructions.rs "the pool layout has the exact length" \
  'let fits = spp.len() == expected && expected <= MAX_SPP_ACCOUNTS;' \
  'let fits = spp.len() <= MAX_SPP_ACCOUNTS;'
mutant L4 instructions.rs "the pool layout fits the CPI bound of 24 accounts" \
  'let fits = spp.len() == expected && expected <= MAX_SPP_ACCOUNTS;' \
  'let fits = spp.len() == expected;'
mutant L2 instructions.rs "the owner PDA is the only owner signer" \
  '.all(|(at, account)| (at == owner_at) == (account.address() == owner));' \
  '.all(|(at, account)| at != owner_at || account.address() == owner);'
mutant L3 instructions.rs "the pool payer is the execute payer" ' || spp[0].address() != payer' ''
mutant T1 instructions.rs "the transact CPI goes to the pool account only" \
  'if spp.get(2).map(AccountView::address) != Some(&PROGRAM_ID_PUBKEY) {' 'if false {'
mutant T2 instructions.rs "the owner PDA signs the transact CPI" \
  'let signs = account.is_signer() || account.address() == owner;' \
  'let signs = account.is_signer();'
mutant T3 instructions.rs "the transact CPI carries the transact tag" \
  'instruction_data.push(TRANSACT);' 'instruction_data.push(TRANSACT + 1);'
mutant K1 instructions.rs "a proposal is owned by the program" \
  'if !account.owned_by(program_id) {
        return Err(MultisigError::NotAProposal.into());' \
  'if false {
        return Err(MultisigError::NotAProposal.into());'
mutant K2 instructions.rs "a proposal has the proposal kind" \
  'if data.len() < HEADER || data[0] != KIND_PROPOSAL {' 'if data.len() < HEADER {'
mutant K3 instructions.rs "a proposal sits at the address of its body and bump" \
  'if account.address() != &expected {' 'if false {'
mutant K5 instructions.rs "the proposal address binds the body (review R1)" \
  '        body_hash,
    ]' \
  '        &[],
    ]'
mutant K4 instructions.rs "create writes only to the canonical proposal address" \
  'if proposal_account.address() != &address {' 'if false {'
mutant S1 state.rs "no duplicate abort authority" \
  'if authorities[i + 1..count].contains(&authorities[i]) {' 'if false {'
mutant S2 state.rs "at most four abort authorities" \
  'if count > MAX_ABORT_AUTHORITIES {' 'if count > MAX_ABORT_AUTHORITIES + 1 {'
mutant D1 instructions.rs "option D: no pool call but transact (here: deposit)" \
  '    transact.invoke::<MAX_SPP_ACCOUNTS>(data, &[Signer::from(&seeds)])?;' \
  '    let deposit = pinocchio::instruction::InstructionView {
        program_id: &zolana_interface::PROGRAM_ID_PUBKEY,
        accounts: &[],
        data: &[zolana_interface::instruction::tag::DEPOSIT],
    };
    pinocchio::cpi::invoke_signed_with_bounds::<1, _>(&deposit, &spp[2..3], &[])?;
    transact.invoke::<MAX_SPP_ACCOUNTS>(data, &[Signer::from(&seeds)])?;'
mutant D2 lib.rs "option D: the program never reads the nullifier key" \
  'pub mod state;' 'pub mod state;
pub const NULLIFIER_KEY_OFFSET: usize = 0;'

for id in "$@"; do
  case " $MATCHED " in *" $id "*) ;; *) fail "no mutant has the id $id" ;; esac
done
if [ -n "$SURVIVED" ]; then
  echo "mutants.sh: survived:$SURVIVED" >&2
  exit 1
fi
echo "mutants.sh: every mutant was killed"
