import SwiftUI
import TipKit

struct GroupView: View {
    @Environment(GroupModel.self) private var model
    @State private var tab = Tab.overview
    @State private var sheet: WalletSheet?

    enum Tab: String, CaseIterable { case overview = "Overview", activity = "Activity", signers = "Signers", details = "Details" }
    enum WalletSheet: String, Identifiable {
        case send, receive, change
        var id: String { rawValue }
    }

    var body: some View {
        let st = model.state
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Header()
                if st.g == nil {
                    ProgressView("Loading the wallet…").frame(maxWidth: .infinity).padding(.top, 40)
                } else if !st.ready {
                    SetupView()
                } else {
                    Picker("Section", selection: $tab) {
                        ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    switch tab {
                    case .overview: OverviewTab(showSigners: { tab = .signers }, showActivity: { tab = .activity })
                    case .activity: ActivityList(limit: nil)
                    case .signers: SignersTab(change: { sheet = .change })
                    case .details: DetailsTab()
                    }
                }
            }
            .padding(16)
        }
        .background(Color.night)
        .navigationTitle(st.name)
        .inlineTitle()
        .refreshable { await model.chain?.sync() }
        .safeAreaInset(edge: .bottom) {
            if st.ready {
                HStack(spacing: 12) {
                    Button { sheet = .receive } label: { Label("Receive", systemImage: "arrow.down").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered).controlSize(.large)
                    Button { sheet = .send } label: { Label("Send", systemImage: "arrow.up").frame(maxWidth: .infinity) }
                        .primaryButton().disabled(model.sendBlocker != nil)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(.ultraThinMaterial)
            }
        }
        .sheet(item: $sheet) { s in
            switch s {
            case .send: SendSheet()
            case .receive: ReceiveSheet()
            case .change: CreateSheet(from: model.state)
            }
        }
        // New testnet blocks come about every 25 s: refresh the open wallet once a minute.
        .task(id: model.chain?.gid) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await model.chain?.sync()
            }
        }
        .modifier(Banners())
    }
}

struct Header: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state
        VStack(alignment: .leading, spacing: 8) {
            Text(st.name).font(.largeTitle.weight(.bold))
            HStack(spacing: 8) {
                Badge(text: "\(st.t) of \(st.n) signers must approve", kind: .warn)
                    .popoverTip(RuleTip())
                HStack(spacing: -8) {
                    ForEach(st.seatIds, id: \.self) { i in SeatAvatar(i: i, size: 24) }
                }
            }
            Text("\(st.seatedCount) of \(st.n) signers joined"
                 + (st.movedFrom.map { " · Replaces \(model.groupName($0))" } ?? ""))
                .font(.caption).foregroundStyle(Color.mist)
        }
    }
}

struct SeatAvatar: View {
    @Environment(GroupModel.self) private var model
    let i: Int
    var size: CGFloat = 32

    var body: some View {
        let s = model.state.seats["\(i)"]
        let mine = s?.str("uid") == model.me
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
        VStack(spacing: 16) {
            if model.localSeats.isEmpty, let first = open.first {
                Card(highlight: true) {
                    Text("Join \(st.name)").font(.title3.weight(.semibold))
                    Text("Take a seat to become a signer. Your iPhone creates its own piece of the wallet key; it never leaves this device.")
                        .font(.subheadline).foregroundStyle(Color.mist)
                    Button("Take seat \(first)") { model.takeSeat(first) }.primaryButton()
                }
            } else if !open.isEmpty, let gid = model.gid {
                InviteCard(link: model.inviteLink(gid), open: open.count)
            }
            ProgressCard()
            Card {
                HStack { Text("Seats").font(.headline); Spacer(); Text("\(st.t) of \(st.n) must approve").font(.caption).foregroundStyle(Color.mist) }
                ForEach(st.seatIds, id: \.self) { i in
                    HStack(spacing: 12) {
                        SeatAvatar(i: i)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.seatLabel(i)).font(.subheadline.weight(.medium))
                            Text("Seat \(i)").font(.caption).foregroundStyle(Color.mist)
                        }
                        Spacer()
                        Badge(text: stageLabels[st.stage(i)], kind: st.stage(i) == 5 ? .ok : st.seats["\(i)"] == nil ? .plain : .info)
                    }
                }
                if !model.localSeats.isEmpty && !open.isEmpty {
                    DisclosureGroup("Testing: play another seat on this iPhone") {
                        Text("Only for trying Zigs alone. A real signer takes a seat on their own device.")
                            .font(.caption).foregroundStyle(Color.mist)
                        ForEach(open, id: \.self) { i in Button("Play seat \(i)") { model.takeSeat(i) } }
                    }
                    .font(.subheadline)
                }
            }
        }
    }
}

