import SwiftUI
import TipKit

struct GroupView: View {
    @Environment(GroupModel.self) private var model
    @Binding var workspace: NativeWorkspace
    let home: () -> Void
    @State private var sheet: WalletSheet?
    @State private var importing = false
    @State private var restore: RestoreTarget?
    @State private var formingWallet: String?
    @State private var preparedWallet: String?
    enum WalletSheet: String, Identifiable {
        case send, receive, change, settings
        var id: String { rawValue }
    }
    private struct RestoreTarget: Identifiable {
        let id = UUID()
        let name: String
        let text: String
    }

    var body: some View {
        let st = model.state
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if model.hasStaleRestore { StaleRestoreNote() }
                SignedNotes()
                content(st)
            }
            .padding(20).frame(maxWidth: 1100).frame(maxWidth: .infinity)
        }
        .instrumentScreen()
        .navigationTitle(workspace.rawValue)
        .inlineTitle()
        .safeAreaInset(edge: .top, spacing: 0) {
            NativeWalletHeader(name: st.name, network: st.net.label,
                rule: "\(st.t) of \(st.n) approvals",
                seed: model.addressHidden ? nil : st.wallet?.str("address"), home: home)
        }
        .refreshable { await model.chain?.sync() }
        .onChange(of: model.gid) {
            formingWallet = st.g != nil && !st.ready ? model.gid : nil
            preparedWallet = nil
        }
        .onChange(of: st.ready) {
            if st.ready, let id = model.gid, formingWallet == id {
                preparedWallet = id
                formingWallet = nil
            }
        }
        .sheet(item: $sheet) { s in
            switch s {
            case .send: SendSheet()
            case .receive: ReceiveSheet()
            case .change: CreateSheet(from: model.state)
            case .settings: SettingsSheet()
            }
        }
        .sheet(item: $restore) { RestoreSheet(name: $0.name, text: $0.text) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { result in
            do {
                let url = try result.get()
                let text = try readBackupFile(url)
                if try model.receiveBackup(text) { restore = RestoreTarget(name: url.lastPathComponent, text: text) }
            } catch { model.banner = error.localizedDescription }
        }
        // Preserve the existing once-a-minute open-wallet sync, including cancellation.
        .task(id: model.chain?.gid) {
            while !Task.isCancelled {
                await model.chain?.sync()
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }

    @ViewBuilder private func content(_ st: GroupState) -> some View {
        switch workspace {
        case .addressBook: RecipientBookView()
        case .swap: UnavailableSwap()
        case .chats: ChatsWorkspace()
        case .settings: NativeSettingsView(openSettings: { sheet = .settings }, recover: { importing = true })
        case .help: NativeHelpView()
        default:
            if st.g == nil {
                ProgressView("Loading the wallet…").frame(maxWidth: .infinity).padding(.top, 40)
            } else if st.version == 0 {
                Card { Text("A newer version of Zigs made this wallet. This version cannot set it up. Update Zigs.").foregroundStyle(Color.bad) }
            } else if workspace == .security {
                NativeSecurityView(change: { sheet = .change })
            } else if !st.ready {
                Header()
                SetupView().onAppear { formingWallet = model.gid }
            } else {
                switch workspace {
                case .overview:
                    if preparedWallet == model.gid && preparedWallet != nil {
                        NativePreparedCard(security: { preparedWallet = nil; workspace = .security },
                                           overview: { preparedWallet = nil })
                    }
                    OverviewTab(showSigners: { workspace = .security },
                        showActivity: { workspace = .activity }, showApprovals: { workspace = .approvals },
                        deposit: { sheet = .receive }, send: { sheet = .send })
                case .approvals: NativeApprovalsView()
                case .activity:
                    InstrumentHeading(title: "Activity", detail: "Payments proposed by your signers and Zcash received by this wallet.")
                    ActivityList(limit: nil)
                    Text("Received payments open the network explorer, which sees your IP address and the requested transaction ID. Received entries have block heights; ordering against proposals uses estimated times.")
                        .font(.nativeFootnote).foregroundStyle(Color.mist)
                    SyncLine()
                default: EmptyView()
                }
            }
        }
    }
}

struct Header: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state
        VStack(alignment: .leading, spacing: 8) {
            AdaptiveRow(spacing: 8) {
                Badge(text: st.net.label, kind: st.net.cap == nil ? .plain : .bad)
                Badge(text: "\(st.t) of \(st.n) signers must approve")
                HStack(spacing: -8) {
                    ForEach(st.seatIds, id: \.self) { i in SeatAvatar(i: i, size: 24) }
                }
            }
            Text("\(st.seatedCount) of \(st.n) signers joined"
                 + (st.movedFrom.map { " · Replaces \(model.groupName($0))" } ?? ""))
                .font(.nativeCaption).foregroundStyle(Color.mist)
            // Inline: a popover tip is modal, so it swallows the first tap on any other control.
            TipView(RuleTip())
        }
    }
}

struct SeatAvatar: View {
    @Environment(GroupModel.self) private var model
    let i: Int
    var size: CGFloat = 32

    var body: some View {
        let s = model.state.seats["\(i)"]
        let mine = model.localSeats.contains(i)
        Avatar(text: s == nil ? "+" : initials(mine ? (s?.str("name").flatMap { $0.isEmpty ? nil : $0 } ?? "You") : model.seatLabel(i)),
               mine: mine, size: size)
            .overlay(Circle().stroke(Color.night, lineWidth: 2))
    }
}

// MARK: Setup

