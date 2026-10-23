import SwiftUI
import TipKit

@main
struct ZigsApp: App {
    @State private var model = GroupModel()
    @AppStorage("zf-appearance") private var appearance = "system"
    @Environment(\.scenePhase) private var phase

    init() { try? Tips.configure() }

    var body: some Scene {
        WindowGroup {
            Group {
                if model.locked { LockView() } else { RootView() }
            }
                .environment(model)
                .nativeSheetSizing()
                .tint(.signal)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .buttonStyle(InstrumentButtonStyle())
                .textFieldStyle(InstrumentFieldStyle())
                .onOpenURL { model.join($0.absoluteString) }
                .onChange(of: phase) { model.setActive(phase == .active) }
        }
        #if os(macOS)
        .defaultSize(width: 1200, height: 860)
        #endif
    }
}

struct RootView: View {
    @Environment(GroupModel.self) private var model
    @State private var sheet: RootSheet?
    @State private var importing = false
    @State private var workspace = NativeWorkspace.overview
    @State private var columns = NavigationSplitViewVisibility.all
    @State private var compactColumn = NavigationSplitViewColumn.detail
    @State private var routeIntent: NativeWorkspace?

    enum RootSheet: Identifiable {
        case join, settings, create, chat
        case restore(name: String, text: String)
        var id: String {
            switch self {
            case .join: "join"
            case .settings: "settings"
            case .create: "create"
            case .chat: "chat"
            case .restore: "restore"
            }
        }
    }

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Button(action: home) {
                        HStack(spacing: 10) {
                            Image("Logo").resizable().scaledToFit().frame(width: 36, height: 36)
                            Text("Zigs").font(.title2.weight(.semibold))
                            Spacer()
                        }.padding(12)
                    }.buttonStyle(.plain).accessibilityLabel("Zigs · Your wallets")
                    NativeNavigation(selected: workspace,
                        approvals: model.gid.flatMap { model.toApprove[$0] } ?? 0, choose: navigate)
                    if !model.groups.isEmpty {
                        SectionLabel(text: "Wallets").padding(.horizontal, 14)
                        ForEach(model.groups) { g in
                            Button {
                                openWallet(g.id, in: .overview)
                            } label: {
                                HStack(spacing: 10) {
                                    Avatar(text: initials(g.name), size: 28)
                                    Text(g.name).font(.nativeSubheadline).multilineTextAlignment(.leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                    if model.gid == g.id && !model.path.isEmpty {
                                        Image(systemName: "checkmark").font(.nativeCaption).foregroundStyle(Color.signal)
                                    }
                                }.padding(12).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                            }.buttonStyle(.plain)
                        }
                    }
                    ConnectionLine(connected: model.connected).padding(.horizontal, 14)
                }.padding(12)
            }
            .modifier(GlassChrome())
            .navigationTitle("Workspace")
            .navigationSplitViewColumnWidth(min: 216, ideal: 240, max: 300)
        } detail: {
            NavigationStack(path: $model.path) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) { workspaceContent }
                        .padding(20).frame(maxWidth: 1100).frame(maxWidth: .infinity)
                }
                .instrumentScreen()
                .navigationTitle(workspace == .overview ? "Your wallets" : workspace.rawValue)
                .navigationDestination(for: String.self) { id in
                    if let cid = Chat.chatId(ofRoute: id) { ChatScreen(cid: cid) }
                    else {
                        GroupView(workspace: $workspace, home: home)
                            .onAppear { model.select(id) }
                    }
                }
                .toolbar {
                    #if os(iOS)
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Menu", systemImage: "sidebar.left") {
                            columns = .all
                            compactColumn = .sidebar
                        }.accessibilityLabel("Open navigation")
                    }
                    #endif
                    ToolbarItem(placement: .primaryAction) {
                        Menu("Add", systemImage: "plus") {
                            Button("New wallet", systemImage: "plus.circle") { workspace = .overview; sheet = .create }
                            Button("Join with an invite link", systemImage: "link") { workspace = .overview; sheet = .join }
                            Button("New chat", systemImage: "bubble.left") { workspace = .chats; sheet = .chat }
                            Button("Recover from backup", systemImage: "arrow.down.doc") { importing = true }
                        }
                    }
                }
            }
            .id(workspace)
            .environment(\.nativeHome, { home() })
        }
        .sheet(item: $sheet) { s in
            switch s {
            case .join: JoinSheet()
            case .settings: SettingsSheet()
            case .create: CreateSheet(from: nil)
            case .chat: NewChatSheet()
            case .restore(let name, let text): RestoreSheet(name: name, text: text)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { importBackup($0) }
        .onChange(of: model.path, initial: true) { _, path in
            if let requested = routeIntent {
                routeIntent = nil
                workspace = requested
            } else if let route = path.last {
                workspace = Chat.chatId(ofRoute: route) != nil ? .chats : .overview
            }
            if !path.isEmpty { showDetail() }
        }
        .onChange(of: model.chat.offers.keys.sorted(), initial: true) { _, offers in
            if !offers.isEmpty { workspace = .chats; showDetail() }
        }
        .modifier(Banners())
    }

    private func showDetail() {
        #if os(iOS)
        columns = .detailOnly
        compactColumn = .detail
        #endif
    }

    private func home() {
        workspace = .overview
        model.path = []
        model.select(nil)
        showDetail()
    }

    private func navigate(_ item: NativeWorkspace) {
        workspace = item
        let path = model.gid.map { [$0] } ?? []
        if model.path != path { routeIntent = item; model.path = path }
        showDetail()
    }

    private func openWallet(_ id: String, in item: NativeWorkspace) {
        workspace = item
        model.select(id)
        if model.path != [id] { routeIntent = item; model.path = [id] }
        showDetail()
    }

    @ViewBuilder private var workspaceContent: some View {
        switch workspace {
        case .overview:
            NativeWelcome(create: { sheet = .create }, join: { sheet = .join },
                restore: { importing = true }, learn: { workspace = .help }, returning: !model.groups.isEmpty)
            if !model.groups.isEmpty {
                SectionLabel(text: "Saved on this device")
                VStack(spacing: 0) {
                    ForEach(model.groups) { g in
                        Button { openWallet(g.id, in: .overview) } label: { WalletRow(g: g) }.buttonStyle(.plain)
                        if g.id != model.groups.last?.id { Divider().overlay(Color.line) }
                    }
                }.modifier(SatinSurface())
            }
        case .addressBook: RecipientBookView()
        case .chats: ChatsWorkspace()
        case .swap: UnavailableSwap()
        case .help: NativeHelpView()
        case .settings: NativeSettingsView(openSettings: { sheet = .settings }, recover: { importing = true })
        case .activity, .approvals, .security:
            InstrumentHeading(title: workspace.rawValue, detail: "Choose a wallet to see its " + workspace.rawValue.lowercased() + ".")
            ForEach(model.groups) { g in
                Button { openWallet(g.id, in: workspace) } label: { WalletRow(g: g) }.buttonStyle(.plain)
            }
            if model.groups.isEmpty {
                InstrumentEmptyState(symbol: workspace.symbol, title: "No wallets on this device",
                    detail: "Create a wallet, join with an invite, or recover an existing key share.")
            }
        }
    }

    private func importBackup(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let text = try readBackupFile(url)
            if try model.receiveBackup(text) {
                sheet = .restore(name: url.lastPathComponent, text: text)
            }
        } catch {
            model.banner = error.localizedDescription
        }
    }
}

