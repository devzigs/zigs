import SwiftUI

/// A read-only counterpart of the web's separate messaging-account setup.
/// The native engine has no personal on-chain account; no account handler is called.
struct NativeMessagingPreview: View {
    var initialStep = 0
    @State private var selected: Int?
    private var step: Int { selected ?? initialStep }
    private static let stages = ["Account", "Back up", "Funding", "Contact"]
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Card {
                HStack { Text("Zcash messages").font(.nativeHeadline); Spacer(); Badge(text: "Demo") }
                Text("A small account for your messages").font(.title2.weight(.semibold))
                Text("The web version uses a separate personal account for shielded memos. This native walkthrough shows that flow; it creates no account, key, address or backup.")
                    .font(.nativeSubheadline).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
                Picker("Messaging demo step", selection: Binding(get: { step }, set: { selected = $0 })) {
                    ForEach(Array(Self.stages.enumerated()), id: \.offset) { index, title in Text(title).tag(index) }
                }.pickerStyle(.menu)
                Text("Step \(step + 1) of 4 · " + Self.stages[step]).font(.nativeCaption).foregroundStyle(Color.signal)
            }
            Card {
                Label(title, systemImage: symbol).font(.nativeHeadline)
                Text(copy).font(.nativeBody).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
                if step == 2 {
                    HStack {
                        Text("Example one-part fee").font(.nativeSubheadline)
                        Spacer()
                        Text("0.0001 ZEC").font(.nativeSubheadline.monospaced())
                    }
                    Text("Illustrative web fee, not a quote. No account is funded, no QR is generated and no funds can be sent here.")
                        .font(.nativeFootnote).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
                }
                if step == 3 {
                    InstrumentEmptyState(symbol: "bubble.left.and.bubble.right", title: "Your conversation starts with a contact",
                        detail: "The web flow adds a shielded address and gives that contact a separate reply address. Native Relay chats remain available in the Relay tab.")
                }
                AdaptiveRow {
                    if step > 0 { Button("Back") { selected = step - 1 } }
                    Button(step == 3 ? "Replay walkthrough" : "Preview next step") { selected = step == 3 ? 0 : step + 1 }.primaryButton()
                }
            }
            Text("Demo only. A contact or reply address does not verify identity. Advanced application encryption and hybrid post-quantum messaging remain planned; this preview makes no additional security claim.")
                .font(.nativeFootnote).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
        }
    }
    private var title: String {
        ["Separate control", "Back up the messaging account", "Add a little ZEC", "Choose a contact"][step]
    }
    private var symbol: String { ["person.crop.circle", "doc.badge.arrow.up", "arrow.down", "person.crop.rectangle.stack"][step] }
    private var copy: String {
        ["In the web app, the personal account stays separate from shared wallets. Each message spends that account’s fee without team approval. Funding from a shared wallet still requires its normal approvals. Native Zigs currently has no separate messaging account.",
         "The web backup contains the personal account seed and contacts, not sent-message history. It needs another backup after contacts change. This walkthrough cannot export or verify that account; wallet signer backups remain in Security.",
         "On-chain messages pay a network fee and wait for block inclusion. Longer messages can cost more, and incoming funds need the web account’s required confirmations before they can pay a fee. Demo progress is not funding evidence.",
         "Each contact receives a dedicated address for replies in the web flow. Check the intended person and network before sharing it. Native payment recipients, wallet signers and Relay contacts remain separate."][step]
    }
}