struct SetupView: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state
        let open = st.seatIds.filter { st.seats["\($0)"] == nil }
        VStack(spacing: 24) {
            DisclosureGroup("How shared wallets work") { SetupEducation().padding(.top, 12) }
            if model.localSeats.isEmpty, let first = open.first {
                JoinCard(first: first)
            } else if !open.isEmpty, let gid = model.gid {
                InviteCard(link: model.inviteLink(gid), open: open.count)
            }
            if model.setupSaveFailed {
                Card {
                    Text(model.saveFailedText).font(.nativeSubheadline).foregroundStyle(Color.bad)
                    Button("Try again") { model.retrySetup() }.primaryButton()
                }
            }
            SafetyCard()
            ProgressCard()
            SeatsCard(open: open)
            Text("Open Chats from the menu to coordinate with your signers. Payment discussions remain in each review.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }
    }
}

struct JoinCard: View {
    @Environment(GroupModel.self) private var model
    let first: Int

    var body: some View {
        let st = model.state
        Card(highlight: true) {
            Text("Join \(st.name)").font(.title3.weight(.semibold))
            Text("Zigs is a shared wallet for shielded Zcash. Any \(st.t) of the \(st.n) signers approve each payment. Take a seat to become a signer. Your \(deviceName) creates its own key share, and the share never leaves this device. Keep Zigs open until the wallet is ready.")
                .font(.nativeSubheadline).foregroundStyle(Color.mist)
            if st.version == 1 {
                Text("This wallet is not built to ZIP 2005. Funds cannot be recovered if quantum computers break today's keys.")
                    .font(.nativeSubheadline).foregroundStyle(Color.bad)
            }
            Button(usesV2(st.version) ? "Take seat \(first)" : "Take seat \(first) anyway") {
                model.takeSeat(first)
            }.primaryButton()
        }
    }
}

struct SeatsCard: View {
    @Environment(GroupModel.self) private var model
    let open: [Int]

    var body: some View {
        let st = model.state
        Card {
            HStack { Text("Signers").font(.nativeHeadline); Spacer(); Text("\(st.t) of \(st.n) must approve").font(.nativeCaption).foregroundStyle(Color.mist) }
            ForEach(st.seatIds, id: \.self) { i in
                HStack(spacing: 12) {
                    SeatAvatar(i: i)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.seatLabel(i)).font(.nativeSubheadline.weight(.medium))
                        Text("Seat \(i)").font(.nativeCaption).foregroundStyle(Color.mist)
                    }
                    Spacer()
                    Badge(text: stageLabels[st.stage(i)], kind: st.stage(i) == 5 ? .ok : st.seats["\(i)"] == nil ? .plain : .info)
                }
            }
            if !model.localSeats.isEmpty && !open.isEmpty {
                DisclosureGroup("Trying Zigs alone? Play the other seats here") {
                    Text("For a demo or a review only. In real use, each signer takes a seat on their own device.")
                        .font(.nativeCaption).foregroundStyle(Color.mist)
                    ForEach(open, id: \.self) { i in Button("Play seat \(i)") { model.takeSeat(i) } }
                }
                .font(.nativeSubheadline)
            }
        }
    }
}

/// Version 2 wallets: the signers compare one number before the key ceremony starts.
struct SafetyCard: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        if model.safetyOpen && model.abortedText == nil {
            let st = model.state
            Card(highlight: true) {
                if let no = model.safetyNumber {
                    let yes = model.confirmedBy(no).count
                    let clash = numberClash(no, st.confirm, st.seatIds)
                    HStack {
                        Text("Check the safety number").font(.title3.weight(.semibold))
                        Spacer()
                        Badge(text: "\(yes) of \(st.n) confirmed", kind: yes == st.n ? .ok : .warn)
                    }
                    Text(no).font(.system(.title3, design: .monospaced).weight(.medium))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.night, in: RoundedRectangle(cornerRadius: 10))
                        .textSelection(.enabled)
                    Text("Compare this number with every signer, on a call or in person. If it is different, someone else took a seat. In that case, do not tap \"It matches\". Create a new wallet.")
                        .font(.nativeSubheadline).foregroundStyle(Color.mist)
                    if !clash.isEmpty {
                        Text("Seat \(clash.map(String.init).joined(separator: ", ")) confirmed another number. Someone else may have taken a seat. Do not continue. Create a new wallet.")
                            .font(.nativeSubheadline).foregroundStyle(Color.bad)
                    }
                    if !model.unconfirmedSeats.isEmpty {
                        Button("It matches") { model.confirmSafetyNumber(shown: no) }.primaryButton()
                    }
                } else {
                    Text("A seat holds a key that this app cannot read. Do not use this wallet. Create a new wallet.")
                        .font(.nativeSubheadline).foregroundStyle(Color.bad)
                }
            }
        }
    }
}

struct InviteCard: View {
    @Environment(GroupModel.self) private var model
    let link: String
    let open: Int
    @State private var showQR = false

    /// The message carries the link, so it is as secret as the link.
    private var message: String {
        let st = model.state
        return "I made a shared wallet \"\(st.name)\" on Zigs, a private shared wallet for shielded Zcash. "
            + "You are one of \(st.n) signers, and \(st.t) must approve each payment.\n\n"
            + "1. Open this link on your phone or computer: \(link)\n2. Take a seat.\n"
            + "3. Keep the page open until the wallet is ready.\n\n"
            + "This link is a secret. Do not post it in a public place. About Zigs: https://zigs.app"
    }

    var body: some View {
        Card(highlight: true) {
            HStack { Text("Invite your signers").font(.title3.weight(.semibold)); Spacer(); Badge(text: open == 1 ? "1 seat open" : "\(open) seats open", kind: .warn) }
            Text("Send this link to each signer through a private channel. It contains the wallet's secret: anyone who has it can take an open seat.")
                .font(.nativeSubheadline).foregroundStyle(Color.mist)
            Text(link).font(.nativeCaption.monospaced()).lineLimit(2).truncationMode(.middle)
            HStack {
                ShareLink(item: message) { Label("Share", systemImage: "square.and.arrow.up") }.primaryButton()
                CopyButton(text: link, label: "Copy link").buttonStyle(InstrumentButtonStyle())
            }
            DisclosureGroup("Show QR code", isExpanded: $showQR) {
                QRCode(text: link).frame(maxWidth: 240).frame(maxWidth: .infinity)
            }
            .font(.nativeSubheadline)
        }
    }
}