struct InviteCard: View {
    let link: String
    let open: Int
    @State private var showQR = false

    var body: some View {
        Card(highlight: true) {
            HStack { Text("Invite your signers").font(.title3.weight(.semibold)); Spacer(); Badge(text: open == 1 ? "1 seat open" : "\(open) seats open", kind: .warn) }
            Text("Send this link to each signer through a private channel. It contains the wallet's secret: anyone who has it can take an open seat.")
                .font(.subheadline).foregroundStyle(Color.mist)
            Text(link).font(.caption.monospaced()).lineLimit(2).truncationMode(.middle)
            HStack {
                ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }.primaryButton()
                CopyButton(text: link, label: "Copy link").buttonStyle(.bordered).controlSize(.large)
            }
            DisclosureGroup("Show QR code", isExpanded: $showQR) {
                QRCode(text: link).frame(maxWidth: 240).frame(maxWidth: .infinity)
            }
            .font(.subheadline)
        }
    }
}

struct ProgressCard: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state, n = st.n
        let r1 = st.dkg1.count, r2 = st.dkg2.count, d = st.done.count, ver = st.verifiedCount
        let mismatch = st.allDone && !st.keysAgree
        let keyText = mismatch ? "Signers computed different keys. Create a new wallet."
            : d == n ? "Each signer holds one piece. The full key never existed."
            : r1 == n ? "Devices are exchanging encrypted shares (\(r2) of \(n * (n - 1)))…"
            : st.allSeated ? "Devices are publishing their commitments (\(r1) of \(n))…" : "Starts when every seat is taken."
        let rejected = st.rejectedSeats
        let addrText = !rejected.isEmpty ? "Seat \(rejected.map(String.init).joined(separator: ", ")) rejected the address. Do not use this wallet."
            : st.wallet == nil ? (d == n ? "Building the shared address…" : "Comes after the key.")
            : "\(ver) of \(n) signers checked that the address belongs to the group key."
        Card {
            Text("Setting up your wallet").font(.headline)
            Step(state: st.allSeated ? .done : .now, no: 1, title: "Signers join", text: "\(st.seatedCount) of \(n) seats taken.")
            Step(state: mismatch ? .bad : d == n ? .done : st.allSeated ? .now : .later, no: 2, title: "Create the key together", text: keyText)
            Step(state: !rejected.isEmpty ? .bad : st.wallet != nil && ver == n ? .done : d == n ? .now : .later, no: 3,
                 title: "Check the address", text: addrText)
        }
    }
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
                Text(state == .done ? "✓" : state == .bad ? "!" : "\(no)").font(.caption.weight(.bold))
                    .foregroundStyle(state == .done ? Color.good : state == .bad ? Color.bad : state == .now ? Color.signal : Color.mist)
            }
            .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.caption).foregroundStyle(Color.mist)
            }
        }
    }
}

// MARK: Overview

struct OverviewTab: View {
    @Environment(GroupModel.self) private var model
    let showSigners: () -> Void
    let showActivity: () -> Void

    var body: some View {
        let gid = model.gid ?? ""
        let pending = model.state.sessions.filter { model.needsMyApproval(gid, $0) }
        VStack(spacing: 16) {
            if model.state.movedTo != nil { MoveCard() }
            if !pending.isEmpty { ApprovalsCard(list: pending) }
            BalanceCard()
            SignersCard(manage: showSigners)
            Card {
                HStack {
                    Text("Activity").font(.headline)
                    Spacer()
                    Button("View all", action: showActivity).font(.subheadline)
                }
                ActivityList(limit: 5, bare: true)
            }
        }
    }
}

struct ApprovalsCard: View {
    let list: [Session]

    var body: some View {
        Card(highlight: true) {
            Text(list.count == 1 ? "A payment needs your approval" : "\(list.count) payments need your approval").font(.headline)
            ForEach(list) { ss in SentRow(ss: ss) }
        }
    }
}

