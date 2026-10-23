import SwiftUI

struct RecipientBookView: View {
    @Environment(GroupModel.self) private var model
    @State private var query = ""
    @State private var editor: RecipientEditorTarget?
    @State private var removing: PaymentRecipient?
    @State private var error: String?

    var body: some View {
        let rows = PaymentRecipient.matching(model.paymentRecipients, query: query)
        VStack(alignment: .leading, spacing: 24) {
            InstrumentHeading(title: "Address book", detail: "Payment recipients saved privately on this device, across your wallets. Chat contacts stay in Chats.")
            Text("Saved names are your labels, not verified identities. Check the full address and network before each payment. Recipients are excluded from wallet recovery files.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
            if model.vault.recipientsUnavailable {
                Text(RecipientBookError.damaged.localizedDescription).foregroundStyle(Color.bad)
            } else {
                TextField("Search by name or address", text: $query)
                    .accessibilityLabel("Search payment recipients")
                Button("Add recipient", systemImage: "plus") { editor = .init(recipient: nil) }
                    .primaryButton()
                if rows.isEmpty {
                    InstrumentEmptyState(symbol: "person.crop.rectangle.stack", title: query.isEmpty ? "No saved recipients" : "No matching recipients",
                                         detail: "Save a shielded Zcash address for the correct network. This does not create a payment.")
                }
                ForEach(rows) { r in
                    Card {
                        RecipientSummary(recipient: r)
                        AdaptiveRow {
                            Button("Edit", systemImage: "pencil") { editor = .init(recipient: r) }
                            CopyButton(text: r.address, label: "Copy address")
                            Button("Delete", systemImage: "trash", role: .destructive) { removing = r }
                        }
                    }
                }
            }
            if let error { Text(error).font(.nativeSubheadline).foregroundStyle(Color.bad) }
        }
        .sheet(item: $editor) { RecipientEditor(existing: $0.recipient) }
        .confirmationDialog("Delete saved recipient?", isPresented: Binding(
            get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Delete recipient", role: .destructive) {
                guard let r = removing else { return }
                do { try model.deletePaymentRecipient(r.id); error = nil }
                catch { self.error = error.localizedDescription }
                removing = nil
            }
        } message: { Text("Only the saved address-book entry is removed. Existing payments and chat contacts stay available.") }
    }
}

private struct RecipientEditorTarget: Identifiable {
    let id = UUID()
    let recipient: PaymentRecipient?
}

struct RecipientSummary: View {
    let recipient: PaymentRecipient
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(recipient.name).font(.nativeHeadline).fixedSize(horizontal: false, vertical: true)
            Badge(text: "Shielded ZEC · " + (recipient.network == "mainnet" ? "Mainnet" : "Testnet"))
            Text(grouped(recipient.address)).font(.nativeFootnote.monospaced())
                .foregroundStyle(Color.mist).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Full address: " + recipient.address)
        }
    }
}

struct RecipientEditor: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let existing: PaymentRecipient?
    @State private var name = ""
    @State private var network = "testnet"
    @State private var address = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Recipient name") {
                    TextField("For example, Studio treasury", text: $name).accessibilityLabel("Recipient name")
                }
                Section("Network") {
                    Picker("Zcash network", selection: $network) {
                        Text("Testnet").tag("testnet")
                        Text("Mainnet").tag("mainnet")
                    }
                }
                Section {
                    TextField(network == "mainnet" ? "u1…" : "utest1…", text: $address)
                        .font(.nativeBody.monospaced()).codeEntry()
                        .accessibilityLabel("Shielded Zcash address")
                } header: { Text("Shielded Zcash address") }
                footer: { Text("Paste the literal address. Names, links, amounts and memos are not saved. Check it with the recipient through a trusted channel.") }
                Section {
                    Text("Private to this device; available across its wallets. Not shared with signers or included in wallet recovery files.")
                        .font(.nativeFootnote).foregroundStyle(Color.mist)
                    if let error { Text(error).foregroundStyle(Color.bad).accessibilityLabel("Could not save: " + error) }
                }
            }
            .instrumentScreen().nativeSheetSizing()
            .navigationTitle(existing == nil ? "Add recipient" : "Edit recipient").inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do {
                            try model.savePaymentRecipient(id: existing?.id, name: name, network: network, address: address)
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                    }.disabled(model.vault.locked || model.vault.recipientsUnavailable)
                }
            }
            .onAppear {
                if let existing { name = existing.name; network = existing.network; address = existing.address }
            }
        }
    }
}

