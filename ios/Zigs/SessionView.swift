import SwiftUI

/// One payment: what it does, decoded on this iPhone, and the step that comes next.
struct SessionView: View {
    @Environment(GroupModel.self) private var model
    let sid: String

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
                    VStack(alignment: .leading, spacing: 6) {
                        let fee = (try? ins.get()).map(networkFee)
                        SectionLabel(text: fee == nil ? "Payment" : "Leaves the wallet")
                        Money(zat: ss.amount + (fee ?? 0), size: 34, sign: "out")
                        if let fee { Text("Includes the \(zec(fee)) network fee").font(.caption).foregroundStyle(Color.mist) }
                        Text("Proposed by \(proposer(ss)) · \(when(ss.doc.int("createdAt")))").font(.caption).foregroundStyle(Color.mist)
                    }
                    if case .failure(let e) = ins {
                        Label("This \(deviceName) refuses this payment: \(e.message)", systemImage: "xmark.octagon.fill")
                            .font(.subheadline).foregroundStyle(Color.bad)
                    }
                    RecipientBox(ss: ss, rc: rc)
                    if case .success(let d) = ins { Breakdown(ss: ss, ins: d) }
                    Timeline(ss: ss)
                    if let final = ss.doc.doc("final") {
                        Card {
                            Text("Transaction").font(.headline)
                            Detail(label: "ID") { Text(final.str("txid") ?? "").font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled) }
                            if let ms = final.int("ms") { Detail(label: "Proof time") { Text(String(format: "%.1f s", Double(ms) / 1000)) } }
                        }
                        if has(ss.doc["broadcastTxid"]) { ChainView() }
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

    /// In a version 3 wallet the proposer is the seat in `by`, shown with its number. Before, it
    /// is the identity in `createdBy`.
    private func proposer(_ ss: Session) -> String {
        if let by = ss.doc.int("by") {
            return model.localSeats.contains(by) ? "you" : "\(model.seatLabel(by)) (seat \(by))"
        }
        guard let uid = ss.doc.str("createdBy") else { return "someone" }
        if model.isMe(uid) { return "you" }
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
            Text(grouped(row.to)).font(.caption.monospaced())
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
                .font(.caption).foregroundStyle(Color.mist)
        }
    }

    private struct Line: View {
        let label: String
        let zat: Int
        var muted = false

        var body: some View {
            HStack {
                Text(label).font(.subheadline)
                Spacer()
                Text(zec(zat)).font(.subheadline.monospacedDigit())
            }
            .foregroundStyle(muted ? Color.mist : .white)
        }
    }
}

/// What anyone who reads the blockchain learns about a sent payment.
struct ChainView: View {
    var body: some View {
        Card {
            SectionLabel(text: "What the chain sees")
            Text("One shielded transaction.").font(.subheadline)
            ForEach(["Recipients", "Amounts", "Signers", "Approval rule"], id: \.self) { item in
                HStack {
                    Text(item).font(.subheadline).foregroundStyle(Color.mist)
                    Spacer()
                    Text("Hidden").font(.subheadline.weight(.medium))
                }
            }
            Text("The fee and the number of actions are public.").font(.caption).foregroundStyle(Color.mist)
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
                    ProgressView("Building the zero-knowledge proof…").font(.subheadline)
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
            .background(.ultraThinMaterial)
        }
    }
}
