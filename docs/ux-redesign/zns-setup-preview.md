# Optional wallet-name checkout preview

Requested on 22 October 2026, with ZEC and SOL as the two payment options. Implemented in
the web interface as a sixth guided setup step, following the prepared wallet and optional
recovery files. The previous five stages and all actual readiness checks are preserved.

Choose **Continue to wallet name**, enter a name, choose Zcash or Solana, then choose
**Preview payment**. The checkout shows the normalized `.zec` name, an illustrative amount
and a QR. Back returns to the recovery stage; Skip opens Overview using the existing checked
tutorial-completion operation. The prepared-wallet screen also has a direct Skip path.

This is a mock. Name availability is not checked. The example amounts of 0.10 ZEC and
0.02 SOL are arbitrary display fixtures, not prices or exchange-rate equivalents. The QR
contains plain demo text with the selected name and example amount; it contains no payable
URI, recipient, registrar request or wallet data. There is no payment confirmation or
registration-success state. Draft choices exist only in this tab’s memory, per wallet.

The existing testnet name resolver does not provide a purchase checkout. Actual registration,
quotes, SOL settlement and the shared-wallet ownership policy remain deferred in
[the technical review](ux-ui-final-technical-review.md). The known memo-access ownership
limitation is disclosed in the optional step.

## Validation

- `node web/test/zns.mjs`, `node web/test/guided-setup.mjs`,
  `node web/test/setup-stage.mjs` and `node web/test/unified-setup.mjs` pass.
  Existing guided-step text expectations now include the sixth optional step; legacy setup
  still has five steps. Changed JavaScript parses and `git diff --check` passes.
- Browser checks cover empty/invalid/long names, suffix normalization, both currencies and
  amounts, QR changes, editing, focus, skip and 320/390/768/1440 pixel layouts in both themes.
- A synthetic prepared-wallet fixture exercises the real setup view: step six opens only
  when ready; loss of a verified setup fact hides it; Back returns to recovery; Skip completes
  the existing guide. Wallet data is unchanged and no payment proposal is created.
- Existing independent QR comparison could not run because the local `qrencode` CLI is absent.
  The existing QR encoder is reused unchanged. No real registration or payment was attempted.

A standalone, service-free design fixture is available at `/dev/zns-setup/` on a local server
whose public root is `web/`. It renders the same checkout component without wallet keys or
stored accounts.
