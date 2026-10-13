import SwiftUI

/// What a message row shows besides its text.
struct BubbleInfo {
    let name: String
    let mine: Bool
    let trust: Chat.Trust
}

private let trustLabels: [Chat.Trust: String] = [
    .no: "Not verified", .changed: "Key changed. Not verified.",
    .unknown: "Unknown sender. Not verified.",
]

struct Bubble: View {
    let m: ChatMessage
    let info: BubbleInfo

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Avatar(text: initials(info.name), mine: info.mine, size: 32)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(info.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(when(m.at)).font(.caption).foregroundStyle(Color.mist)
                    if info.trust == .yes {
                        Text("✓ Verified").font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.good)
                    }
                }
                if let label = trustLabels[info.trust] { Badge(text: label, kind: .bad) }
                Text(verbatim: m.text).font(.subheadline).textSelection(.enabled)
            }
        }
    }
}

/// A payment event of the wallet thread. A tap opens the payment.
private struct EventRow: View {
    let sid: String
    let text: String
    let at: Int
    let unread: Int

    var body: some View {
        NavigationLink { SessionView(sid: sid) } label: {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(Color.mist)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: text).font(.subheadline).foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                    Text(when(at)).font(.caption).foregroundStyle(Color.mist)
                }
                Spacer()
                if unread > 0 { Badge(text: "\(unread) new", kind: .info) }
            }
            .padding(10)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

/// The log of one thread, oldest first, in a box that scrolls. It stays at its end when new
/// messages come. Only the log redraws when messages change: the composer is a sibling with its
/// own state, so a draft and the keyboard stay.
struct MessageLog: View {
    var empty = "No messages yet."
    let items: [LogItem]
    let info: (ChatMessage) -> BubbleInfo
    @State private var shown = 100

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if items.count > shown {
                        Button("Show earlier messages") { shown += 100 }.font(.caption)
                    }
                    if items.isEmpty {
                        Text(empty).font(.subheadline).foregroundStyle(Color.mist)
                    }
                    ForEach(items.suffix(shown)) { row($0) }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 380)
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: items.last?.id) { _, id in
                if let id { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
        .background(Color.night, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Messages")
    }

    @ViewBuilder private func row(_ item: LogItem) -> some View {
        switch item {
        case .message(let m): Bubble(m: m, info: info(m))
        case .event(_, let at, let sid, let text, let unread):
            EventRow(sid: sid, text: text, at: at, unread: unread)
        }
    }
}

/// The box to write a message. The text field is never disabled, so a refresh of the page cannot
/// close the keyboard. A reason why sending is off disables the button only.
struct Composer: View {
    @Environment(GroupModel.self) private var model
    let placeholder: String
    let why: String?
    var seats: [Int] = []
    let send: @MainActor (String, Int?) async throws -> Void
    @State private var text = ""
    @State private var seat: Int?
    @State private var sending = false

    private var chosen: Int? { seat.flatMap { seats.contains($0) ? $0 : nil } ?? seats.first }

    var body: some View {
        let checked = Chat.checkText(text)
        VStack(alignment: .leading, spacing: 8) {
            if let why { Text(why).font(.caption).foregroundStyle(Color.mist) }
            if seats.count > 1 {
                Picker("Send as", selection: Binding(get: { chosen ?? 0 }, set: { seat = $0 })) {
                    ForEach(seats, id: \.self) { Text("Seat \($0)").tag($0) }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .onSubmit(submit)
                    .padding(10)
                    .background(Color.night, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.line))
                Button("Send", systemImage: "arrow.up", action: submit)
                    .labelStyle(.iconOnly)
                    .primaryButton()
                    .disabled(why != nil || sending || !isSendable(checked))
            }
            if case .failure(let e) = checked, !text.trimmingCharacters(in: .whitespaces).isEmpty {
                Text(e.message).font(.caption).foregroundStyle(Color.bad)
            }
        }
    }

    private func isSendable(_ r: Result<String, ZigsError>) -> Bool {
        if case .success = r { return true }
        return false
    }

    private func submit() {
        guard why == nil, !sending, case .success(let body) = Chat.checkText(text) else { return }
        let draft = text, who = chosen
        sending = true
        Task {
            do {
                try await send(body, who)
                if text == draft { text = "" }
            } catch {
                model.banner = error.localizedDescription
            }
            sending = false
        }
    }
}

/// Reports the thread that a screen shows, so its new messages count as read.
private struct Viewing: ViewModifier {
    @Environment(GroupModel.self) private var model
    let ns: String
    let thread: String

    func body(content: Content) -> some View {
        content
            .onAppear { model.viewThread(ns, thread, on: true) }
            .onDisappear { model.viewThread(ns, thread, on: false) }
    }
}

extension View {
    func viewing(_ ns: String, _ thread: String) -> some View {
        modifier(Viewing(ns: ns, thread: thread))
    }
}

// MARK: Wallet room

private let roomFine = "Signers, and anyone else who has the invite link, can read these messages. "
    + "The group server stores them sealed and sees only when they are sent."

/// A thread of the open wallet. The log shows once the room has loaded.
struct WalletThread: View {
    @Environment(GroupModel.self) private var model
    let thread: String
    let empty: String

    var body: some View {
        if let gid = model.gid {
            if model.roomLoaded {
                MessageLog(empty: empty, items: model.walletLog(thread)) { m in
                    BubbleInfo(name: model.senderName(m.seat),
                               mine: model.localSeats.contains(m.seat), trust: model.roomTrust(m))
                }
            }
            Composer(placeholder: "Message to the signers", why: model.roomWhy,
                     seats: model.sendSeats) { text, seat in
                try await model.sendRoomMessage(text, thread: thread, seat: seat ?? 0)
            }
            .viewing(gid, thread)
        }
    }
}

/// The wallet thread, as a tab of the wallet and on the setup page.
struct MessagesTab: View {
    @Environment(GroupModel.self) private var model

    var body: some View {
        let changed = model.changedSigners
        Card {
            Text("Messages").font(.headline)
            if !changed.isEmpty {
                let seats = changed.map { "seat \($0)" }.joined(separator: ", ")
                Text("Signing key changed: \(seats). Their messages are not verified.")
                    .font(.subheadline).foregroundStyle(Color.bad)
            }
            WalletThread(thread: "wallet", empty: roomFine)
            Text(roomFine).font(.caption).foregroundStyle(Color.mist)
        }
    }
}

/// The thread of one payment, under the payment's steps.
struct Discussion: View {
    let sid: String

    var body: some View {
        Card {
            Text("Discussion").font(.headline)
            WalletThread(thread: "pay:" + sid, empty: "No messages about this payment yet.")
        }
    }
}

// MARK: Direct chats

private struct ChatRow: View {
    @Environment(GroupModel.self) private var model
    let cid: String

    var body: some View {
        let name = model.contactName(cid), n = model.unread(cid)
        HStack(spacing: 12) {
            Avatar(text: initials(model.contactId(cid) == nil ? "" : name), size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(.headline).foregroundStyle(.white)
                Text("Direct chat · group server").font(.caption).foregroundStyle(Color.mist)
            }
            Spacer()
            if n > 0 { Badge(text: "\(n) new", kind: .info) }
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.mist)
        }
        .padding(14)
        .contentShape(Rectangle())
    }
}

