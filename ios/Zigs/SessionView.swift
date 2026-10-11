import SwiftUI

/// One payment: what it does, decoded on this iPhone, and the step that comes next.
struct SessionView: View {
    @Environment(GroupModel.self) private var model
    let sid: String

    var body: some View {
        if let ss = model.state.sessions.first(where: { $0.id == sid }) {
            let ins = model.inspect(ss)
            let rc = RecipientCheck(model: model, ss: ss, ins: try? ins.get())
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Money(zat: ss.amount, size: 34, sign: "out")
                        Text("Proposed by \(proposer(ss)) · \(when(ss.doc.int("createdAt")))").font(.caption).foregroundStyle(Color.mist)
                    }
                    if case .failure(let e) = ins {
                        Label("This iPhone refuses this payment: \(e.message)", systemImage: "xmark.octagon.fill")
                            .font(.subheadline).foregroundStyle(Color.bad)
                    }
                    RecipientBox(ss: ss, rc: rc)
                    if case .success(let d) = ins { Breakdown(ss: ss, ins: d) }
                    Timeline(ss: ss)
                    if let final = ss.doc.doc("final") {
                        Card {
                            Text("Transaction").font(.headline)
                            Detail(label: "ID") { Text(final.str("txid") ?? "").font(.caption.monospaced()).textSelection(.enabled) }
                            if let ms = final.int("ms") { Detail(label: "Proof time") { Text(String(format: "%.1f s", Double(ms) / 1000)) } }
                        }
                    }
                }
                .padding(16)
            }
            .background(Color.night)
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

    private func proposer(_ ss: Session) -> String {
        guard let uid = ss.doc.str("createdBy") else { return "someone" }
        if uid == model.me { return "you" }
        let seat = model.state.seats.first { $0.value.str("uid") == uid }
        return seat.flatMap { $0.value.str("name") }.flatMap { $0.isEmpty ? nil : $0 } ?? "a signer"
    }
}

/// The decoded outputs are the truth. Each one must be a proposed payee with the same amount, and
/// the proposal must list nothing else. The typed addresses only help people recognise them.
struct RecipientCheck {
    struct Row { let to: String; let amount: Int; let ok: Bool }
    let rows: [Row]
    /// Decoded payments that the proposal does not list.
    let extra: [(who: String, value: Int)]
    let match: Bool?
    /// For a move: whether the only payee is the new wallet's own address (nil when unknown here).
    let intoNew: Bool?

    @MainActor
    init(model: GroupModel, ss: Session, ins: Doc?) {
        guard let ins else { rows = []; extra = []; match = nil; intoNew = nil; return }
        let paid = (ins["lines"] as? [Doc] ?? [])
            .filter { $0.str("kind") == "output" && !ownOutputs.contains($0.str("who") ?? "") }
            .map { (who: $0.str("who") ?? "", value: $0.int("value") ?? 0) }
        var left = paid
        rows = (ss.doc["payees"] as? [Doc] ?? []).map { p in
            let to = p.str("to") ?? "", amount = wholeZat(p["amount"]), address = model.normalized(to)
            guard let amount, let i = left.firstIndex(where: { $0.who == address && $0.value == amount }) else {
                return Row(to: to, amount: amount ?? 0, ok: false)
            }
            left.remove(at: i)
            return Row(to: to, amount: amount, ok: true)
        }
        extra = left
        match = Self.allPaid(rows, extra: left.count, total: wholeZat(ss.doc["amount"]) ?? -1)
        let newAddress = ss.doc.str("move").flatMap { model.checkedAddress(of: $0) }
        intoNew = newAddress.map { a in paid.count == 1 && model.normalized(a) == paid[0].who }
    }

    private static func allPaid(_ rows: [Row], extra: Int, total: Int) -> Bool {
        // At most `maxPayees` amounts of at most `maxMoney` each, so the sum cannot overflow.
        guard !rows.isEmpty, rows.count <= maxPayees, extra == 0, rows.allSatisfy(\.ok) else { return false }
        return rows.reduce(0) { $0 + $1.amount } == total
    }

    /// Warnings to show next to the recipients, most serious first.
    var warnings: [String] {
        var out = extra.map { "The transaction also pays \(zec($0.value)) to \(short($0.who)), which the proposer did not list. Do not approve it." }
        if rows.isEmpty { out.append("The proposal lists no recipients. Do not approve it.") }
        else if match == false && extra.isEmpty { out.append("The transaction does not pay what the proposer listed. Do not approve it.") }
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
                ForEach(rc.warnings, id: \.self) { Text($0).font(.subheadline).foregroundStyle(Color.bad) }
                if let move = ss.doc.str("move") { MoveNote(move: move, intoNew: rc.intoNew) }
            }
        }
    }
}

