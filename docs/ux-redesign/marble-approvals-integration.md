# Marble and approvals integration

The pending web presentation changes from `codex/marble-integration` and
`codex/approvals` are integrated with the existing messaging, settings, security,
overview and swap work on `codex/ux-ui-final`. Source branch histories were already
merged; this pass commits and integrates their remaining work.

Conflicts retain the unified Messages workspace, settings renderer, security
dashboard, existing wallet heading marble, setup QR dismissal and messaging review
dismissal. Obsolete imports from the older approvals branch are omitted.
A disabled New chat action again exposes its existing reason as visible text and
an accessible description; its availability and handler are unchanged.

Validation on the combined committed tree: full application regression, module
graph, page lint, messaging presentation/cost review, approvals classification,
and premium motion pass. Chromium messaging checks pass 145 assertions and
approvals checks pass 16 assertions. Compact completion browser checks pass,
including desktop/phone widths, themes, optional backup controls, forced colors
and enlarged text. The standalone marble branch also passes unified setup and
eight artwork identity/reveal tests.

The combined unified-setup recorder still assumes the former wallet-specific
Messages heading and older Settings DOM/browser mocks. It fails on those stale
fixtures; the full app and real-browser checks above pass. The broader Settings
fixture migration is outside this merge.

Current unrelated edits in the target checkout are preserved separately from
these commits. No native, engine, API, authentication or payment-policy changes
are introduced by this integration.
