import SwiftUI
import TipKit

@main
struct ZigsApp: App {
    @State private var model = GroupModel()

    init() { try? Tips.configure() }

    var body: some Scene {
        WindowGroup {
            Group {
                if model.locked { LockView() } else { RootView() }
            }
                .environment(model)
                .tint(.signal)
                .preferredColorScheme(.dark)
                .onOpenURL { model.join($0.absoluteString) }
        }
        #if os(macOS)
        .defaultSize(width: 560, height: 860)
        #endif
    }
}

struct RootView: View {
    @Environment(GroupModel.self) private var model
    @State private var sheet: RootSheet?

    enum RootSheet: String, Identifiable {
        case join, settings, create
        var id: String { rawValue }
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Each wallet is a separate shared account, with its own address, signers and approval rule.")
                        .font(.subheadline).foregroundStyle(Color.mist)
                    if model.groups.isEmpty {
                        Welcome(create: { sheet = .create }, join: { sheet = .join })
                    } else {
                        VStack(spacing: 0) {
                            ForEach(model.groups) { g in
                                NavigationLink(value: g.id) { WalletRow(g: g) }
                                if g.id != model.groups.last?.id { Divider().overlay(Color.line) }
                            }
                        }
                        .background(Color.room, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.line))
                    }
                    ConnectionLine(connected: model.connected)
                }
                .padding(16)
            }
            .background(Color.night)
            .navigationTitle("Wallets")
            .navigationDestination(for: String.self) { id in
                GroupView().onAppear { model.select(id) }
            }
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button("Settings", systemImage: "gearshape") { sheet = .settings }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu("Add", systemImage: "plus") {
                        Button("New wallet", systemImage: "plus.circle") { sheet = .create }
                        Button("Join with an invite link", systemImage: "link") { sheet = .join }
                    }
                }
            }
            .sheet(item: $sheet) { s in
                switch s {
                case .join: JoinSheet()
                case .settings: SettingsSheet()
                case .create: CreateSheet(from: nil)
                }
            }
            .modifier(Banners())
        }
    }
}

struct LockView: View {
    @Environment(GroupModel.self) private var model
    @State private var forgetting = false

    var body: some View {
        VStack(spacing: 16) {
            Image("Logo").resizable().frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .accessibilityHidden(true)
            Text("Zigs is locked").font(.title2.weight(.semibold)).foregroundStyle(.white)
            Text("The key shares on this device are encrypted. "
                 + "Unlock with \(lockName) or your passcode.")
                .font(.subheadline).foregroundStyle(Color.mist).multilineTextAlignment(.center)
            Button("Unlock") { Task { await model.unlock() } }
                .buttonStyle(.borderedProminent)
            Button("Cannot unlock?") { forgetting = true }
                .font(.footnote).foregroundStyle(Color.mist)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.night)
        .task { await model.unlock() }
        .modifier(Banners())
        .confirmationDialog("Delete the locked keys?", isPresented: $forgetting,
                            titleVisibility: .visible) {
            Button("Delete the locked keys", role: .destructive) { model.forgetLockedKeys() }
        } message: {
            Text("Do this only if this device cannot unlock them. The seats on this device "
                 + "are lost, but each wallet still works while enough other signers remain.")
        }
    }
}

struct WalletRow: View {
    @Environment(GroupModel.self) private var model
    let g: GroupInfo

    var body: some View {
        let mine = !model.vault.seats(in: g.id).isEmpty
        let pending = model.toApprove[g.id] ?? 0
        HStack(spacing: 12) {
            Avatar(text: initials(g.name), size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(g.name).font(.headline).foregroundStyle(.white).multilineTextAlignment(.leading)
                Text("\(ZcashNetwork.of(g.network).label) · \(g.t) of \(g.n) signers must approve" + (mine ? "" : " · view only"))
                    .font(.caption).foregroundStyle(Color.mist).multilineTextAlignment(.leading)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if g.movedTo != nil {
                    Badge(text: "Moved")
                } else if model.wallets[g.id] == nil {
                    Badge(text: "Setting up", kind: .info)
                } else if let b = model.balances[g.id] {
                    Money(zat: b, size: 15)
                }
                if pending > 0 { Badge(text: "\(pending) to approve", kind: .warn) }
            }
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.mist)
        }
        .padding(14)
        .contentShape(Rectangle())
    }
}

struct Welcome: View {
    let create: () -> Void
    let join: () -> Void

    var body: some View {
        Card {
            Text("Create your first shared wallet").font(.title3.weight(.semibold))
            Text("Nobody ever holds the whole key, and nobody outside your team can read the wallet.")
                .font(.subheadline).foregroundStyle(Color.mist)
            ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(i + 1)").font(.caption.weight(.bold)).frame(width: 24, height: 24)
                        .background(Color.signal.opacity(0.2), in: Circle()).foregroundStyle(Color.signal)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.0).font(.subheadline.weight(.semibold))
                        Text(s.1).font(.caption).foregroundStyle(Color.mist)
                    }
                }
            }
            Button("Create wallet", action: create).primaryButton().frame(maxWidth: .infinity)
            Button("Join with an invite link", action: join).frame(maxWidth: .infinity)
        }
    }

    private let steps = [
        ("Pick a rule", "For example, any 2 of 3 signers must approve each payment."),
        ("Invite your signers", "Send one private link. Each device creates its own piece of the key."),
        ("Approve together", "A payment goes out only after enough signers approve. On chain it looks like any private payment."),
    ]
}