struct ProgressCard: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state
        let key = keyStep(st, model.keyBlock), addr = addrStep(st)
        Card {
            Text("Setting up your wallet").font(.nativeHeadline)
            Step(state: st.allSeated ? .done : .now, no: 1, title: "Signers join", text: "\(st.seatedCount) of \(st.n) seats taken.")
            Step(state: key.state, no: 2, title: "Create the key together", text: key.text)
            Step(state: addr.state, no: 3, title: "Check the address", text: addr.text)
            if st.wallet == nil || st.verifiedCount < st.n {
                Text("Every signer must keep Zigs open until setup finishes.")
                    .font(.nativeCaption).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private typealias StepInfo = (state: Step.State, text: String)

private func keyStep(_ st: GroupState, _ block: (bad: Bool, text: String)?) -> StepInfo {
    if st.allDone && !st.keysAgree { return (.bad, "Signers computed different keys. Create a new wallet.") }
    if let block { return (block.bad ? .bad : .later, block.text) }
    return (st.done.count == st.n ? .done : st.allSeated ? .now : .later, keyProgress(st))
}

private func addrStep(_ st: GroupState) -> StepInfo {
    let n = st.n, ver = st.verifiedCount, rejected = st.rejectedSeats
    if !rejected.isEmpty {
        return (.bad, "Seat \(rejected.map(String.init).joined(separator: ", ")) rejected the address. Do not use this wallet.")
    }
    if st.wallet == nil {
        let keyReady = st.done.count == n
        return (keyReady ? .now : .later, keyReady ? "Building the shared address…" : "Comes after the key.")
    }
    let text = "\(ver) of \(n) signers checked the address against their own key share."
        + (ver < n ? " Send funds only after all \(n) checked." : "")
    return (ver == n ? .done : st.done.count == n ? .now : .later, text)
}

private func keyProgress(_ st: GroupState) -> String {
    let n = st.n
    if st.done.count == n { return "Each signer holds one piece. The full key never existed." }
    if st.dkg1.count == n { return "Devices are sharing encrypted parts of the key (\(st.dkg2.count) of \(n * (n - 1)))…" }
    return st.allSeated ? "Each device is preparing its part of the key (\(st.dkg1.count) of \(n))…" : "Starts when every seat is taken."
}

struct Step: View {
    enum State { case done, now, later, bad }
    let state: State
    let no: Int
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(state == .done ? Color.good.opacity(0.2) : state == .bad ? Color.bad.opacity(0.2)
                              : state == .now ? Color.signal.opacity(0.2) : Color.white.opacity(0.06))
                Text(state == .done ? "✓" : state == .bad ? "!" : "\(no)").font(.nativeCaption.weight(.bold))
                    .foregroundStyle(state == .done ? Color.good : state == .bad ? Color.bad : state == .now ? Color.signal : Color.mist)
            }
            .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.nativeSubheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Text(text).font(.nativeCaption).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: Overview

struct OverviewTab: View {
    @Environment(GroupModel.self) private var model
    let showSigners: () -> Void
    let showActivity: () -> Void
    let showApprovals: () -> Void
    let deposit: () -> Void
    let send: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if model.state.movedTo != nil { MoveCard() }
            BalancePanel {
                NativePortfolioSummary()
                AdaptiveRow {
                    Button("Receive", systemImage: "arrow.down", action: deposit)
                    Button("Send", systemImage: "arrow.up", action: send)
                        .primaryButton().disabled(model.sendBlocker != nil)
                    Button("Swap", systemImage: "arrow.triangle.swap") {}.disabled(true)
                }
                if let why = model.sendBlocker { Text(why).font(.nativeCaption).foregroundStyle(Color.mist) }
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 20) {
                    assets.frame(minWidth: 400)
                    transactions.frame(width: 300)
                }
                VStack(spacing: 20) { assets; transactions }
            }
            Card {
                DisclosureGroup {
                    Text(ruleText(model.state.t, model.state.n)).font(.nativeSubheadline).foregroundStyle(Color.mist)
                    Text("\(model.state.seatedCount) signers joined. Joined does not mean online.")
                        .font(.nativeCaption).foregroundStyle(Color.mist)
                    if !model.unsavedSeats.isEmpty {
                        Text("Some key shares on this device have no saved backup.").foregroundStyle(Color.signal).font(.nativeSubheadline)
                    }
                    Button("Open Security", systemImage: "shield.lefthalf.filled", action: showSigners)
                } label: { Label("Shared control and recovery", systemImage: "person.2.badge.key").font(.nativeHeadline).frame(minHeight: 44) }
            }
        }
    }
    private var assets: some View {
        VStack(spacing: 16) {
            BalanceCard()
            NativeUnavailableAsset(symbol: "◎", name: "Solana", detail: "Native Zigs supports Zcash. Solana setup, fees and shielded SOL are not implemented in this app.")
            NativeUnavailableAsset(symbol: "$", name: "Shielded USDC", detail: "Shielded USDC payments are unsupported. No USDC balance or conversion rate is available.")
        }.frame(maxWidth: .infinity)
    }
    private var transactions: some View {
        let pending = model.state.sessions.filter { model.needsMyApproval(model.gid ?? "", $0) }
        return VStack(spacing: 16) {
            Card(highlight: !pending.isEmpty) {
                HStack {
                    Text("Pending").font(.nativeHeadline)
                    Spacer()
                    Button("View all", action: showApprovals).buttonStyle(.plain).foregroundStyle(Color.signal).frame(minHeight: 44)
                }
                if pending.isEmpty {
                    InstrumentEmptyState(symbol: "checkmark.seal", title: "No approvals needed",
                        detail: "New payment requests appear here.")
                } else { ForEach(pending.prefix(3)) { SentRow(ss: $0) } }
            }
            Card {
                HStack {
                    Text("Recent activity").font(.nativeHeadline)
                    Spacer()
                    Button("View all", action: showActivity).buttonStyle(.plain).foregroundStyle(Color.signal).frame(minHeight: 44)
                }
                ActivityList(limit: 3, bare: true)
            }
        }.frame(maxWidth: .infinity)
    }
}

