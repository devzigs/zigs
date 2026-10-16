use pinocchio::error::ProgramError;

/// Custom error codes. Stable: the spike scripts match on them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MultisigError {
    BadProposalData = 6000,
    DuplicateAbortAuthority = 6001,
    TooManyAbortAuthorities = 6002,
    ExpiryNotInFuture = 6003,
    NegativeClock = 6004,
    BadProposalAddress = 6005,
    NotAProposal = 6006,
    BadCancellationAddress = 6007,
    Cancelled = 6008,
    Expired = 6009,
    RentRecipientMismatch = 6010,
    MissingApproval = 6011,
    BadApproval = 6012,
    UnsupportedTransact = 6013,
    CommitmentMismatch = 6014,
    BadOwnerAddress = 6015,
    BadSppAccounts = 6016,
    NotAbortAuthority = 6017,
    CancellationTooShort = 6018,
    NotExpired = 6019,
    NotACancellation = 6020,
}

impl From<MultisigError> for ProgramError {
    fn from(error: MultisigError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