/// Choosing a recipient only fills the address field. All existing Send checks still run.
struct RecipientPicker: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let network: String
    let choose: (PaymentRecipient) -> Void
    @State private var query = ""

    var body: some View {
        let rows = PaymentRecipient.matching(model.paymentRecipients, query: query, network: network)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Only recipients on this wallet’s Zcash network are shown. A saved name does not verify the recipient.")
                        .font(.nativeSubheadline).foregroundStyle(Color.mist)
                    TextField("Search saved recipients", text: $query)
                    if model.vault.recipientsUnavailable { Text(RecipientBookError.damaged.localizedDescription).foregroundStyle(Color.bad) }
                    else if rows.isEmpty {
                        InstrumentEmptyState(symbol: "person.crop.rectangle.stack", title: "No saved recipients for this network",
                                             detail: "Add recipients from Address book in the sidebar, or enter an address directly in Send.")
                    }
                    ForEach(rows) { r in
                        Card {
                            RecipientSummary(recipient: r)
                            Button("Use recipient") { choose(r); dismiss() }
                                .accessibilityLabel("Use saved recipient " + r.name)
                                .accessibilityHint("Fills the recipient address. Amount and payment approval are unchanged.")
                        }
                    }
                }.padding(20)
            }
            .instrumentScreen().nativeSheetSizing().navigationTitle("Choose recipient").inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct UnavailableAssetActions: View {
    var body: some View {
        AdaptiveRow {
            Button("Deposit", systemImage: "arrow.down") {}.disabled(true)
            Button("Send", systemImage: "arrow.up") {}.disabled(true)
        }
    }
}

struct UnavailableSwap: View {
    var body: some View {
        Card {
            InstrumentEmptyState(symbol: "arrow.triangle.swap", title: "Swap is unavailable",
                                 detail: "This app does not support asset swaps. No exchange rate or quote is available.")
            Button("Swap") {}.disabled(true)
        }
    }
}

struct ChatsWorkspace: View {
    @Environment(GroupModel.self) private var model
    @State private var creating = false
    @State private var walletChat = false
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            InstrumentHeading(title: "Chats", detail: "Private conversations in their own space. Payment discussions stay in each payment review.")
            ForEach(model.chat.offers.keys.sorted(), id: \.self) { JoinChatCard(cid: $0) }
            ChatsCard(newChat: { creating = true })
            if model.gid != nil {
                Card {
                    DisclosureGroup("Wallet conversation · " + model.state.name, isExpanded: $walletChat) {
                        MessagesTab().padding(.top, 12)
                    }.font(.nativeSubheadline.weight(.medium))
                }
            }
            Text("A chat contact does not become a wallet signer or a payment recipient. Shared invite links and the server's metadata visibility still matter.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }.sheet(isPresented: $creating) { NewChatSheet() }
    }
}

struct SetupEducation: View {
    var body: some View {
        Card {
            Text("How your shared wallet works").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Text("Each device holds one key share. Devices cooperate to approve payments; no device receives the whole key.")
                .font(.nativeSubheadline).foregroundStyle(Color.mist)
            AdaptiveRow(spacing: 16) {
                SetupDiagramStep(symbol: "iphone", title: "Your device", detail: "Keeps a private key share")
                Image(systemName: "arrow.left.arrow.right").foregroundStyle(Color.metal).accessibilityHidden(true)
                SetupDiagramStep(symbol: "person.2", title: "Other signers", detail: "Keep their own shares")
                Image(systemName: "arrow.right").foregroundStyle(Color.metal).accessibilityHidden(true)
                SetupDiagramStep(symbol: "shield.lefthalf.filled", title: "One wallet", detail: "Needs the agreed approvals")
            }
            Text("Invite → compare the safety number → create key shares → verify the address → optionally save recovery files.")
                .font(.nativeFootnote.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            Text("Comparing the number confirms everyone is setting up the same wallet. Address verification checks each share against the shared address. Recovery files protect an individual seat if its device is lost.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
            Text("Native Zigs currently supports Zcash. Solana setup is available on the web for eligible wallets; it is not a separate native setup step.")
                .font(.nativeFootnote).foregroundStyle(Color.mist)
        }
    }
}

private struct SetupDiagramStep: View {
    let symbol: String
    let title: String
    let detail: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: symbol).font(.title2).foregroundStyle(Color.metal)
                .frame(width: 48, height: 48).modifier(InsetSurface()).accessibilityHidden(true)
            Text(title).font(.nativeSubheadline.weight(.semibold))
            Text(detail).font(.nativeFootnote).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
