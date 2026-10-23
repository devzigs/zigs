import SwiftUI

/// One payment: what it does, decoded on this iPhone, and the step that comes next.
struct SessionView: View {
    @Environment(GroupModel.self) private var model
    let sid: String
    @Environment(\.nativeHome) private var home

    var body: some View {
        content
            .onAppear { model.openPayment = sid }
            .onDisappear { if model.openPayment == sid { model.openPayment = nil } }
    }

    @ViewBuilder private var content: some View {
        if let ss = model.state.sessions.first(where: { $0.id == sid }) {
            let ins = model.inspect(ss)
            let rc = RecipientCheck(model: model, ss: ss, ins: try? ins.get())
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BalancePanel {
                        let fee = (try? ins.get()).map(networkFee)
                        SectionLabel(text: fee == nil ? "Payment" : "Leaves the wallet")
                        Money(zat: ss.amount + (fee ?? 0), size: 34, sign: "out")
                        if let fee { Text("Includes the \(zec(fee)) network fee").font(.nativeCaption).foregroundStyle(Color.mist) }
                        Text("Proposed by \(model.proposerName(ss)) · \(when(ss.doc.int("createdAt")))")
                            .font(.nativeCaption).foregroundStyle(Color.mist)
                    }
                    if case .failure(let e) = ins {
                        Label("This \(deviceName) refuses this payment: \(e.message)", systemImage: "xmark.octagon.fill")
                            .font(.nativeSubheadline).foregroundStyle(Color.bad)
                    }
                    RecipientBox(ss: ss, rc: rc)
                    if case .success(let d) = ins { Breakdown(ss: ss, ins: d) }
                    Timeline(ss: ss)
                    Discussion(sid: ss.id)
                    if let final = ss.doc.doc("final") {
                        Card {
                            Text("Transaction").font(.nativeHeadline)
                            Detail(label: "ID") { Text(final.str("txid") ?? "").font(.nativeCaption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled) }
                            if let ms = final.int("ms") { Detail(label: "Proof time") { Text(String(format: "%.1f s", Double(ms) / 1000)) } }
                        }
                        if has(ss.doc["broadcastTxid"]) { ChainView() }
                    }
                }
                .padding(20).frame(maxWidth: 840).frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                NativeWalletHeader(name: model.state.name, network: model.state.net.label,
                    rule: "\(model.state.t) of \(model.state.n) approvals",
                    seed: model.addressHidden ? nil : model.state.wallet?.str("address"), home: home)
            }
            .instrumentScreen()
            .navigationTitle(payTitle(ss))
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    let s = statusLabels[ss.status] ?? (ss.status, .plain)
                    Badge(text: s.0, kind: s.1)
                }
            }
            .safeAreaInset(edge: .bottom) {
                NextAction(ss: ss, blocked: rc.match != true || rc.intoNew == false)
            }
            .modifier(Banners())
        } else {
            ContentUnavailableView("Payment not found", systemImage: "questionmark.circle")
        }
    }
}

/// A decoded output that pays someone else. `memo` is "" for none, and nil when the engine could
/// not read the memo or it is not text. A nil never equals what the proposer wrote.
struct PaidOutput: Equatable {
    let who: String
    let value: Int
    let memo: String?
}

/// The memo of a decoded output line of `inspect`, read from the transaction itself.
func outputMemo(_ line: Doc) -> String? {
    switch line.str("memo_status") {
    case "empty": ""
    case "text": line.str("memo")
    default: nil
    }
}

/// The memo that the proposer listed for a payee: "" for none, nil when the field is not text.
func proposedMemo(_ payee: Doc) -> String? {
    switch payee["memo"] {
    case nil, is NSNull: ""
    case let text as String: text
    default: nil
    }
}

