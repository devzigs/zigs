import SwiftUI

struct SessionView: View {
    @Environment(GroupModel.self) private var model
    let sid: String

    var body: some View {
        if let ss = model.state.sessions.first(where: { $0.id == sid }) {
            List {
                OutputsSection(ss: ss)
                ApprovalSection(ss: ss)
                SignatureSection(ss: ss)
                FinishSection(ss: ss)
            }
            .scrollContentBackground(.hidden)
            .background(Color.night)
            .navigationTitle(zec(ss.doc.int("amount")))
            .toolbar { ToolbarItem(placement: .topBarTrailing) { StatusChip(status: ss.status) } }
        } else {
            ContentUnavailableView("Payment not found", systemImage: "questionmark.circle")
        }
    }
}

/// What the transaction does, decoded on this iPhone from the transaction itself.
struct OutputsSection: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        Section {
            switch model.inspect(ss) {
            case .failure(let e):
                Label("This iPhone refuses this transaction: \(e.message)", systemImage: "xmark.octagon.fill")
                    .foregroundStyle(.red)
            case .success(let ins):
                ForEach(Array((ins["lines"] as? [Doc] ?? []).enumerated()), id: \.offset) { _, l in
                    HStack(alignment: .firstTextBaseline) {
                        Text(l.str("kind") == "spend" ? "Spend a note of this wallet" : "Pay \(l.str("who") ?? "")")
                            .font(.subheadline)
                        Spacer()
                        Text((l.str("kind") == "spend" ? "−" : "") + zec(l.int("value")))
                            .font(.subheadline.monospacedDigit())
                    }
                }
                HStack {
                    Text("Fee (ZIP 317)").foregroundStyle(Color.mist)
                    Spacer()
                    Text(zec(ss.doc.int("fee"))).font(.subheadline.monospacedDigit())
                }
            }
        } header: {
            Text("What this payment does")
        } footer: {
            Text("Decoded on this iPhone from the transaction itself, not from what the proposer says.")
        }
    }
}

struct ApprovalSection: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        let approvals = (model.state.commits[ss.id] ?? [:]).keys.compactMap(Int.init).sorted()
        let refused = (try? model.inspect(ss).get()) == nil
        Section("Approvals \(approvals.count) of \(model.state.t)") {
            if !approvals.isEmpty {
                Text("Approved: " + approvals.map(model.seatName).joined(separator: ", ")).font(.subheadline)
            }
            ForEach(model.pendingApprovals(ss), id: \.self) { i in
                Button {
                    model.approve(ss, i)
                } label: {
                    Label("Approve this payment", systemImage: "signature").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(Color.night)
                .disabled(refused)
            }
        }
    }
}

struct SignatureSection: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        let signers = (ss.doc["signers"] as? [NSNumber])?.map(\.intValue) ?? []
        let shares = model.state.shares[ss.id] ?? [:]
        Section("Threshold signature") {
            if signers.isEmpty {
                Text("Starts when \(model.state.t) members approve.").foregroundStyle(Color.mist)
            } else {
                Text("Signers \(signers.map(String.init).joined(separator: ", ")) · shares \(signers.filter { shares["\($0)"] != nil }.count) of \(signers.count)")
                    .font(.subheadline)
            }
            if has(ss.doc["signed"]) {
                Label("Signature verified under rk = ak + [α]·G", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(Color.signal)
            }
            if let err = ss.doc.str("error") { Text(err).foregroundStyle(.red) }
        }
    }
}

struct FinishSection: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        Section("Proof and broadcast") {
            if let final = ss.doc.doc("final") {
                LabeledContent("Transaction", value: short(final.str("txid") ?? ""))
                    .font(.subheadline.monospaced())
                if let ms = final.int("ms") {
                    LabeledContent("Proof time", value: String(format: "%.1f s", Double(ms) / 1000))
                }
            } else if ss.status == "proving" {
                ProgressView("Building the zero-knowledge proof…")
            }
            if model.canProve(ss) {
                Button("Build proof on this iPhone") { model.prove(ss) }.buttonStyle(.borderedProminent)
                    .foregroundStyle(Color.night)
            }
            BroadcastRow(ss: ss)
        }
    }
}

struct BroadcastRow: View {
    @Environment(GroupModel.self) private var model
    let ss: Session

    var body: some View {
        if let txid = ss.doc.str("broadcastTxid"), let url = URL(string: explorerTx + txid) {
            Link(destination: url) { Label("Sent. Open in the explorer", systemImage: "arrow.up.right.square") }
        } else if ss.doc.doc("final") != nil {
            if let err = ss.doc.str("broadcastError") { Text(err).font(.caption).foregroundStyle(.red) }
            Button("Broadcast to testnet") { model.broadcast(ss) }.buttonStyle(.borderedProminent)
                .foregroundStyle(Color.night)
        }
    }
}
