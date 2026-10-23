import SwiftUI

struct NativeApprovalsView: View {
    @Environment(GroupModel.self) private var model
    var body: some View {
        let sessions = model.state.sessions
        let mine = sessions.filter { model.needsMyApproval(model.gid ?? "", $0) }
        VStack(alignment: .leading, spacing: 20) {
            InstrumentHeading(title: "Approvals", detail: "Review what leaves the wallet. Each device checks the transaction before signing.")
            if mine.isEmpty {
                Card {
                    InstrumentEmptyState(symbol: "checkmark.seal", title: "You're all caught up",
                        detail: "No payments currently need your approval. Requests will appear here when a signer proposes a payment.")
                }
            } else { ApprovalsCard(list: mine) }
            let others = sessions.filter { ss in
                !mine.contains(where: { $0.id == ss.id })
                    && (!containsTerminal(ss) || model.inFlight.contains(where: { $0.id == ss.id }))
            }
            if !others.isEmpty {
                Card {
                    Text("Payment progress").font(.nativeHeadline)
                    Text("Approvals, signing, proof and network submission are separate steps.")
                        .font(.nativeCaption).foregroundStyle(Color.mist)
                    ForEach(others) { SentRow(ss: $0) }
                }
            }
            Text("An approval commits this signer to the checked payment. Submission alone does not confirm that a block included it.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }
    }
    private func containsTerminal(_ ss: Session) -> Bool {
        ["broadcast", "cancelled", "failed"].contains(ss.status) || has(ss.doc["error"])
    }
}

struct NativeSecurityView: View {
    @Environment(GroupModel.self) private var model
    let change: () -> Void
    @State private var details = false
    var body: some View {
        let st = model.state
        let saved = model.keyShareSeats.count - model.unsavedSeats.count
        VStack(alignment: .leading, spacing: 20) {
            InstrumentHeading(title: "Security", detail: "Understand who can approve, what this device holds, and how to recover a lost share.")
            Card {
                SectionLabel(text: "Shared control")
                Text("\(st.t) of \(st.n) approvals").font(.title2.weight(.semibold))
                Text(ruleText(st.t, st.n)).font(.nativeSubheadline).foregroundStyle(Color.mist)
                AdaptiveRow {
                    Badge(text: "\(st.seatedCount) of \(st.n) signers joined")
                    Badge(text: "\(st.verifiedCount) address checks", kind: st.n > 0 && st.verifiedCount == st.n ? .ok : .warn)
                }
                if model.localSeats.count >= st.t {
                    Label("This device holds enough seats to approve alone. For independent control, each signer needs a separate device.",
                        systemImage: "exclamationmark.triangle")
                        .font(.nativeSubheadline).foregroundStyle(Color.signal)
                }
            }
            Card {
                SectionLabel(text: "This device")
                Label(model.lockOn ? "Device protection enabled" : "Device protection not enabled", systemImage: model.lockOn ? "lock.shield" : "lock.open")
                    .font(.nativeHeadline)
                #if os(macOS)
                Text("The current ad-hoc signed Mac build does not offer the iPhone's Keychain access-control lock. Protect your Mac account and disk; do not assume a browser passkey protects this app.")
                    .font(.nativeFootnote).foregroundStyle(Color.mist)
                #else
                Text("Optional device protection uses the existing Face ID / passcode vault. It does not change how many signers a payment needs.")
                    .font(.nativeFootnote).foregroundStyle(Color.mist)
                #endif
                Text("\(model.localSeats.count) local seat(s) · \(saved) of \(model.keyShareSeats.count) local backup files saved")
                    .font(.nativeCaption).foregroundStyle(Color.mist)
                Text("Saved means this device completed a file export. It does not prove that the file is still accessible or that another device has a usable copy.")
                    .font(.nativeFootnote).foregroundStyle(Color.mist)
            }
            SignersTab(change: change)
            DisclosureGroup("Wallet details and privacy", isExpanded: $details) { DetailsTab().padding(.top, 12) }
                .font(.nativeSubheadline.weight(.medium))
        }
    }
}

struct NativeSettingsView: View {
    @Environment(GroupModel.self) private var model
    @AppStorage("zf-appearance") private var appearance = "system"
    let openSettings: () -> Void
    let recover: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            InstrumentHeading(title: "Settings", detail: "Your device preferences and connections.")
            Card {
                Label("Appearance", systemImage: "circle.lefthalf.filled").font(.nativeHeadline)
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }.pickerStyle(.segmented)
                Text("Follow your device or choose a theme for Zigs.").font(.nativeCaption).foregroundStyle(Color.mist)
            }
            Card {
                Text("Profile and connection").font(.nativeHeadline)
                Text("Manage your nickname, group-server address and supported device lock.")
                    .font(.nativeSubheadline).foregroundStyle(Color.mist)
                ConnectionLine(connected: model.connected)
                Button("Open device settings", systemImage: "slider.horizontal.3", action: openSettings)
            }
            Card {
                Text("Recover a wallet").font(.nativeHeadline)
                Text("Open an existing recovery file with its passphrase. Importing restores its individual seat; the wallet's approval rule still applies.")
                    .font(.nativeSubheadline).foregroundStyle(Color.mist)
                Button("Choose recovery file", systemImage: "arrow.down.doc", action: recover)
            }
            Text("Wallet signers, recovery exports, address checks and privacy details are in Security.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }
    }
}

/// Educational only. Disclosure state is never wallet progress or permission.
struct NativeHelpView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            InstrumentHeading(title: "How Zigs works", detail: "A private wallet, controlled together. Start here, then follow the real checks on each device.")
            SetupEducation()
            ForEach(Array(Self.chapters.enumerated()), id: \.offset) { i, chapter in
                Card {
                    DisclosureGroup {
                        Text(chapter.1).font(.nativeBody).foregroundStyle(Color.mist)
                            .fixedSize(horizontal: false, vertical: true).padding(.top, 12)
                    } label: {
                        HStack(spacing: 12) {
                            Text(String(format: "%02d", i + 1)).font(.nativeCaption.monospaced()).foregroundStyle(Color.signal)
                            Text(chapter.0).font(.nativeHeadline).fixedSize(horizontal: false, vertical: true)
                        }.frame(minHeight: 44, alignment: .leading)
                    }.tint(.mist)
                }
            }
            Text("This guide explains the process. Reading it never confirms a safety number, creates a key, verifies an address or approves a payment.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }
    }
    static let chapters: [(String, String)] = [
        ("Choose your people and rule", "Choose how many signers share control and how many must approve. Zigs currently needs at least two approvals. A seat is a signing identity; several seats on one device do not provide independent control."),
        ("Protect this device", "Your key share lives on this device. The iPhone app can encrypt local key shares using its existing Face ID or passcode vault. The current ad-hoc signed Mac build does not offer that lock. Device protection and payment approvals are separate safeguards."),
        ("Share a private invitation", "Send the wallet invite through a trusted private channel. Anyone who has the link can take an open seat. The secret after # must stay private. Joining a wallet is different from joining a direct chat."),
        ("Compare the safety number", "Compare the complete thirty-digit safety number with every signer, on a call or in person. Confirm only when every digit matches. If someone sees a different number, stop and create a new wallet. The guide cannot confirm it for you."),
        ("Create separate key shares", "Keep every signer device open while the devices create the shared wallet key together. Each device retains its own share. A tutorial step or an invitation is not proof that the ceremony finished."),
        ("Check the wallet address", "Each device checks the address against its own key share. Follow the actual address-verification status. A mismatch or rejected address is a reason to stop; do not send funds to an unchecked address."),
        ("Save recovery files", "Backups are optional for entering a formed wallet, but losing enough shares can make funds inaccessible. Export each required seat separately. Keep each encrypted file safe and its passphrase apart from it. One file alone does not recover a 2-of-3 wallet. Export status does not verify a file later."),
        ("Receive and sync", "Use Receive for the current wallet's shielded Zcash address. Check its network and any warning level. The app syncs with a light-wallet server; loading, paused sync and failures are distinct from a confirmed zero balance. Solana and USDC are unavailable in native Zigs."),
        ("Review and approve a payment", "A signer proposes a payment. Each approving device decodes and checks recipients, amounts, memos and fees. After enough approvals, devices combine signing shares, build a proof and submit the transaction. These are separate steps, and network submission is not block confirmation. Payment discussion belongs to that review."),
        ("Recover or change signers", "Use Recover to import a seat backup through the existing guarded restore flow. The signer rule remains in force. To replace signers or change the rule, create a replacement wallet and move funds through an approved payment. The old wallet and the replacement keep separate addresses and history.")
    ]
}