struct ApprovalsCard: View {
    @Environment(GroupModel.self) private var model
    let list: [Session]
    var body: some View {
        Card(highlight: true) {
            Text("Needs your approval").font(.nativeHeadline)
            Text("Open each request to check recipients, amounts, memos and fees before approving.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
            ForEach(list) { ss in SentRow(ss: ss) }
        }
    }
}

struct BalanceCard: View {
    @Environment(GroupModel.self) private var model
    @State private var expanded = false
    var body: some View {
        let b = model.balanceNow()
        Card {
            AdaptiveRow {
                Label("Zcash", systemImage: "shield.lefthalf.filled").font(.nativeHeadline)
                Badge(text: model.state.net.label)
                Badge(text: "Shielded", kind: .ok)
            }
            if let b { Money(zat: b.spendable + b.pending, size: 30) }
            else { Text("Balance unavailable").font(.title3).foregroundStyle(Color.mist) }
            if let b, b.pending > 0 { Text("Incoming · " + zec(b.pending)).font(.nativeCaption).foregroundStyle(Color.mist) }
            if let b, b.sending > 0 { Text("Sending · " + zec(b.sending) + " · waiting for a block").font(.nativeCaption).foregroundStyle(Color.mist) }
            SyncLine()
            DisclosureGroup("Balance and privacy details", isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 12) {
                    if let b {
                        Detail(label: "Available") { Money(zat: b.spendable, size: 17) }
                        Detail(label: "Incoming") { Money(zat: b.pending, size: 17) }
                    } else { Text("Sync the wallet to read its balance. An unavailable balance is not zero.") }
                    Text("ZEC balances are shielded. This app has no transparent balance or Shield / Unshield transfer.")
                        .font(.nativeCaption).foregroundStyle(Color.mist)
                    if let b, b.spendable + b.pending + b.sending == 0, model.state.movedTo == nil {
                        Text(model.state.net.cap.map { "This wallet is empty. Share its address to receive ZEC. At \(capText($0)) the app warns and hides the address." }
                            ?? "This wallet is empty. Share its address to receive ZEC, or get free testnet ZEC from a faucet.")
                            .font(.nativeCaption).foregroundStyle(Color.mist)
                    }
                    Button("Refresh balance", systemImage: "arrow.clockwise") { Task { await model.chain?.sync() } }
                        .disabled(model.chain == nil || model.chain?.syncing == true)
                    if let faucet = model.state.net.faucet { Link("Get testnet ZEC from a faucet", destination: faucet) }
                }.padding(.top, 12)
            }.font(.nativeSubheadline).tint(.mist)
            if model.atCap { CapNote() }
        }
    }
}

struct SyncLine: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        if let c = model.chain {
            let pct = Self.fraction(c)
            let status = Self.status(c, pct)
            VStack(alignment: .leading, spacing: 6) {
                if c.syncing, c.progress != nil { ProgressView(value: pct) }
                HStack(spacing: 6) {
                    Circle().fill(status.color).frame(width: 7, height: 7)
                    Text(status.text).font(.nativeCaption).foregroundStyle(Color.mist)
                }
                if status.failed, let e = c.error { Text(e).font(.nativeCaption).foregroundStyle(Color.bad) }
            }
        } else {
            Text("Sync starts after your seat checks the address.").font(.nativeCaption).foregroundStyle(Color.mist)
        }
    }

    /// The share of the blocks since the birthday of the wallet that the sync has read.
    private static func fraction(_ c: Chain) -> Double {
        guard let p = c.progress, p.tip > c.birthday else { return 0 }
        return Double(p.height - c.birthday) / Double(p.tip - c.birthday)
    }

    /// What the line says, and the colour of its dot. Progress that is left while no sync runs
    /// means that a sync stopped before the last block.
    private static func status(_ c: Chain, _ pct: Double) -> (text: String, color: Color, failed: Bool) {
        if !c.syncing, c.error != nil { return ("Sync failed", .bad, true) }
        if c.syncing {
            let text = c.progress != nil ? "Syncing · \(Int(pct * 100))%" : "Connecting to the network…"
            return (text, .signal, false)
        }
        if let p = c.progress { return ("Sync paused at block \(p.height.formatted())", .signal, false) }
        return ("Up to date · block \((c.balance?.int("height") ?? 0).formatted())", .good, false)
    }
}

struct SignersCard: View {
    @Environment(GroupModel.self) private var model
    let manage: () -> Void

    var body: some View {
        let st = model.state
        Card {
            HStack { Text("Signers").font(.nativeHeadline); Spacer(); Button("Manage", action: manage).font(.nativeSubheadline) }
            TipView(SignersTip())
            Text(ruleText(st.t, st.n)).font(.nativeCaption).foregroundStyle(Color.mist)
            FlowRow(items: st.seatIds) { i in
                HStack(spacing: 6) { SeatAvatar(i: i, size: 26); Text(model.seatLabel(i)).font(.nativeSubheadline) }
            }
        }
    }
}

/// Lays items out in rows that wrap.
struct FlowRow<Item: Hashable, V: View>: View {
    let items: [Item]
    @ViewBuilder let content: (Item) -> V

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { content($0) }
        }
    }
}

// MARK: Move to a new wallet

/// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
struct MoveCard: View {
    @Environment(GroupModel.self) private var model
    @State private var working = false

