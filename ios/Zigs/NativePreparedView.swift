import SwiftUI

/// This handoff follows an observed wallet-ready transition; it never advances setup.
struct NativePreparedCard: View {
    let security: () -> Void
    let overview: () -> Void
    var body: some View {
        Card(highlight: true) {
            Label("Your Zcash wallet is ready", systemImage: "checkmark.seal").font(.nativeHeadline)
            Text("Your wallet is available. Review each signer’s address check in Security. Recovery files are optional for entering Overview; save the required shares to protect against device loss.")
                .font(.nativeSubheadline).foregroundStyle(Color.mist)
            AdaptiveRow {
                Button("Save recovery files", action: security)
                Button("Continue to Overview", action: overview).primaryButton()
            }
        }
    }
}