/// The chats on the home screen, with the button for a new one.
struct ChatsCard: View {
    @Environment(GroupModel.self) private var model
    let newChat: () -> Void

    var body: some View {
        let list = model.chat.book.list
        let ids = list.keys.sorted { (list[$0]?.at ?? 0, $0) < (list[$1]?.at ?? 0, $1) }
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Chats").font(.headline)
                Spacer()
                Button("New chat", action: newChat).font(.subheadline)
            }
            .padding(14)
            if ids.isEmpty {
                Text("Write to one person who uses Zigs.").font(.subheadline)
                    .foregroundStyle(Color.mist).padding([.horizontal, .bottom], 14)
            }
            ForEach(ids, id: \.self) { cid in
                Divider().overlay(Color.line)
                NavigationLink(value: Chat.route(cid)) { ChatRow(cid: cid) }
            }
        }
        .background(Color.room, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.line))
    }
}

/// A contact link waits here until the person taps "Join chat".
struct JoinChatCard: View {
    @Environment(GroupModel.self) private var model
    let cid: String
    @State private var joining = false

    var body: some View {
        @Bindable var model = model
        Card(highlight: true) {
            Text("Join a chat").font(.title3.weight(.semibold))
            Text("Someone sent you a contact link. A chat holds two people. "
                 + "Your contact sees the name below.")
                .font(.subheadline).foregroundStyle(Color.mist)
            TextField("Any nickname · shown to your contact", text: $model.name)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancel") { model.declineChat(cid) }.buttonStyle(.bordered)
                    .controlSize(.large).disabled(joining)
                Button(joining ? "Joining the chat…" : "Join chat", action: join)
                    .primaryButton().disabled(joining)
            }
        }
    }

    private func join() {
        joining = true
        Task {
            do { try await model.joinChat(cid) } catch { model.banner = error.localizedDescription }
            joining = false
        }
    }
}