    var body: some View {
        let m = state()
        let started = model.state.sessions.contains { $0.doc.str("move") == model.state.movedTo && !has($0.doc["error"]) }
        Card(highlight: !m.done) {
            HStack { Text(m.done ? "This wallet moved" : "Changing signers").font(.nativeHeadline); Spacer(); if m.done { Badge(text: "Closed") } }
            Text(m.text).font(.nativeSubheadline).foregroundStyle(Color.mist)
            if m.propose {
                Button("Move \(zec(model.maxSend))") { run { try await model.proposeMove() } }
                    .primaryButton().disabled(model.sendBlocker != nil || working)
                if let why = model.sendBlocker { Text(why).font(.nativeCaption).foregroundStyle(Color.mist) }
            }
            if let ss = m.session {
                NavigationLink { SessionView(sid: ss.id) } label: { Text("Open the payment") }.primaryButton()
            }
            if let open = m.open {
                Button("Open \(model.groupName(open))") { model.path = [open] }.buttonStyle(InstrumentButtonStyle())
            }
            if !started {
                Button("Cancel move", role: .destructive) { run { try await model.cancelMove() } }.font(.nativeSubheadline)
            }
        }
    }

    private func run(_ op: @escaping @MainActor () async throws -> Void) {
        working = true
        Task { do { try await op() } catch { model.banner = error.localizedDescription }; working = false }
    }

    private func state() -> (text: String, open: String?, session: Session?, propose: Bool, done: Bool) {
        guard let to = model.state.movedTo else { return ("", nil, nil, false, false) }
        let name = model.groupName(to)
        let ss = model.state.sessions.first { $0.doc.str("move") == to && !has($0.doc["error"]) }
        let b = model.balanceNow()
        if model.vault.keys[to] == nil {
            return ("A signer started moving this wallet to a new one. If you are one of its signers, ask them for its invite link.", nil, nil, false, false)
        }
        if model.wallets[to] == nil { return ("\(name) is still setting up. When its address is ready, move the funds here.", to, nil, false, false) }
        if let ss, !has(ss.doc["broadcastTxid"]) {
            return ("Moving the funds to \(name) is in progress. Open the payment to approve it or take the next step.", nil, ss, false, false)
        }
        if let ss, model.inFlight.contains(where: { $0.id == ss.id }) {
            return ("The funds are on their way to \(name). They arrive with the next block.", to, nil, false, false)
        }
        if ss != nil, let b, b.spendable + b.pending == 0 { return ("All funds moved to \(name). This wallet is closed.", to, nil, false, true) }
        return ("\(name) is ready. Move all funds to it. Like any payment, this needs \(model.state.t) approvals.", nil, nil, true, false)
    }
}

// MARK: Activity

struct ActivityList: View {
    @Environment(GroupModel.self) private var model
    let limit: Int?
    var bare = false

    var body: some View {
        let items = activity()
        let shown = limit.map { Array(items.prefix($0)) } ?? items
        let list = VStack(spacing: 10) {
            if shown.isEmpty {
                InstrumentEmptyState(symbol: "arrow.down.left.arrow.up.right", title: "No activity yet",
                    detail: "Money you receive and payments that signers propose show up here.")
            }
            ForEach(shown, id: \.id) { a in
                if let ss = a.ss { SentRow(ss: ss) } else if let r = a.r { ReceivedRow(r: r) }
            }
        }
        if bare { list } else { Card { Text("Transaction history").font(.nativeHeadline); list } }
    }

    /// Received payments carry only a block height; estimate a time so they sort among proposals.
    private func activity() -> [(id: String, t: Int, ss: Session?, r: Doc?)] {
        let tip = model.chain?.balance?.int("height") ?? 0
        let sent = model.state.sessions.map { (id: $0.id, t: $0.doc.int("createdAt") ?? 0, ss: Optional($0), r: Doc?.none) }
        let got = (model.chain?.received ?? []).map { r in
            (id: r.str("txid") ?? UUID().uuidString, t: now() - max(0, tip - (r.int("height") ?? 0)) * 25_000,
             ss: Session?.none, r: Optional(r))
        }
        return (sent + got).sorted { $0.t > $1.t }
    }
}

let statusLabels: [String: (String, BadgeKind)] = [
    "collecting": ("Needs approval", .warn), "signing": ("Signing", .info), "signed": ("Ready to prove", .info),
    "proving": ("Building proof", .info), "complete": ("Ready to send", .ok), "broadcast": ("Sent", .ok), "failed": ("Failed", .bad),
    "cancelled": ("Cancelled", .plain),
]

func payTitle(_ ss: Session) -> String {
    let payees = ss.doc["payees"] as? [Doc] ?? []
    if let note = ss.doc.str("note") { return note }
    if payees.count > 1 { return "Payment to \(payees.count) recipients" }
    return payees.first?.str("to").map { "Payment to \(short($0, 6))" } ?? "Payment"
}

/// Most recipients in one payment; the engine enforces the same limit.
let maxPayees = 20

/// ZIP 317 estimate for a payment to `payees` recipients: one action per output, change included.
func feeEstimate(_ payees: Int) -> Int { 5_000 * max(2, payees + 1) }

/// The Zcash supply limit, 21 million ZEC, in zatoshis.
let maxMoney = 2_100_000_000_000_000

/// "1.5" or "1,5" -> 150_000_000 zatoshis. Nil unless it is a positive amount, at most `maxMoney`,
/// with at most 8 decimals.
func zatOf(_ s: String) -> Int? {
    let t = s.trimmingCharacters(in: .whitespaces)
    guard let m = t.wholeMatch(of: /([0-9]{1,8})(?:[.,]([0-9]{1,8}))?/) else { return nil }
    let frac = String(m.2 ?? "").padding(toLength: 8, withPad: "0", startingAt: 0)
    let zat = Int(m.1)! * 100_000_000 + Int(frac)!
    return zat > 0 && zat <= maxMoney ? zat : nil
}