/// The decoded outputs are the truth. Each one must be a proposed payee with the same amount and
/// memo, and the proposal must list nothing else. The typed addresses only help people recognise
/// them. The rules are those of `pairPayees` and `allPaid` in web/payees.js.
struct RecipientCheck {
    struct Row: Equatable {
        let to: String
        let amount: Int
        /// The memo that the proposer listed: "" for none, nil when the field is not text.
        let memo: String?
        let ok: Bool
        /// True when the transaction pays this address and amount with another memo. `got` is that
        /// memo ("" for none, nil when it is unreadable).
        let other: Bool
        let got: String?
    }
    let rows: [Row]
    /// Decoded payments that the proposal does not list.
    let extra: [PaidOutput]
    let match: Bool?
    /// For a move: whether the only payee is the new wallet's own address (nil when unknown here).
    let intoNew: Bool?

    /// The check of `payees` against the decoded outputs `paid`. `total` is the amount that the
    /// proposal states. With no outputs (`paid` is nil) there is nothing to compare yet.
    init(payees: [Doc], paid: [PaidOutput]?, total: Int?, norm: (String) -> String?,
         intoNew: Bool? = nil) {
        guard let paid else { rows = []; extra = []; match = nil; self.intoNew = nil; return }
        (rows, extra) = Self.pair(payees, paid, norm: norm)
        match = Self.allPaid(rows, extra: extra.count, total: total ?? -1)
        self.intoNew = intoNew
    }

    @MainActor
    init(model: GroupModel, ss: Session, ins: Doc?) {
        let paid = ins.map(Self.outputs(of:))
        let newAddress = ss.doc.str("move").flatMap { model.checkedAddress(of: $0) }
        let into = newAddress.flatMap { a in
            paid.map { $0.count == 1 && model.normalized(a) == $0[0].who }
        }
        self.init(payees: ss.doc["payees"] as? [Doc] ?? [], paid: paid,
                  total: wholeZat(ss.doc["amount"]), norm: model.normalized, intoNew: into)
    }

    /// The outputs of `inspect` that pay someone other than this wallet.
    static func outputs(of ins: Doc) -> [PaidOutput] {
        (ins["lines"] as? [Doc] ?? [])
            .filter { $0.str("kind") == "output" && !ownOutputs.contains($0.str("who") ?? "") }
            .map {
                PaidOutput(who: $0.str("who") ?? "", value: $0.int("value") ?? 0, memo: outputMemo($0))
            }
    }

    /// Pairs each payee with one output of the same address, amount and memo. A payee with no such
    /// output takes one of the same address and amount, and shows that output's memo. `norm` gives
    /// the canonical form of an address, or nil.
    static func pair(_ payees: [Doc], _ paid: [PaidOutput], norm: (String) -> String?)
        -> (rows: [Row], extra: [PaidOutput]) {
        var left = paid
        let wanted = payees.map { p in
            (to: p.str("to") ?? "", amount: wholeZat(p["amount"]), memo: proposedMemo(p))
        }
        func claim(_ w: (to: String, amount: Int?, memo: String?), withMemo: Bool) -> PaidOutput? {
            guard let amount = w.amount, let address = norm(w.to) else { return nil }
            let i = left.firstIndex { pays($0, address, amount, memo: w.memo, check: withMemo) }
            return i.map { left.remove(at: $0) }
        }
        let ok = wanted.map { claim($0, withMemo: true) != nil }
        let seen = wanted.enumerated().map { i, w in ok[i] ? nil : claim(w, withMemo: false) }
        let rows = wanted.enumerated().map { i, w in
            Row(to: w.to, amount: w.amount ?? 0, memo: w.memo, ok: ok[i], other: seen[i] != nil,
                got: seen[i]?.memo)
        }
        return (rows, left)
    }

    /// Whether `o` pays `amount` to `address`. With `check`, it must also carry `memo`. A memo that
    /// is nil (the proposer's field is not text, or the output's memo is unreadable) never matches.
    private static func pays(_ o: PaidOutput, _ address: String, _ amount: Int, memo: String?,
                             check: Bool) -> Bool {
        o.who == address && o.value == amount && (!check || (memo != nil && memo == o.memo))
    }

    static func allPaid(_ rows: [Row], extra: Int, total: Int) -> Bool {
        // At most `maxPayees` amounts of at most `maxMoney` each, so the sum cannot overflow.
        guard !rows.isEmpty, rows.count <= maxPayees, extra == 0, rows.allSatisfy(\.ok) else { return false }
        return rows.reduce(0) { $0 + $1.amount } == total
    }