struct BalanceCard: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let b = model.balanceNow()
        Card {
            SectionLabel(text: "Balance")
            if let b {
                Money(zat: b.spendable + b.pending, size: 40)
            } else {
                RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.06)).frame(width: 180, height: 44)
                    .accessibilityLabel("Loading balance")
            }
            HStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 4) { SectionLabel(text: "Available"); Money(zat: b?.spendable ?? 0, size: 15) }
                VStack(alignment: .leading, spacing: 4) { SectionLabel(text: "Incoming"); Money(zat: b?.pending ?? 0, size: 15) }
            }
            if let b, b.sending > 0 {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Sending").font(.caption)
                    Money(zat: b.sending, size: 13, sign: "out")
                    Text("· waiting for a block").font(.caption).foregroundStyle(Color.mist)
                }
            }
            if let b, b.spendable + b.pending + b.sending == 0, model.state.movedTo == nil {
                Text("This wallet is empty. Share its address to receive ZEC, or get free testnet ZEC from a faucet.")
                    .font(.caption).foregroundStyle(Color.mist)
            }
            SyncLine()
        }
    }
}

struct SyncLine: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        if let c = model.chain {
            let birthday = c.birthday
            let p = c.progress
            let pct = p.map { $0.tip > birthday ? Double($0.height - birthday) / Double($0.tip - birthday) : 0 } ?? 0
            VStack(alignment: .leading, spacing: 6) {
                if c.syncing, p != nil { ProgressView(value: pct) }
                HStack(spacing: 6) {
                    Circle().fill(c.error != nil ? Color.bad : c.syncing ? Color.signal : Color.good).frame(width: 7, height: 7)
                    Text(c.error != nil ? "Sync failed"
                         : c.syncing ? (p != nil ? "Syncing · \(Int(pct * 100))%" : "Connecting to the network…")
                         : "Up to date · block \((c.balance?.int("height") ?? 0).formatted())")
                        .font(.caption).foregroundStyle(Color.mist)
                }
                if let e = c.error { Text(e).font(.caption).foregroundStyle(Color.bad) }
            }
        } else {
            Text("Sync starts after your seat checks the address.").font(.caption).foregroundStyle(Color.mist)
        }
    }
}

struct SignersCard: View {
    @Environment(GroupModel.self) private var model
    let manage: () -> Void

    var body: some View {
        let st = model.state
        Card {
            HStack { Text("Signers").font(.headline); Spacer(); Button("Manage", action: manage).font(.subheadline) }
            TipView(SignersTip())
            Text(ruleText(st.t, st.n)).font(.caption).foregroundStyle(Color.mist)
            FlowRow(items: st.seatIds) { i in
                HStack(spacing: 6) { SeatAvatar(i: i, size: 26); Text(model.seatLabel(i)).font(.subheadline) }
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
        let started = model.state.sessions.contains { $0.doc.str("move") == model.state.movedTo && $0.status != "failed" }
        Card(highlight: !m.done) {
            HStack { Text(m.done ? "This wallet moved" : "Changing signers").font(.headline); Spacer(); if m.done { Badge(text: "Closed") } }
            Text(m.text).font(.subheadline).foregroundStyle(Color.mist)
            if m.propose {
                Button("Move \(zec(model.maxSend))") { run { try await model.proposeMove() } }
                    .primaryButton().disabled(model.sendBlocker != nil || working)
                if let why = model.sendBlocker { Text(why).font(.caption).foregroundStyle(Color.mist) }
            }
            if let ss = m.session {
                NavigationLink { SessionView(sid: ss.id) } label: { Text("Open the payment") }.primaryButton()
            }
            if let open = m.open {
                Button("Open \(model.groupName(open))") { model.path = [open] }.buttonStyle(.bordered)
            }
            if !started {
                Button("Cancel move", role: .destructive) { run { try await model.cancelMove() } }.font(.subheadline)
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
        let ss = model.state.sessions.first { $0.doc.str("move") == to && $0.status != "failed" }
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
                Text("Money you receive and payments your group proposes show up here.")
                    .font(.subheadline).foregroundStyle(Color.mist).frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(shown, id: \.id) { a in
                if let ss = a.ss { SentRow(ss: ss) } else if let r = a.r { ReceivedRow(r: r) }
            }
        }
        if bare { list } else { Card { Text("All activity").font(.headline); list } }
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
]

func payTitle(_ ss: Session) -> String {
    ss.doc.str("note") ?? ss.doc.str("to").map { "Payment to \(short($0, 8))" } ?? "Payment"
}

struct SentRow: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        NavigationLink { SessionView(sid: ss.id) } label: {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right").frame(width: 34, height: 34)
                    .background(Color.white.opacity(0.06), in: Circle()).foregroundStyle(Color.mist)
                VStack(alignment: .leading, spacing: 2) {
                    Text(payTitle(ss)).font(.subheadline.weight(.medium)).foregroundStyle(.white).lineLimit(1)
                    Text(when(ss.doc.int("createdAt"))).font(.caption).foregroundStyle(Color.mist)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Money(zat: ss.amount, size: 14, sign: "out")
                    if let gid = model.gid, model.needsMyApproval(gid, ss) {
                        Badge(text: "Your approval", kind: .warn)
                    } else if model.inFlight.contains(where: { $0.id == ss.id }) {
                        Badge(text: "Confirming", kind: .info)
                    } else {
                        let s = statusLabels[ss.status] ?? (ss.status, .plain)
                        Badge(text: s.0, kind: s.1)
                    }
                }
            }
        }
    }
}

struct ReceivedRow: View {
    let r: Doc