struct LockView: View {
    @Environment(GroupModel.self) private var model
    @State private var forgetting = false

    var body: some View {
        VStack(spacing: 16) {
            ZebraEmblem(size: 112)
            Text("Zigs is locked").font(.title2.weight(.semibold)).foregroundStyle(Color.primary)
            Text("The key shares and saved recipients on this device are encrypted. "
                 + "Unlock with \(lockName) or your passcode.")
                .font(.nativeSubheadline).foregroundStyle(Color.mist).multilineTextAlignment(.center)
            Button("Unlock") { Task { await model.unlock() } }
                .primaryButton()
            Button("Cannot unlock?") { forgetting = true }
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .instrumentScreen()
        .task { await model.unlock() }
        .modifier(Banners())
        .confirmationDialog("Delete the locked keys?", isPresented: $forgetting,
                            titleVisibility: .visible) {
            Button("Delete the locked keys", role: .destructive) { model.forgetLockedKeys() }
        } message: {
            Text("Do this only if this device cannot unlock them. The seats and saved recipients on this device "
                 + "are lost, but each wallet still works while enough other signers remain.")
        }
    }
}

struct WalletRow: View {
    @Environment(GroupModel.self) private var model
    let g: GroupInfo

    var body: some View {
        NativeSavedWalletSummary(name: g.name, network: ZcashNetwork.of(g.network).label,
            rule: "\(g.t) of \(g.n) approvals", viewOnly: model.vault.seats(in: g.id).isEmpty,
            amount: g.movedTo == nil && model.wallets[g.id] != nil ? model.balances[g.id] : nil,
            status: g.movedTo != nil ? "Moved" : model.wallets[g.id] == nil ? "Setting up" : nil,
            pending: model.toApprove[g.id] ?? 0, unread: model.unread(g.id))
    }
}

struct Welcome: View {
    let create: () -> Void
    let join: () -> Void
    let restore: () -> Void
    @State private var help = false
    var body: some View {
        NativeWelcome(create: create, join: join, restore: restore, learn: { help = true })
            .sheet(isPresented: $help) {
                NavigationStack {
                    ScrollView { NativeHelpView().padding(20) }.instrumentScreen()
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { help = false } } }
                }
            }
    }
}