struct ConnectionLine: View {
    let connected: Bool
    var body: some View {
        Label(connected ? "Connected to the group server" : "Connecting to the group server…",
              systemImage: connected ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
            .font(.caption)
            .foregroundStyle(connected ? Color.mist : Color.signal)
    }
}

/// Errors as an alert, short confirmations as a toast at the bottom.
struct Banners: ViewModifier {
    @Environment(GroupModel.self) private var model

    func body(content: Content) -> some View {
        content
            .alert("Something went wrong", isPresented: Binding(get: { model.banner != nil },
                                                                set: { if !$0 { model.banner = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.banner ?? "")
            }
            .overlay(alignment: .bottom) {
                if let n = model.notice {
                    Text(n).font(.subheadline.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Color.room, in: Capsule()).overlay(Capsule().stroke(Color.good.opacity(0.5)))
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .task(id: n) {
                            try? await Task.sleep(for: .seconds(3))
                            model.notice = nil
                        }
                }
            }
            .animation(.default, value: model.notice)
    }
}

struct JoinSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section("Your name") {
                    TextField("Shown to your signers", text: $model.name)
                }
                Section {
                    TextField("https://…/#wallet.key", text: $link, axis: .vertical)
                        .font(.body.monospaced())
                        .codeEntry()
                    PasteButton(payloadType: String.self) { s in Task { @MainActor in link = s.first ?? "" } }
                } header: {
                    Text("Invite link")
                } footer: {
                    Text("The wallet secret after # stays on this \(deviceName). The server never sees it.")
                }
            }
            .navigationTitle("Join a wallet")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Join") { model.join(link); dismiss() }.disabled(link.isEmpty)
                }
            }
        }
    }
}

/// New wallet, or with `from` the wallet that replaces `from` with new signers or a new rule.
struct CreateSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let from: GroupState?
    @State private var walletName = ""
    @State private var n = 3
    @State private var t = 2
    @State private var working = false
    @State private var mainnet = false
    @State private var understood = false

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                if let from {
                    Section {
                        Label("You create a new wallet with the signers and rule you want.", systemImage: "1.circle")
                        Label("The new signers join it with an invite link.", systemImage: "2.circle")
                        Label("This wallet sends all its funds to the new one. Like any payment, this needs \(from.t) approvals.",
                              systemImage: "3.circle")
                    }
                    .font(.subheadline)
                }
                Section("Your name") { TextField("Shown to your signers", text: $model.name) }
                Section(from == nil ? "Wallet name" : "New wallet name") {
                    TextField(from?.name ?? "Team treasury", text: $walletName)
                }
                Section {
                    Stepper("Signers: \(n)", value: $n, in: 2...7).onChange(of: n) { if t > n { t = n } }
                    Stepper("Approvals needed: \(t)", value: $t, in: 2...n)
                } header: {
                    Text("Approval rule")
                } footer: {
                    Text(ruleText(t, n))
                }
                if from == nil {
                    Section {
                        Picker("Network", selection: $mainnet) {
                            Text("Testnet").tag(false)
                            Text("Mainnet").tag(true)
                        }
                        .pickerStyle(.segmented)
                        if mainnet {
                            Toggle("I understand that Zigs is not audited and that I can lose the funds in this wallet.", isOn: $understood)
                                .font(.subheadline)
                        }
                    } header: {
                        Text("Network")
                    } footer: {
                        Text(mainnet ? "Real ZEC. Beta, not audited: the app warns at \(capText(ZcashNetwork.mainnet.cap ?? 0)) per wallet." : "Free test coins, for trying Zigs.")
                    }
                }
                Section {
                    Text(from == nil
                         ? "You take seat 1. Then share the invite link with your signers. When every seat is taken, your devices create the wallet key together."
                         : "The new wallet gets a new address. Signers you leave out can still see this old wallet's payments, but not the new wallet's.")
                        .font(.footnote).foregroundStyle(Color.mist)
                }
            }
            .navigationTitle(from == nil ? "New wallet" : "Change signers")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(from == nil ? "Create" : "Create new wallet") { create() }.disabled(working || (from == nil && mainnet && !understood))
                }
            }
            .onAppear { if let from { n = from.n; t = from.t } }
        }
    }

    private func create() {
        working = true
        let name = walletName.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                // A replacement wallet stays on its predecessor's network: funds cannot move between networks.
                let network = from?.g?.str("network") ?? (mainnet ? "mainnet" : "testnet")
                try await model.createGroup(name: name.isEmpty ? (from?.name ?? "Treasury") : name, n: n, t: t,
                                            from: from == nil ? nil : model.gid, network: network)
                dismiss()
            } catch {
                model.banner = error.localizedDescription
            }
            working = false
        }
    }
}

struct SettingsSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section("Your name") {
                    TextField("Shown to your signers", text: $model.name)
                }
                // The ad-hoc signed Mac build cannot use Keychain access control.
                #if os(iOS)
                Section {
                    if model.lockOn {
                        Label("Locked with \(lockName)", systemImage: "lock.fill")
                    } else {
                        Button("Lock with \(lockName)", systemImage: "lock") { model.turnOnLock() }
                    }
                } header: {
                    Text("Key shares")
                } footer: {
                    Text("With the lock on, the key shares are encrypted, and Zigs asks for "
                         + "\(lockName) or your passcode each time it starts. If you turn off the "
                         + "device passcode, the key shares on this device are lost.")
                }
                #endif
                Section {
                    TextField("Server", text: $model.server)
                        .codeEntry()
                } header: {
                    Text("Group server")
                } footer: {
                    Text("The server relays sealed messages only. It cannot read your wallets.")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { model.reconnect(); dismiss() }
                }
            }
        }
    }
}