/// Reads a pasted payment list: one "address, amount in ZEC" per line. A spreadsheet copy works:
/// tab, comma, semicolon or spaces may separate the two. If the first line that is not empty names
/// "address", it is a header. `parsePayeeList` in web/payees.js also takes a memo column. This
/// function takes two fields only, so it refuses a line with a memo. A decimal comma is a third
/// field here, so it is refused too.
func parsePayeeList(_ text: String) -> (rows: [(to: String, amount: Int)], errors: [String]) {
    var rows: [(to: String, amount: Int)] = [], errors: [String] = [], first = true
    for (i, raw) in text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).enumerated() {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty { continue }
        defer { first = false }
        if first && line.lowercased().contains("address") { continue }
        let f = line.split(whereSeparator: { $0.isWhitespace || ",;".contains($0) })
        if f.count == 2, let zat = zatOf(String(f[1])) { rows.append((String(f[0]), zat)) }
        else { errors.append("Line \(i + 1): write an address and an amount, like u1…, 0.5") }
    }
    return (rows, errors)
}

struct SentRow: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        let status = statusLabels[ss.status] ?? (ss.status, .plain)
        let mine = model.gid.map { model.needsMyApproval($0, ss) } ?? false
        let confirming = model.inFlight.contains(where: { $0.id == ss.id })
        NavigationLink { SessionView(sid: ss.id) } label: {
            NativeTransactionSummary(title: payTitle(ss), detail: when(ss.doc.int("createdAt")),
                amount: ss.amount, status: mine ? "Your approval" : confirming ? "Confirming" : status.0,
                kind: mine ? .warn : confirming ? .info : status.1)
        }.buttonStyle(.plain)
    }
}

struct ReceivedRow: View {
    @Environment(GroupModel.self) private var model
    let r: Doc

    var body: some View {
        let explorer = model.state.net.explorer
        let link = URL(string: explorer + (r.str("txid") ?? ""))
        Link(destination: link ?? URL(string: explorer)!) {
            NativeTransactionSummary(title: "Received", detail: "Block \((r.int("height") ?? 0).formatted()) · opens explorer",
                amount: r.int("value") ?? 0, incoming: true,
                status: has(r["confirmed"]) ? "Confirmed" : "Confirming", kind: has(r["confirmed"]) ? .ok : .info)
        }.buttonStyle(.plain)
    }
}

// MARK: Signers

struct SignersTab: View {
    @Environment(GroupModel.self) private var model
    let change: () -> Void
    @State private var showQR = false

    var body: some View {
        let st = model.state
        VStack(spacing: 16) {
            Card {
                Text("Signers").font(.nativeHeadline)
                Text(ruleText(st.t, st.n)).font(.nativeCaption).foregroundStyle(Color.mist)
                ForEach(st.seatIds, id: \.self) { i in
                    let v = st.verify["\(i)"]
                    HStack(spacing: 12) {
                        SeatAvatar(i: i, size: 38)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.seatLabel(i)).font(.nativeSubheadline.weight(.medium))
                            Text("Seat \(i)" + (st.seats["\(i)"].map { " · joined \(when($0.int("at")))" } ?? ""))
                                .font(.nativeCaption).foregroundStyle(Color.mist)
                        }
                        Spacer()
                        if let v {
                            Badge(text: has(v["ok"]) ? "Address checked" : "Rejected address", kind: has(v["ok"]) ? .ok : .bad)
                        } else {
                            Badge(text: stageLabels[st.stage(i)])
                        }
                    }
                }
            }
            BackupCard()
            Card {
                Text("Add or remove signers").font(.nativeHeadline)
                TipView(ChangeSignersTip())
                Text("The signers and the approval rule are part of the wallet key, so they cannot change in place. To change them, create a new wallet with the signers you want, then move the funds to it.")
                    .font(.nativeSubheadline).foregroundStyle(Color.mist)
                if st.movedTo != nil {
                    Text("A move to a new wallet has started. See Overview.").font(.nativeSubheadline)
                } else {
                    Button("Change signers", action: change).buttonStyle(InstrumentButtonStyle()).disabled(model.localSeats.isEmpty)
                }
            }
            if let gid = model.gid {
                Card {
                    Text("Wallet link").font(.nativeHeadline)
                    Text("Send this link to signers so they can open the wallet. The link contains the wallet secret, so share it only with signers.")
                        .font(.nativeSubheadline).foregroundStyle(Color.mist)
                    CopyButton(text: model.inviteLink(gid), label: "Copy link").buttonStyle(InstrumentButtonStyle())
                    DisclosureGroup("Show QR code", isExpanded: $showQR) {
                        QRCode(text: model.inviteLink(gid)).frame(maxWidth: 240).frame(maxWidth: .infinity)
                    }
                    .font(.nativeSubheadline)
                }
            }
        }
    }
}

// MARK: Details