    var body: some View {
        let link = URL(string: explorerTx + (r.str("txid") ?? ""))
        Link(destination: link ?? URL(string: explorerTx)!) {
            HStack(spacing: 12) {
                Image(systemName: "arrow.down.left").frame(width: 34, height: 34)
                    .background(Color.good.opacity(0.15), in: Circle()).foregroundStyle(Color.good)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Received").font(.subheadline.weight(.medium)).foregroundStyle(.white)
                    Text("Block \((r.int("height") ?? 0).formatted())").font(.caption).foregroundStyle(Color.mist)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Money(zat: r.int("value") ?? 0, size: 14, sign: "in")
                    Badge(text: has(r["confirmed"]) ? "Confirmed" : "Confirming", kind: has(r["confirmed"]) ? .ok : .info)
                }
            }
        }
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
                Text("Signers").font(.headline)
                Text(ruleText(st.t, st.n)).font(.caption).foregroundStyle(Color.mist)
                ForEach(st.seatIds, id: \.self) { i in
                    let v = st.verify["\(i)"]
                    HStack(spacing: 12) {
                        SeatAvatar(i: i, size: 38)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.seatLabel(i)).font(.subheadline.weight(.medium))
                            Text("Seat \(i)" + (st.seats["\(i)"].map { " · joined \(when($0.int("at")))" } ?? ""))
                                .font(.caption).foregroundStyle(Color.mist)
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
            Card {
                Text("Add or remove signers").font(.headline)
                TipView(ChangeSignersTip())
                Text("The signers and the approval rule are part of the wallet key, so they cannot change in place. To change them, create a new wallet with the signers you want, then move the funds to it.")
                    .font(.subheadline).foregroundStyle(Color.mist)
                if st.movedTo != nil {
                    Text("A move to a new wallet has started. See Overview.").font(.subheadline)
                } else {
                    Button("Change signers", action: change).buttonStyle(.bordered).disabled(model.localSeats.isEmpty)
                }
            }
            if let gid = model.gid {
                Card {
                    Text("Wallet link").font(.headline)
                    Text("Signers open this wallet on another device with this link and their key backup. The link contains the wallet's secret, so share it only with signers.")
                        .font(.subheadline).foregroundStyle(Color.mist)
                    CopyButton(text: model.inviteLink(gid), label: "Copy link").buttonStyle(.bordered)
                    DisclosureGroup("Show QR code", isExpanded: $showQR) {
                        QRCode(text: model.inviteLink(gid)).frame(maxWidth: 240).frame(maxWidth: .infinity)
                    }
                    .font(.subheadline)
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
                Text("Wallet").font(.headline)
                Detail(label: "Address") {
                    Text(w.str("address") ?? "").font(.caption.monospaced()).textSelection(.enabled)
                    CopyButton(text: w.str("address") ?? "", label: "Copy address").font(.subheadline)
                }
                Detail(label: "Approval rule") { Text("Any \(st.t) of \(st.n) signers") }
                Detail(label: "Checked by") { Text("\(st.verifiedCount) of \(st.n) signers") }
                Detail(label: "Network") { Text("Zcash testnet") }
                Detail(label: "Created at block") { Text((w.int("birthday") ?? 0).formatted()).monospacedDigit() }
                Detail(label: "Group key") { Text(w.str("group_verifying_key") ?? "").font(.caption.monospaced()).textSelection(.enabled) }
            }
            Card {
                Text("Privacy and keys").font(.headline)
                Text("Your piece of the key is created and used on this iPhone only. The group server stores encrypted data it cannot read. This app downloads blocks from \(model.chain?.server?.host ?? "a light-wallet server"), which sees your IP address but never a key.")
                    .font(.subheadline).foregroundStyle(Color.mist)
                DisclosureGroup("Viewing key") {
                    Text(w.str("ufvk") ?? "").font(.caption.monospaced()).textSelection(.enabled)
                    CopyButton(text: w.str("ufvk") ?? "", label: "Copy viewing key").font(.subheadline)
                }
                .font(.subheadline)
                Text("The viewing key shows every payment of this wallet. Share it only with people who may see your balance.")
                    .font(.caption).foregroundStyle(Color.mist)
                DisclosureGroup("Activity on this iPhone") {
                    ForEach(model.log, id: \.self) { Text($0).font(.caption2.monospaced()).foregroundStyle(Color.mist) }
                }
                .font(.subheadline)
            }
        }
    }
}

struct Detail<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: label)
            content.font(.subheadline)
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
                VStack(spacing: 16) {
                    if let to = model.state.movedTo {
                        Text("This wallet moved to \(model.groupName(to)). Ask senders to use the new wallet's address.")
                            .font(.subheadline).foregroundStyle(Color.signal)
                    }
                    Text("Send testnet ZEC to this shielded address. Senders and the network cannot see the balance or who controls it.")
                        .font(.subheadline).foregroundStyle(Color.mist)
                    QRCode(text: address).frame(maxWidth: 260)
                    Text(address).font(.caption.monospaced()).textSelection(.enabled)
                    HStack {
                        CopyButton(text: address, label: "Copy address").primaryButton()
                        ShareLink(item: address) { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered).controlSize(.large)
                    }
                    Link("Get testnet ZEC from a faucet", destination: URL(string: "https://zcashfaucet.jinolabs.xyz/")!).font(.subheadline)
                }
                .padding(16)
            }
            .background(Color.night)
            .navigationTitle("Receive ZEC")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct SendSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var to = ""
    @State private var amount = ""
    @State private var note = ""
    @State private var working = false

    private static let feeEstimate = 10_000

    var body: some View {
        let zat = Int(((Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0) * 1e8).rounded())
        let valid = to.isEmpty ? nil : model.normalized(to.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
        let available = model.balanceNow()?.spendable ?? 0
        NavigationStack {
            Form {
                Section {
                    TextField("utest1…", text: $to, axis: .vertical)
                        .font(.body.monospaced()).codeEntry()
                    PasteButton(payloadType: String.self) { s in Task { @MainActor in to = s.first ?? "" } }
                } header: {
                    Text("To")
                } footer: {
                    if let valid {
                        Text(valid ? "Valid testnet address" : "Not a testnet unified address with an Orchard receiver")
                            .foregroundStyle(valid ? Color.good : Color.bad)
                    }
                }
                Section("Amount") {
                    HStack {
                        TextField("0.00", text: $amount).decimalEntry().font(.title3.monospacedDigit())
                        Text("ZEC").foregroundStyle(Color.mist)
                        Button("Max") { amount = (Double(model.maxSend) / 1e8).formatted(.number.precision(.fractionLength(0...8)).grouping(.never).locale(Locale(identifier: "en_US"))) }
                            .buttonStyle(.bordered)
                    }
                }
                Section {
                    TextField("Pay the audit firm", text: $note)
                } header: {
                    Text("Note for signers (optional)")
                } footer: {
                    Text("Encrypted. Only signers of this wallet can read it.")
                }
                Section {
                    LabeledContent("Available") { Money(zat: available, size: 15) }
                    LabeledContent("Network fee (estimate)") { Money(zat: Self.feeEstimate, size: 15) }
                    LabeledContent("Total leaving the wallet") { Money(zat: zat + Self.feeEstimate, size: 15) }
                    LabeledContent("Approvals needed", value: "\(model.state.t) of \(model.state.n)")
                }
            }
            .navigationTitle("Send ZEC")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Propose") { propose(zat) }.disabled(working || valid != true || zat <= 0)
                }
            }
        }
    }

    private func propose(_ zat: Int) {
        working = true
        Task {
            do {
                if zat > model.maxSend { throw ZigsError("Not enough funds: you can send at most \(zec(model.maxSend)).") }
                let n = note.trimmingCharacters(in: .whitespaces)
                try await model.propose(to: to.trimmingCharacters(in: .whitespacesAndNewlines), amount: zat, note: n.isEmpty ? nil : n)
                dismiss()
            } catch {
                model.banner = error.localizedDescription
            }
            working = false
        }
    }
}