struct NewChatSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var working = false

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section("Your name") {
                    TextField("Any nickname · shown to your contact", text: $model.name)
                }
                Section {
                    Text("You get a contact link. Send it to one person. Then the two of you "
                         + "can write to each other.")
                        .font(.footnote).foregroundStyle(Color.mist)
                }
            }
            .navigationTitle("New chat")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", action: create).disabled(working)
                }
            }
        }
    }

    private func create() {
        working = true
        Task {
            do {
                _ = try await model.createChat()
                dismiss()
            } catch {
                model.banner = error.localizedDescription
            }
            working = false
        }
    }
}

private let chatFine = "Your contact, and anyone else who has the contact link, can read these "
    + "messages. Keep the link private. The group server stores them sealed. It sees when you "
    + "write, and that your two devices use this chat."

/// The contact link, until the contact has joined.
private struct ChatInviteCard: View {
    @Environment(GroupModel.self) private var model
    let cid: String
    @State private var showQR = false

    var body: some View {
        let link = model.chatLink(cid)
        Card(highlight: true) {
            Text("Invite your contact").font(.title3.weight(.semibold))
            Text("Send this link to one person through a private channel. Until they open it, "
                 + "anyone who has the link can join the chat.")
                .font(.subheadline).foregroundStyle(Color.mist)
            Text(link).font(.caption.monospaced()).lineLimit(2).truncationMode(.middle)
            HStack {
                ShareLink(item: model.chatInvite(link)) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }.primaryButton()
                CopyButton(text: link, label: "Copy link").buttonStyle(.bordered)
                    .controlSize(.large)
            }
            DisclosureGroup("Show QR code", isExpanded: $showQR) {
                QRCode(text: link).frame(maxWidth: 240).frame(maxWidth: .infinity)
            }
            .font(.subheadline)
        }
    }
}

struct ChatScreen: View {
    @Environment(GroupModel.self) private var model
    let cid: String
    @State private var leaving = false

    var body: some View {
        if model.chat.book.list[cid] == nil {
            ContentUnavailableView("Chat not found", systemImage: "bubble.left")
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if model.chat.members[cid] != nil && model.contactId(cid) == nil {
                        ChatInviteCard(cid: cid)
                    }
                    conversation
                    Button("Leave chat", role: .destructive) { leaving = true }
                        .font(.subheadline)
                }
                .padding(16)
            }
            .background(Color.night)
            .navigationTitle(model.contactName(cid))
            .inlineTitle()
            .confirmationDialog("Leave this chat?", isPresented: $leaving,
                                titleVisibility: .visible) {
                Button("Leave chat", role: .destructive) { leave() }
            } message: {
                Text(leaveText)
            }
            .viewing(cid, "dm")
            .modifier(Banners())
        }
    }

    private var leaveText: String {
        "It is removed from this \(deviceName) only. The sealed messages stay on the group server."
            + (model.contactId(cid) == nil ? "" : " You cannot join this chat again.")
    }

    private var conversation: some View {
        let msgs = model.chat.messages[cid]
        let crowded = model.chat.crowded.contains(cid)
        let warning = crowded ? Chat.crowded
            : Chat.chatWarning(model.chat.chatPins.all, cid, model.chat.members[cid], msgs ?? [])
        return Card {
            Text("Messages").font(.headline)
            if let warning { Text(warning).font(.subheadline).foregroundStyle(Color.bad) }
            MessageLog(empty: msgs == nil && !crowded ? "Loading messages…" : "No messages yet.",
                       items: (msgs ?? []).map(LogItem.message)) { m in
                let mine = m.from == model.chat.book.list[cid]?.member
                let name = mine ? "You" : m.from == model.contactId(cid) ? model.contactName(cid)
                    : "Unknown sender"
                return BubbleInfo(name: name, mine: mine, trust: model.dmTrust(m, in: cid))
            }
            Composer(placeholder: "Message to your contact",
                     why: crowded ? Chat.crowded : nil) { text, _ in
                try await model.sendDm(text, in: cid)
            }
            Text(chatFine).font(.caption).foregroundStyle(Color.mist)
        }
    }

    private func leave() {
        do { try model.leaveChat(cid) } catch { model.banner = error.localizedDescription }
    }
}