struct ConnectionLine: View {
    let connected: Bool
    var body: some View {
        Label(connected ? "Connected to the group server" : "Connecting to the group server…",
              systemImage: connected ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
            .font(.nativeCaption)
            .foregroundStyle(connected ? Color.mist : Color.signal)
    }
}

/// Errors as an alert, short confirmations as a toast at the bottom.
struct Banners: ViewModifier {
    @Environment(GroupModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .alert("Something went wrong", isPresented: Binding(get: { model.banner != nil },
                                                                set: { if !$0 { model.banner = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.banner ?? "")
            }
            .alert("Check this", isPresented: Binding(get: { model.warning != nil },
                                                      set: { if !$0 { model.warning = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.warning ?? "")
            }
            .overlay(alignment: .bottom) {
                if let n = model.notice {
                    Text(n).font(.nativeSubheadline.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Color.room, in: Capsule()).overlay(Capsule().stroke(Color.good.opacity(0.5)))
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .task(id: n) {
                            try? await Task.sleep(for: .seconds(3))
                            model.notice = nil
                        }
                }
            }
            .animation(reduceMotion ? nil : Instrument.motion, value: model.notice)
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
                    TextField("Any nickname · shown to your signers", text: $model.name)
                }
                Section {
                    TextField("https://…/#wallet.key", text: $link)
                        .font(.nativeBody.monospaced())
                        .codeEntry()
                    PasteButton(payloadType: String.self) { s in Task { @MainActor in link = s.first ?? "" } }
                } header: {
                    Text("Invite link")
                } footer: {
                    Text("A wallet invite link or a chat contact link. The secret after # stays on "
                         + "this \(deviceName). The server never sees it.")
                }
            }
            .instrumentScreen().nativeSheetSizing()
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

    @State private var step = 0
    private let stepTitles = ["Name your wallet", "Choose shared control", "Choose the network", "Review your wallet"]

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    NativeCreationProgress(step: step, titles: stepTitles)
                    InstrumentHeading(title: stepTitles[step], detail: from == nil
                        ? "A private shared wallet. Each signer keeps a separate key share."
                        : "Create a replacement wallet, then approve the move from your old wallet.")
                    NativeCreationStepContent(step: step, from: from, nickname: $model.name,
                        walletName: $walletName, n: $n, t: $t, mainnet: $mainnet, understood: $understood)
                    if step == 0 {
                        #if os(iOS)
                        Card {
                            Label(model.lockOn ? "This device is protected" : "Protect this device · recommended",
                                systemImage: model.lockOn ? "lock.shield" : "lock.open").font(.nativeHeadline)
                            Text("The existing device lock encrypts local key shares and asks for \(lockName) or your passcode at startup. It does not change the wallet's approval rule.")
                                .font(.nativeFootnote).foregroundStyle(Color.mist)
                            if !model.lockOn {
                                Button("Protect with \(lockName)") { model.turnOnLock() }
                                Text("Protection is optional. Continue to keep the current device-storage setting.")
                                    .font(.nativeCaption).foregroundStyle(Color.mist)
                            }
                        }
                        #endif
                        DisclosureGroup("How shared wallets work") { SetupEducation().padding(.top, 12) }
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }
            .instrumentScreen().nativeSheetSizing()
            .navigationTitle(from == nil ? "Create wallet" : "Change signers").inlineTitle()
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 12) {
                    if step > 0 { Button("Back") { step -= 1 }.disabled(working) }
                    Spacer()
                    if step < 3 {
                        Button("Continue") { step += 1 }.primaryButton()
                    } else {
                        Button(working ? "Creating…" : (from == nil ? "Create wallet" : "Create new wallet")) { create() }
                            .primaryButton().disabled(working || (from == nil && mainnet && !understood))
                    }
                }.padding(16).modifier(GlassChrome())
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) } }
            .onAppear { if let from { n = from.n; t = from.t } }
        }
        .interactiveDismissDisabled(working)
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
    @AppStorage("zf-appearance") private var appearance = "system"

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: $appearance) {
                        Text("System").tag("system")
                        Text("Dark").tag("dark")
                        Text("Light").tag("light")
                    }
                }
                Section("Your name") {
                    TextField("Any nickname · shown to your signers", text: $model.name)
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
                    SecureField("Password (if the server has one)", text: $model.password)
                } header: {
                    Text("Group server")
                } footer: {
                    Text("The server relays sealed messages only. It cannot read your wallets.")
                }
            }
            .instrumentScreen().nativeSheetSizing()
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { model.reconnect(); dismiss() }
                }
            }
        }
    }
}
