import SwiftUI

/// Only form presentation and bindings; creation remains in CreateSheet's original handler.
struct NativeCreationStepContent: View {
    let step: Int
    let from: GroupState?
    @Binding var nickname: String
    @Binding var walletName: String
    @Binding var n: Int
    @Binding var t: Int
    @Binding var mainnet: Bool
    @Binding var understood: Bool

    var body: some View {
        switch step {
        case 0:
            Card {
                Text("Your name").font(.nativeHeadline)
                TextField("Nickname shown to your signers", text: $nickname)
                    .accessibilityLabel("Your nickname")
                Text(from == nil ? "Wallet name" : "New wallet name").font(.nativeHeadline)
                TextField(from?.name ?? "Team treasury", text: $walletName)
                    .accessibilityLabel("Wallet name")
                Text("Use a short name everyone recognizes. Each wallet has its own address, signers and rule.")
                    .font(.nativeFootnote).foregroundStyle(Color.mist)
            }
        case 1:
            Card {
                Stepper("Signers: \(n)", value: $n, in: 2...7).onChange(of: n) { if t > n { t = n } }
                    .frame(minHeight: 48)
                Stepper("Approvals needed: \(t)", value: $t, in: 2...n).frame(minHeight: 48)
                NativeRuleDiagram(required: t, total: n)
                Text(ruleText(t, n)).font(.nativeSubheadline).foregroundStyle(Color.mist)
                Text("For independent control, each signer uses a separate device. Changing the rule later requires a new wallet and an approved transfer.")
                    .font(.nativeFootnote).foregroundStyle(Color.mist)
            }
        case 2:
            Card {
                if let from {
                    Badge(text: from.net.label)
                    Text("The replacement stays on the old wallet's network. Funds cannot move between networks.")
                        .font(.nativeSubheadline).foregroundStyle(Color.mist)
                } else {
                    Picker("Network", selection: $mainnet) {
                        Text("Testnet").tag(false)
                        Text("Mainnet").tag(true)
                    }.pickerStyle(.segmented)
                    Text(mainnet ? "Real ZEC. Beta, not audited: the app warns at \(capText(ZcashNetwork.mainnet.cap ?? 0)) per wallet." : "Free test coins, for trying Zigs.")
                        .font(.nativeSubheadline).foregroundStyle(mainnet ? Color.bad : Color.mist)
                    if mainnet {
                        Toggle("I understand that Zigs is not audited and that I can lose the funds in this wallet.", isOn: $understood)
                    }
                }
            }
        default:
            Card {
                Detail(label: "Wallet name") { Text(walletName.trimmingCharacters(in: .whitespaces).isEmpty ? (from?.name ?? "Treasury") : walletName) }
                Detail(label: "Shared control") { Text("Any \(t) of \(n) signers must approve") }
                Detail(label: "Network") { Text(from?.net.label ?? (mainnet ? "Mainnet" : "Testnet")) }
                NativeRuleDiagram(required: t, total: n)
                Text(from == nil
                    ? "You take seat 1. Share the private invite, compare the full safety number together, and keep each device open while it creates its share and checks the address."
                    : "The new signers join using a private invite. The new wallet gets a new address. Moving the funds needs the old wallet's approval rule.")
                    .font(.nativeSubheadline).foregroundStyle(Color.mist)
                Text("Recovery files are optional to continue after formation. Save each needed seat's file and keep its passphrase separately; losing enough shares can make funds inaccessible.")
                    .font(.nativeFootnote).foregroundStyle(Color.mist)
                if mainnet && from == nil { Text("Real funds · beta · not audited").font(.nativeSubheadline.weight(.semibold)).foregroundStyle(Color.bad) }
            }
        }
    }
}