struct DetailsTab: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state, w = st.wallet ?? [:]
        VStack(spacing: 16) {
            Card {
                Text("Wallet").font(.nativeHeadline)
                Detail(label: "Address") {
                    if model.addressHidden {
                        Text("Shown after your seat checks it against your key share.")
                            .font(.nativeCaption).foregroundStyle(Color.mist)
                    } else {
                        Text(grouped(w.str("address") ?? "")).font(.nativeCaption.monospaced())
                        CopyButton(text: w.str("address") ?? "", label: "Copy address").font(.nativeSubheadline)
                    }
                }
                Detail(label: "Approval rule") { Text("Any \(st.t) of \(st.n) signers") }
                Detail(label: "Checked by") { Text("\(st.verifiedCount) of \(st.n) signers") }
                Detail(label: "Network") { Text("Zcash \(st.net.label.lowercased())" + (st.net.cap.map { " · warning at \(capText($0))" } ?? "")) }
                Detail(label: "Created at block") { Text((w.int("birthday") ?? 0).formatted()).monospacedDigit() }
                Detail(label: "Wallet key") { Text(w.str("group_verifying_key") ?? "").font(.nativeCaption.monospaced()).textSelection(.enabled) }
                if usesV2(st.version) {
                    Detail(label: "Key setup") {
                        Text("Built to ZIP 2005 (Proposed) so that funds can be recovered if quantum computers break today's keys.")
                    }
                    if model.isSigned {
                        Detail(label: "Signed writes") {
                            Text("Each signer signs the data it writes to this wallet. "
                                 + "Zigs ignores data without a valid signature.")
                        }
                    }
                } else {
                    Text("This wallet was made before quantum recoverability (ZIP 2005). To get it, move the funds to a new wallet with Change signers.")
                        .font(.nativeCaption).foregroundStyle(Color.mist)
                }
            }
            Card {
                Text("Privacy and keys").font(.nativeHeadline)
                Text("Your key share is created and used on this \(deviceName) only. The group server stores encrypted data it cannot read. This app downloads blocks from \(model.chain?.server?.host ?? "a light-wallet server"), which sees your IP address but never a key.")
                    .font(.nativeSubheadline).foregroundStyle(Color.mist)
                DisclosureGroup("Viewing key") {
                    Text(w.str("ufvk") ?? "").font(.nativeCaption.monospaced()).textSelection(.enabled)
                    CopyButton(text: w.str("ufvk") ?? "", label: "Copy viewing key").font(.nativeSubheadline)
                }
                .font(.nativeSubheadline)
                Text("The viewing key shows every payment of this wallet. Share it only with people who may see your balance.")
                    .font(.nativeCaption).foregroundStyle(Color.mist)
                DisclosureGroup("Activity on this \(deviceName)") {
                    ForEach(model.log, id: \.self) { Text($0).font(.caption2.monospaced()).foregroundStyle(Color.mist) }
                }
                .font(.nativeSubheadline)
            }
        }
    }
}

struct CapNote: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        Text("This wallet has reached the \(capText(model.state.net.cap ?? 0)) warning level for unaudited mainnet wallets. Do not send more to it. Payments out still work.")
            .font(.nativeSubheadline).foregroundStyle(Color.bad)
    }
}

struct Detail<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: label)
            content.font(.nativeSubheadline)
        }
    }
}

// MARK: Receive and send

struct ReceiveSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let address = model.state.wallet?.str("address") ?? ""
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Text(model.state.name).font(.nativeHeadline)
                    Badge(text: model.state.net.label)
                    if let to = model.state.movedTo {
                        Text("This wallet moved to \(model.groupName(to)). Ask senders to use the new wallet's address.")
                            .font(.nativeSubheadline).foregroundStyle(Color.signal)
                    }
                    let net = model.state.net
                    if model.atCap {
                        CapNote()
                    } else if model.addressHidden {
                        Text("Your seat is still checking this address against your key share.")
                            .font(.nativeSubheadline).foregroundStyle(Color.mist)
                    } else {
                        Text("Send \(net.cap.map { "ZEC (the app warns at \(capText($0)))" } ?? "testnet ZEC") to this shielded address. Senders and the network cannot see the balance or who controls it.")
                            .font(.nativeSubheadline).foregroundStyle(Color.mist)
                        QRCode(text: address).frame(maxWidth: 260)
                        Text(grouped(address)).font(.nativeCaption.monospaced())
                        AdaptiveRow {
                            CopyButton(text: address, label: "Copy address").primaryButton()
                            ShareLink(item: address) { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(InstrumentButtonStyle())
                        }
                    }
                    if let faucet = net.faucet { Link("Get testnet ZEC from a faucet", destination: faucet).font(.nativeSubheadline) }
                }
                .padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }
            .instrumentScreen().nativeSheetSizing()
            .navigationTitle("Receive ZEC")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct SendSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var rows = [PayRow()]
    @State private var note = ""
    @State private var listError: String?
    @State private var working = false

    struct PayRow: Identifiable {
        let id = UUID()
        var to = ""
        var amount = ""
    }

    var body: some View {
        let sum = rows.reduce(0) { $0 + (zatOf($1.amount) ?? 0) }
        let ready = rows.allSatisfy { model.onNetwork($0.to.trimmingCharacters(in: .whitespacesAndNewlines)) && zatOf($0.amount) != nil }
        NavigationStack {
            Form {
                Section {
                    Text(model.state.name).font(.nativeHeadline)
                    Badge(text: model.state.net.label)
                }
                Section {
                    ForEach($rows) { $r in
                        RecipientRow(row: $r, showMax: rows.count == 1).deleteDisabled(rows.count == 1)
                    }
                    .onDelete { rows.remove(atOffsets: $0) }
                    Button("Add recipient", systemImage: "plus") { rows.append(PayRow()) }
                        .disabled(rows.count >= maxPayees)
                    PasteButton(payloadType: String.self) { s in Task { @MainActor in paste(s.first ?? "") } }
                } header: {
                    Text(rows.count > 1 ? "\(rows.count) recipients, one transaction" : "To")
                } footer: {
                    Text(listError ?? "Paste one address, or a list with one address and amount per line. A spreadsheet copy works.")
                        .foregroundStyle(listError == nil ? Color.mist : Color.bad)
                }
                Section {
                    TextField(rows.count > 1 ? "October payroll" : "Pay the audit firm", text: $note)
                } header: {
                    Text("Note for signers (optional)")
                } footer: {
                    Text("Encrypted. Only signers of this wallet can read it.")
                }
                Section {
                    LabeledContent("Available") {
                        if let balance = model.balanceNow() { Money(zat: balance.spendable, size: 15) }
                        else { Text("Unavailable").foregroundStyle(Color.mist) }
                    }
                    LabeledContent("Network fee (estimate)") { Money(zat: feeEstimate(rows.count), size: 15) }
                    LabeledContent("Total leaving the wallet") { Money(zat: sum + feeEstimate(rows.count), size: 15) }
                    LabeledContent("Approvals needed", value: "\(model.state.t) of \(model.state.n)")
                }
            }
            .instrumentScreen().nativeSheetSizing()
            .navigationTitle("Send ZEC")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Propose") { propose() }.disabled(working || !ready)
                }
            }
        }
    }

    /// One address goes into the first empty row. A list replaces every row.
    private func paste(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        listError = nil
        if !t.contains(where: { $0.isWhitespace || ",;".contains($0) }) {
            if let i = rows.firstIndex(where: { $0.to.isEmpty }) { rows[i].to = t; return }
            if rows.count >= maxPayees { listError = "A payment can have at most \(maxPayees) recipients."; return }
            rows.append(PayRow(to: t))
            return
        }
        let list = parsePayeeList(t)
        if let e = list.errors.first { listError = e; return }
        if list.rows.isEmpty || list.rows.count > maxPayees { listError = "Paste 1 to \(maxPayees) lines."; return }
        rows = list.rows.map { PayRow(to: $0.to, amount: zecText($0.amount)) }
    }

    private func propose() {
        working = true
        Task {
            do {
                let payees = rows.map { (to: $0.to.trimmingCharacters(in: .whitespacesAndNewlines), amount: zatOf($0.amount) ?? 0) }
                let own = model.state.wallet?.str("address").flatMap { model.normalized($0) }
                if let own, let i = payees.firstIndex(where: { model.normalized($0.to) == own }) {
                    throw ZigsError("Recipient \(i + 1) is the address of this wallet. Enter the address of someone else.")
                }
                let need = payees.reduce(0) { $0 + $1.amount } + feeEstimate(payees.count)
                let available = model.balanceNow()?.spendable ?? 0
                if need > available { throw ZigsError("Not enough funds: \(zec(available)) available, \(zec(need)) needed (amounts + fee).") }
                let n = note.trimmingCharacters(in: .whitespaces)
                try await model.propose(payees: payees, note: n.isEmpty ? nil : n)
                dismiss()
            } catch {
                model.banner = error.localizedDescription
            }
            working = false
        }
    }
}

