import SwiftUI

func zec(_ zat: Int?) -> String {
    String(format: "%.8f ZEC", Double(zat ?? 0) / 100_000_000)
}

func short(_ s: String, _ n: Int = 12) -> String {
    s.count > n * 2 ? "\(s.prefix(n))…\(s.suffix(n / 2))" : s
}

struct GroupView: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let st = model.state
        List {
            Section {
                ForEach(st.seatIds, id: \.self) { i in SeatRow(i: i) }
            } header: {
                Text("Seats · any \(st.t) of \(st.n) can sign")
            }
            if let w = st.wallet { WalletSection(wallet: w) }
            if st.wallet != nil {
                Section("Payments") {
                    if st.sessions.isEmpty {
                        Text("No payments yet. A member proposes one from their device.").foregroundStyle(Color.mist)
                    }
                    ForEach(st.sessions) { ss in
                        NavigationLink {
                            SessionView(sid: ss.id)
                        } label: {
                            HStack {
                                Text(zec(ss.doc.int("amount")))
                                    .font(.body.monospacedDigit())
                                Spacer()
                                StatusChip(status: ss.status)
                            }
                        }
                    }
                }
            }
            Section("Activity on this iPhone") {
                ForEach(model.log, id: \.self) { Text($0).font(.caption.monospaced()).foregroundStyle(Color.mist) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.night)
        .navigationTitle(st.g?.str("name") ?? "Group")
    }
}

struct SeatRow: View {
    @Environment(GroupModel.self) private var model
    let i: Int

    var body: some View {
        let stage = model.state.stage(i)
        let mine = model.localSeats.contains(i)
        HStack {
            Image(systemName: stage == 5 ? "checkmark.seal.fill" : stage == 0 ? "circle.dashed" : "person.fill")
                .foregroundStyle(stage == 5 ? Color.signal : Color.mist)
            VStack(alignment: .leading, spacing: 2) {
                Text(stage == 0 ? "Seat \(i)" : model.seatName(i)).fontWeight(mine ? .semibold : .regular)
                Text(stageLabels[stage]).font(.caption).foregroundStyle(Color.mist)
            }
            Spacer()
            if stage == 0 && model.localSeats.isEmpty {
                Button("Take seat") { model.takeSeat(i) }.buttonStyle(.borderedProminent).foregroundStyle(Color.night)
            }
        }
    }
}

struct WalletSection: View {
    let wallet: Doc

    var body: some View {
        Section {
            Text(wallet.str("address") ?? "")
                .font(.caption.monospaced())
                .textSelection(.enabled)
            Button("Copy address", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = wallet.str("address")
            }
        } header: {
            Text("Shared shielded address")
        } footer: {
            Text("This iPhone checked that the address belongs to the group key from its own key ceremony.")
        }
    }
}

struct StatusChip: View {
    let status: String
    private static let labels = ["collecting": "Collecting approvals", "signing": "Signing", "signed": "Signed",
                                 "proving": "Proving", "complete": "Valid transaction", "broadcast": "Broadcast",
                                 "failed": "Failed"]
    var body: some View {
        Text(Self.labels[status] ?? status)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(status == "failed" ? Color.red.opacity(0.25) : Color.signal.opacity(0.18), in: Capsule())
            .foregroundStyle(status == "failed" ? Color.red : Color.signal)
    }
}