    /// Warnings to show next to the recipients, most serious first.
    var warnings: [String] {
        var out = extra.map { "The transaction also pays \(zec($0.value)) to \(short($0.who)), which the proposer did not list. Do not approve it." }
        let memoOnly = rows.filter { !$0.ok && $0.other }
        out += memoOnly.map {
            "The memo in the transaction for \(short($0.to)) is not the memo the proposer listed. "
                + "Do not approve it."
        }
        if rows.isEmpty { out.append("The proposal lists no recipients. Do not approve it.") }
        else if match == false && extra.isEmpty && memoOnly.isEmpty {
            out.append("The transaction does not pay what the proposer listed. Do not approve it.")
        }
        return out
    }
}

/// A whole number of zatoshis, from 1 to `maxMoney`, or nil. JSON booleans and fractions are nil.
func wholeZat(_ v: Any?) -> Int? {
    guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    let d = n.doubleValue
    return d == d.rounded() && d >= 1 && d <= Double(maxMoney) ? n.intValue : nil
}

let ownOutputs: Set<String> = ["this wallet", "change (back to this wallet)"]

struct RecipientBox: View {
    @Environment(GroupModel.self) private var model
    let ss: Session
    let rc: RecipientCheck

    var body: some View {
        // Payments proposed before batch payments have no list; only one still open for approval
        // needs the check.
        if let match = rc.match, !rc.rows.isEmpty || ss.doc["package"] == nil {
            Card {
                HStack {
                    SectionLabel(text: rc.rows.count > 1 ? "\(rc.rows.count) recipients" : "To")
                    Spacer()
                    Badge(text: match ? "Matches the transaction" : "Does not match the transaction", kind: match ? .ok : .bad)
                }
                ForEach(Array(rc.rows.enumerated()), id: \.offset) { _, r in PayeeLine(row: r) }
                if rc.rows.contains(where: { $0.memo?.isEmpty == false }) {
                    Text("A memo goes on chain with the payment. Its recipient and every signer can "
                         + "read it.")
                        .font(.nativeCaption).foregroundStyle(Color.mist)
                }
                ForEach(rc.warnings, id: \.self) { Text($0).font(.nativeSubheadline).foregroundStyle(Color.bad) }
                if let move = ss.doc.str("move") { MoveNote(move: move, intoNew: rc.intoNew) }
            }
        }
    }
}

/// Text from the chain comes from anyone. This replaces the characters that could hide or reorder
/// other text (control characters and bidirectional marks) with U+FFFD. A new line stays. The same
/// rule as `memoShown` in web/payees.js.
func memoShown(_ text: String) -> String {
    let hiding: [ClosedRange<UInt32>] = [
        0x00...0x09, 0x0B...0x1F, 0x7F...0x9F, 0x61C...0x61C, 0x200E...0x200F, 0x202A...0x202E,
        0x2066...0x2069,
    ]
    var out = String.UnicodeScalarView()
    for u in text.unicodeScalars {
        out.append(hiding.contains { $0.contains(u.value) } ? "\u{FFFD}" : u)
    }
    return String(out)
}

/// A memo for display: "" is no memo, and nil is one that the engine could not read as text.
func memoWords(_ memo: String?) -> String {
    guard let memo else { return "Memo is not text" }
    return memo.isEmpty ? "No memo" : memoShown(memo)
}

struct PayeeLine: View {
    let row: RecipientCheck.Row

    /// The memo lines of the payee. For a payee paid with another memo, the memo that the
    /// transaction carries is the decoded one, so it shows as well.
    private var memoLines: [(label: String, memo: String?, bad: Bool)] {
        if !row.ok && row.other {
            return [("Proposed memo", row.memo, false), ("Memo in the transaction", row.got, true)]
        }
        return row.memo == "" ? [] : [("Memo", row.memo, false)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AdaptiveRow {
                Text(grouped(row.to)).font(.nativeCaption.monospaced()).fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .trailing, spacing: 4) {
                    Money(zat: row.amount, size: 15)
                    if !row.ok { Badge(text: row.other ? "Memo differs" : "Not in the transaction", kind: .bad) }
                }
            }
            ForEach(Array(memoLines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(line.label).font(.nativeCaption).foregroundStyle(Color.mist)
                    Text(memoWords(line.memo)).font(.nativeCaption)
                        .foregroundStyle(line.bad ? Color.bad : line.memo?.isEmpty == false ? Color.primary : Color.mist)
                }
            }
        }
    }
}