/// 150_000_000 -> "1.5", for an amount field.
func zecText(_ zat: Int) -> String {
    (Double(zat) / 1e8).formatted(.number.precision(.fractionLength(0...8)).grouping(.never).locale(Locale(identifier: "en_US")))
}

/// One recipient of a payment: address, amount, and whether the address fits this wallet's network.
struct RecipientRow: View {
    @Environment(GroupModel.self) private var model
    @Binding var row: SendSheet.PayRow
    let showMax: Bool
    @State private var choosingRecipient = false

    var body: some View {
        let net = model.state.net
        let to = row.to.trimmingCharacters(in: .whitespacesAndNewlines)
        VStack(alignment: .leading, spacing: 8) {
            Button("Choose saved recipient", systemImage: "person.crop.rectangle.stack") { choosingRecipient = true }
                .font(.nativeSubheadline)
            // One line: a wrapped field breaks the address with hyphens that look like part of it.
            TextField("\(net.prefix)…", text: $row.to)
                .font(.nativeBody.monospaced()).codeEntry()
                .accessibilityLabel("Recipient address")
            HStack {
                TextField("0.00", text: $row.amount).decimalEntry().font(.title3.monospacedDigit())
                    .accessibilityLabel("Amount in ZEC")
                Text("ZEC").foregroundStyle(Color.mist)
                if showMax {
                    Button("Max") { row.amount = zecText(model.maxSend) }.buttonStyle(InstrumentButtonStyle())
                }
            }
            if !to.isEmpty {
                let ok = model.onNetwork(to)
                Text(ok ? "Valid \(net.label.lowercased()) address" : "Not a shielded Zcash \(net.label.lowercased()) address. It starts with \(net.prefix).")
                    .font(.nativeCaption).foregroundStyle(ok ? Color.good : Color.bad)
                if ok {
                    Text(grouped(to)).font(.nativeCaption.monospaced()).foregroundStyle(Color.mist).textSelection(.enabled)
                }
            }
        }
        .sheet(isPresented: $choosingRecipient) {
            RecipientPicker(network: model.state.netName) { recipient in
                row.to = recipient.address
            }
        }
    }
}

/// Notes for a version 3 wallet: a seat of this device that cannot sign, and ignored data.
struct SignedNotes: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let muted = model.mutedSeats
        if !muted.isEmpty {
            let seats = muted.map(String.init).joined(separator: ", ")
            Text("This \(deviceName) has no signing key for seat \(seats), "
                 + "so it cannot write to this wallet. Restore a backup of the seat.")
                .font(.nativeSubheadline).foregroundStyle(Color.bad)
        }
        if model.state.shapeMoved {
            Text("The store shows another number of signers or approval rule than the first this "
                 + "\(deviceName) saw. Zigs keeps the first. Ask your signers.")
                .font(.nativeSubheadline).foregroundStyle(Color.bad)
        }
        if model.ignoredCount > 0 {
            Text(Signed.ignoredNote).font(.nativeCaption).foregroundStyle(Color.mist)
        }
    }
}

/// A restored seat that does not fit the wallet, with a way to remove this device's copy.
struct StaleRestoreNote: View {
    @Environment(GroupModel.self) private var model
    @State private var asking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(BackupText.staleRestore).font(.nativeSubheadline).foregroundStyle(Color.bad)
            Button("Remove from this device", role: .destructive) { asking = true }
                .confirmationDialog("Remove this seat from this device?", isPresented: $asking, titleVisibility: .visible) {
                    Button("Remove", role: .destructive) { model.dropStaleRestores() }
                } message: {
                    Text("Do this only if you will restore the right backup.")
                }
        }
    }
}