struct PayeeLine: View {
    let row: RecipientCheck.Row

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(row.to).font(.caption.monospaced()).textSelection(.enabled)
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Money(zat: row.amount, size: 15)
                if !row.ok { Badge(text: "Not in the transaction", kind: .bad) }
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
            .font(.subheadline).foregroundStyle(intoNew == false ? Color.bad : Color.mist)
    }
}

struct Breakdown: View {
    let ss: Session
    let ins: Doc

    var body: some View {
        let own = ownOutputs
        let lines = (ins["lines"] as? [Doc] ?? []).sorted { rank($0, own) < rank($1, own) }
        // Spent value minus every output: what the network keeps. Zero-value outputs are not listed.
        let fee = lines.reduce(0) { $0 + ($1.str("kind") == "spend" ? 1 : -1) * ($1.int("value") ?? 0) }
        Card {
            SectionLabel(text: "What this payment does")
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                let spend = l.str("kind") == "spend"
                HStack {
                    Text(spend ? "From this wallet" : own.contains(l.str("who") ?? "") ? "Change back to this wallet" : "To \(short(l.str("who") ?? "", 10))")
                        .font(.subheadline)
                    Spacer()
                    Text((spend ? "−" : "") + String(format: "%.8f", Double(l.int("value") ?? 0) / 1e8))
                        .font(.subheadline.monospacedDigit()).foregroundStyle(spend ? Color.bad : .white)
                }
            }
            HStack {
                Text("Network fee").font(.subheadline).foregroundStyle(Color.mist)
                Spacer()
                Text(String(format: "%.8f", Double(fee) / 1e8)).font(.subheadline.monospacedDigit()).foregroundStyle(Color.mist)
            }
            Text("This iPhone decoded this from the transaction itself, not from the proposer's description.")
                .font(.caption).foregroundStyle(Color.mist)
        }
    }

    private func rank(_ l: Doc, _ own: Set<String>) -> Int {
        l.str("kind") == "spend" ? 0 : own.contains(l.str("who") ?? "") ? 2 : 1
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
        let proving = ss.status == "proving" && now() - (ss.doc.int("provingAt") ?? 0) < 180_000
        Card {
            Step(state: .done, no: 1, title: "Proposed", text: when(ss.doc.int("createdAt")))
            Step(state: commits.count >= st.t ? .done : .now, no: 2, title: "Approvals · \(min(commits.count, st.t)) of \(st.t)",
                 text: st.seatIds.map { model.seatLabel($0) + (commits["\($0)"] != nil ? " ✓" : "") }.joined(separator: " · "))
            Step(state: has(ss.doc["error"]) ? .bad : has(ss.doc["signed"]) ? .done : signers.isEmpty ? .later : .now, no: 3,
                 title: "Group signature",
                 text: ss.doc.str("error") ?? (has(ss.doc["signed"]) ? "All signatures combined and verified."
                     : signers.isEmpty ? "Starts after \(st.t) approvals." : "Signing · \(signers.filter { shares["\($0)"] != nil }.count) of \(signers.count) shares"))
            Step(state: ss.doc.doc("final") != nil ? .done : proving ? .now : .later, no: 4, title: "Proof",
                 text: ss.doc.doc("final") != nil ? "Proof built and the whole transaction checked."
                     : proving ? "A signer's device is building the proof…" : "Any signer can build the zero-knowledge proof once the payment is signed.")
            Step(state: has(ss.doc["broadcastTxid"]) ? .done : has(ss.doc["broadcastError"]) ? .bad : ss.doc.doc("final") != nil ? .now : .later,
                 no: 5, title: "Sent to the network",
                 text: has(ss.doc["broadcastTxid"]) ? "Sent \(when(ss.doc.int("broadcastAt")))."
                     : ss.doc.str("broadcastError") ?? (ss.doc.doc("final") != nil ? "Any signer can send the finished transaction." : "Available after the proof."))
            if let txid = ss.doc.str("broadcastTxid"), let url = URL(string: model.state.net.explorer + txid) {
                Link(destination: url) { Label("View in explorer", systemImage: "arrow.up.right.square") }.font(.subheadline)
            }
        }
    }
}

/// The one thing this device can do next for the payment, as a bottom button.
struct NextAction: View {
    @Environment(GroupModel.self) private var model
    let ss: Session
    let blocked: Bool

    var body: some View {
        let mine = model.pendingApprovals(ss)
        let approve = !mine.isEmpty && !blocked
        let send = ss.doc.doc("final") != nil && !has(ss.doc["broadcastTxid"])
        if approve || model.canProve(ss) || send || ss.status == "proving" {
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
                } else {
                    ProgressView("Building the zero-knowledge proof…").font(.subheadline)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
    }
}