struct MoveNote: View {
    @Environment(GroupModel.self) private var model
    let move: String
    let intoNew: Bool?

    var body: some View {
        Text(intoNew == false ? "This is not the address of \(model.groupName(move)). Do not approve it."
             : intoNew == true ? "This moves all funds to \(model.groupName(move)), the wallet that replaces this one. This device checked its address."
             : "This moves all funds to a new wallet that replaces this one. This device has no checked copy of its address, so it cannot check it.")
            .font(.nativeSubheadline).foregroundStyle(intoNew == false ? Color.bad : Color.mist)
    }
}

/// Spent value minus every output: what the network keeps. Zero-value outputs are not listed.
func networkFee(_ ins: Doc) -> Int {
    (ins["lines"] as? [Doc] ?? []).reduce(0) { $0 + ($1.str("kind") == "spend" ? 1 : -1) * ($1.int("value") ?? 0) }
}

struct Breakdown: View {
    let ss: Session
    let ins: Doc

    var body: some View {
        let lines = ins["lines"] as? [Doc] ?? []
        let isNote = { (l: Doc) in l.str("kind") == "spend" || ownOutputs.contains(l.str("who") ?? "") }
        Card {
            SectionLabel(text: "What this payment does")
            ForEach(Array(lines.filter { !isNote($0) }.enumerated()), id: \.offset) { _, l in
                Line(label: "To \(short(l.str("who") ?? "", 10))", zat: l.int("value") ?? 0)
            }
            Line(label: "Network fee", zat: networkFee(ins), muted: true)
            SectionLabel(text: "Funds used")
            ForEach(Array(lines.filter(isNote).sorted { $0.str("kind") == "spend" && $1.str("kind") != "spend" }.enumerated()),
                    id: \.offset) { _, l in
                let spend = l.str("kind") == "spend"
                Line(label: spend ? "Spent from this wallet" : "Change back to this wallet", zat: l.int("value") ?? 0, muted: true)
            }
            Text("This \(deviceName) decoded this from the transaction itself, not from the proposer's description.")
                .font(.nativeCaption).foregroundStyle(Color.mist)
        }
    }

    private struct Line: View {
        let label: String
        let zat: Int
        var muted = false

        var body: some View {
            AdaptiveRow {
                Text(label).font(.nativeSubheadline)
                ExactValueText(value: zec(zat), font: .subheadline)
            }
            .foregroundStyle(muted ? Color.mist : Color.primary)
        }
    }
}

/// What anyone who reads the blockchain learns about a sent payment.
struct ChainView: View {
    var body: some View {
        Card {
            SectionLabel(text: "What the chain sees")
            Text("One shielded transaction.").font(.nativeSubheadline)
            ForEach(["Recipients", "Amounts", "Signers", "Approval rule"], id: \.self) { item in
                HStack {
                    Text(item).font(.nativeSubheadline).foregroundStyle(Color.mist)
                    Spacer()
                    Text("Hidden").font(.nativeSubheadline.weight(.medium))
                }
            }
            Text("The fee and the number of actions are public.").font(.nativeCaption).foregroundStyle(Color.mist)
            Text("The expiry height is public too. Zigs sets it up to one day after the proposal, and a standard wallet sets it 40 blocks ahead. So the expiry height can show that Zigs made this payment. Few wallets pay a priority fee, so a priority fee can mark a payment too.")
                .font(.nativeCaption).foregroundStyle(Color.mist)
        }
    }
}

struct Timeline: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        let st = model.state
        let commits = st.commits[ss.id] ?? [:]
        let signers = (ss.doc["signers"] as? [NSNumber])?.map(\.intValue) ?? []
        let shares = st.shares[ss.id] ?? [:]
        let proving = ss.status == "proving" && (ss.doc.int("provingAt") ?? 0) > now() - 180_000
        Card {
            Step(state: .done, no: 1, title: "Proposed", text: when(ss.doc.int("createdAt")))
            Step(state: commits.count >= st.t ? .done : .now, no: 2, title: "Approvals · \(min(commits.count, st.t)) of \(st.t) needed",
                 text: st.seatIds.map { i in
                     let seat = model.isSigned ? " (seat \(i))" : ""
                     return model.seatLabel(i) + seat + (commits["\(i)"] != nil ? " ✓" : "")
                 }.joined(separator: " · "))
            Step(state: has(ss.doc["error"]) ? .bad : has(ss.doc["signed"]) ? .done : signers.isEmpty ? .later : .now, no: 3,
                 title: "Combined signature",
                 text: ss.doc.str("error") ?? (has(ss.doc["signed"]) ? "All signatures combined and verified."
                     : signers.isEmpty ? "Starts after \(st.t) approvals." : "Signing · \(signers.filter { shares["\($0)"] != nil }.count) of \(signers.count) shares"))
            Step(state: ss.doc.doc("final") != nil ? .done : proving ? .now : .later, no: 4, title: "Proof",
                 text: ss.doc.doc("final") != nil ? "Proof built and the whole transaction checked."
                     : proving ? "A signer's device is building the proof…" : "Any signer can build the zero-knowledge proof once the payment is signed.")
            Step(state: has(ss.doc["broadcastTxid"]) ? .done : has(ss.doc["broadcastError"]) ? .bad : ss.doc.doc("final") != nil ? .now : .later,
                 no: 5, title: "Sent to the network",
                 text: has(ss.doc["broadcastTxid"]) ? "Sent \(when(ss.doc.int("broadcastAt")))."
                     : ss.doc.str("broadcastError") ?? (ss.doc.doc("final") != nil ? "Any signer can send the finished transaction." : "Available after the proof."))
            Text("Opening the explorer shares your IP address and this transaction ID with that service.")
                .font(.nativeCaption).foregroundStyle(Color.mist)
            if let txid = ss.doc.str("broadcastTxid"), let url = URL(string: model.state.net.explorer + txid) {
                Link(destination: url) { Label("View in explorer", systemImage: "arrow.up.right.square") }.font(.nativeSubheadline)
            }
        }
    }
}

/// The one thing this device can do next for the payment, as a bottom button.
struct NextAction: View {
    @Environment(GroupModel.self) private var model
    let ss: Session
    let blocked: Bool
    @State private var confirmCancel = false

    var body: some View {
        // A cancelled or failed payment takes no more steps.
        if !has(ss.doc["error"]) { actions }
    }

    @ViewBuilder private var actions: some View {
        let mine = model.pendingApprovals(ss)
        let approve = !mine.isEmpty && !blocked
        let send = ss.doc.doc("final") != nil && !has(ss.doc["broadcastTxid"]) && model.canAct
        let proving = ss.status == "proving" && !model.canProve(ss)
        let cancel = !has(ss.doc["signed"]) && !model.localSeats.isEmpty && model.canAct
        if approve || model.canProve(ss) || send || proving || cancel {
            VStack(spacing: 8) {
                if approve {
                    ForEach(mine, id: \.self) { i in
                        Button(mine.count > 1 || model.localSeats.count > 1 ? "Approve as seat \(i)" : "Approve payment") { model.approve(ss, i) }
                            .primaryButton()
                    }
                } else if model.canProve(ss) {
                    Button("Build proof") { model.prove(ss) }.primaryButton()
                } else if send {
                    Button(has(ss.doc["broadcastError"]) ? "Send again" : "Send to network") { model.broadcast(ss) }.primaryButton()
                } else if proving {
                    ProgressView("Building the zero-knowledge proof…").font(.nativeSubheadline)
                }
                if cancel {
                    Button("Cancel payment", role: .destructive) { confirmCancel = true }
                        .confirmationDialog("Cancel this payment?", isPresented: $confirmCancel, titleVisibility: .visible) {
                            Button("Cancel payment", role: .destructive) { model.cancel(ss) }
                        } message: {
                            Text("No signer can approve it after this. Anyone can propose it again.")
                        }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .modifier(GlassChrome())
        }
    }
}
