import Foundation
import Observation

/// What the message screens show: wallet rooms and direct chats (CHAT.md). Only the chat part of
/// GroupModel writes it. A message namespace is a room id or a chat id: its store holds the
/// messages, sealed with its own secret.
@MainActor
@Observable
final class ChatState {
    /// A thread that a screen shows right now: the wallet or chat id, and the thread.
    struct Viewing: Hashable {
        let ns: String
        let thread: String
    }

    var book = ChatBook(nil)
    /// Wallet id -> its room id, while the room is the pinned one.
    var rooms: [String: String] = [:]
    var roomWarn: [String: String] = [:]
    /// Room id or chat id -> its messages, oldest first.
    var messages: [String: [ChatMessage]] = [:]
    /// Room ids and chat ids that hold more documents than Zigs reads (`Chat.maxDocs`).
    var crowded = Set<String>()
    /// Chat id -> the members that its member documents show.
    var members: [String: [String: Chat.Member]] = [:]
    /// Contact links that wait for "Join chat": chat id -> secret.
    var offers: [String: String] = [:]
    /// "room or chat id:thread" -> time of the newest message from others that was shown.
    var marks: [String: Int] = [:]
    /// Wallet id -> the ids of its payments, for the threads that can hold unread messages.
    var payments: [String: Set<String>] = [:]

    @ObservationIgnored var viewing = Set<Viewing>()
    @ObservationIgnored var active = true
    /// Room id -> secret. The first secret seen for an id wins.
    @ObservationIgnored var roomKeys: [String: String] = [:]
    /// The secret of a chat while this device joins it, before the chat is saved.
    @ObservationIgnored var pending: [String: String] = [:]
    @ObservationIgnored var seeded = Set<String>()
    /// Room id or chat id -> document id -> what reading it gave. A document is opened once.
    @ObservationIgnored var opened: [String: [String: Chat.Opened]] = [:]
    /// The namespaces whose new documents are being opened off the main thread.
    @ObservationIgnored var opening = Set<String>()
    @ObservationIgnored var tried: [String: Date] = [:]
    @ObservationIgnored let roomPins = Pins("zf-rooms")
    @ObservationIgnored let chatPins = Pins("zf-chatpins")

    init() {
        marks = UserDefaults.standard.dictionary(forKey: "zf-read") as? [String: Int] ?? [:]
    }
}

/// A line of a message log: a message, or a payment event of the wallet thread.
enum LogItem: Identifiable {
    case message(ChatMessage)
    case event(id: String, at: Int, sid: String, text: String, unread: Int)

    var id: String {
        switch self {
        case .message(let m): m.id
        case .event(let id, _, _, _, _): id
        }
    }

    var at: Int {
        switch self {
        case .message(let m): m.at
        case .event(_, let at, _, _, _): at
        }
    }
}

extension GroupModel {
    // MARK: Namespaces

    /// The secret of a message room or a chat, or nil.
    func namespaceKey(_ id: String) -> String? {
        chat.roomKeys[id] ?? chat.book.list[id]?.key ?? chat.pending[id]
    }

    /// A chat or a message room: its id must never name a wallet.
    func isChatId(_ id: String) -> Bool { chat.book.list[id] != nil || chat.roomKeys[id] != nil }

    func isWalletId(_ id: String) -> Bool { vault.keys[id] != nil || chat.book.list[id] != nil }

    /// Reads rooms and chats from the store after every change, and starts what is missing.
    func syncChats() {
        guard !locked else { return }
        let book = ChatBook(vault.chats)
        if book != chat.book { chat.book = book }
        recallRooms()
        adoptRooms()
        readRooms()
        readChats()
        dropUnwatched()
        seedMarks()
        ensureRooms()
        ensureSignKeys()
        markRead()
    }

    /// Runs a background write at most once in 30 seconds for each key, and never shows its error
    /// in a banner. The reactor runs often, and each failed write counts against the server.
    func quiet(_ key: String, _ op: @escaping @MainActor () async throws -> Void) {
        if let last = chat.tried[key], Date().timeIntervalSince(last) < 30 { return }
        chat.tried[key] = Date()
        Task { @MainActor in
            do { try await op() } catch { self.note("✗ \(key): \(error.localizedDescription)") }
        }
    }

    private func setMessages(_ ns: String, _ list: [ChatMessage]) {
        if chat.messages[ns] != list { chat.messages[ns] = list }
    }

    /// Sets the flag only when it changes, so a refresh that finds the same state wakes no screen.
    private func setCrowded(_ ns: String, _ on: Bool) {
        guard chat.crowded.contains(ns) != on else { return }
        if on { chat.crowded.insert(ns) } else { chat.crowded.remove(ns) }
    }

    /// Reads the message documents of a room or a chat. A document is opened once, and again only
    /// when its sealed fields change. New documents open off the main thread, so a flood of them
    /// cannot freeze the app. A namespace with more than `Chat.maxDocs` documents is not read.
    private func readMessages(_ ns: String, _ kind: Chat.Kind) {
        let path = "groups/\(ns)/messages"
        let sealed = store.children(path).mapValues(Chat.sealedFields)
        let crowded = sealed.count > Chat.maxDocs
        setCrowded(ns, crowded)
        if crowded { return }
        let plan = Chat.plan(cache: chat.opened[ns] ?? [:], store: sealed)
        chat.opened[ns] = plan.keep
        // The first list waits for the first documents: an empty list would seed the read marks.
        if plan.read.isEmpty || chat.messages[ns] != nil {
            setMessages(ns, plan.keep.values.compactMap(\.message).sorted(by: Chat.byTime))
        }
        guard !plan.read.isEmpty, let key = namespaceKey(ns),
              chat.opening.insert(ns).inserted else { return }
        let todo = plan.read.compactMap { id in sealed[id].map { (id: id, sealed: $0) } }
        Task {
            let done = await Task.detached { Chat.openAll(kind, path, key, todo) }.value
            self.chat.opening.remove(ns)
            self.chat.opened[ns, default: [:]].merge(done) { $1 }
            self.readMessages(ns, kind)   // documents may have come or changed meanwhile
            // Messages that arrive while their screen is open count as read.
            self.seedMarks()
            self.markRead()
        }
    }

    // MARK: Rooms

    /// Seat secrets keep each room (and backups carry it), so a room field that is later lost or
    /// damaged in the store cannot take the room with it after a restart.
    private func recallRooms() {
        for k in vault.secrets.keys.sorted() {
            guard let room = Chat.room(vault.secrets[k]?.doc("room")),
                  let gid = k.split(separator: ":").first else { continue }
            if chat.roomKeys[room.id] == nil { chat.roomKeys[room.id] = room.key }
            chat.roomPins.pin(String(gid), room.id)
        }
    }

    private func adoptRooms() {
        var rooms = chat.rooms, warns = chat.roomWarn
        for g in groups {
            let r = Chat.adoptRoom(g.id, g.room, pinned: chat.roomPins[g.id], keys: chat.roomKeys,
                                   isWallet: isWalletId)
            if r.pick == .use, let room = Chat.room(g.room) { learnRoom(g.id, room) }
            rooms[g.id] = r.id
            warns[g.id] = r.warning
        }
        if rooms != chat.rooms { chat.rooms = rooms }
        if warns != chat.roomWarn { chat.roomWarn = warns }
    }

    private func pickRoom(_ gid: String, _ room: Doc?) -> Chat.RoomPick {
        Chat.pickRoom(gid, room, pinned: chat.roomPins[gid], isWallet: isWalletId)
    }

    private func learnRoom(_ gid: String, _ room: (id: String, key: String)) {
        if chat.roomKeys[room.id] == nil { chat.roomKeys[room.id] = room.key }
        chat.roomPins.pin(gid, room.id)
        let doc: Doc = ["id": room.id, "key": room.key]
        for i in vault.seats(in: gid) where Chat.room(vault.sec(gid, i).doc("room")) == nil {
            vault.putSec(gid, i, ["room": doc])
        }
    }

    /// Reads the room of every wallet where this device holds a seat, open or not.
    private func readRooms() {
        for (gid, rid) in chat.rooms where !vault.seats(in: gid).isEmpty {
            store.join(rid)
            guard store.loaded(rid) else { continue }
            readMessages(rid, .room)
        }
    }

    /// Forgets the messages of a room that is no longer watched and of a chat that was left.
    private func dropUnwatched() {
        var wanted = Set(chat.book.list.keys)
        for (gid, rid) in chat.rooms where !vault.seats(in: gid).isEmpty { wanted.insert(rid) }
        for ns in chat.messages.keys where !wanted.contains(ns) { forgetMessages(ns) }
        for cid in chat.members.keys where chat.book.list[cid] == nil { chat.members[cid] = nil }
    }

    private func forgetMessages(_ ns: String) {
        chat.messages[ns] = nil
        chat.opened[ns] = nil
        chat.crowded.remove(ns)
    }

    private func ensureRooms() {
        for g in groups where !vault.seats(in: g.id).isEmpty {
            let pick = pickRoom(g.id, g.room)
            if pick == .none || pick == .missing {
                quiet("room:" + g.id) { try await self.publishRoom(g.id) }
            }
        }
    }

    /// Writes the room field of a wallet that names none. A wallet with a pinned room gets that
    /// room again, and never a new one: a new room would split the signers.
    private func publishRoom(_ gid: String) async throws {
        let room: (id: String, key: String)
        if let pinned = chat.roomPins[gid] {
            guard let key = chat.roomKeys[pinned] else { return }   // another signer can help
            room = (pinned, key)
        } else {
            room = try Chat.newRoom()
        }
        let path = "groups/\(gid)"
        guard try await store.acquire(path, holder: UUID().uuidString, ttlMs: 10_000),
              let cur = open(path, store.docs[path]) else { return }
        let pick = pickRoom(gid, cur.doc("room"))
        guard pick == .none || pick == .missing else { return }
        try await patch(path, ["room": ["id": room.id, "key": room.key] as Doc])
        note("message room written")
    }

    // MARK: Seat keys

    /// Pins the first signing key of each seat of a wallet before version 3, from the store only.
    /// A version 3 wallet pins through its signed seat documents (pinSeats).
    func pinLegacySeats(_ gid: String, _ s: GroupState) {
        guard !signedMode(gid) else { return }
        for i in s.seatIds {
            if let pk = s.seats["\(i)"]?.str("signPk"), Signed.validPk(pk) {
                signPins.pin("\(gid):\(i)", pk)
            }
        }
    }

    /// A seat of a wallet before version 3 that was made before messages gets its signing key
    /// once. A version 3 seat document is signed, so an update would break its signature.
    private func ensureSignKeys() {
        guard let gid, state.g != nil, !signedMode(gid) else { return }
        for i in localSeats where !Signed.validPk(state.seats["\(i)"]?.str("signPk") ?? "") {
            quiet("sign:\(gid):\(i)") { try await self.addSignKey(gid, i) }
        }
    }

    /// The lease comes first, so two devices cannot make two keys. The key is published only after
    /// this device saved it. An older backup lacks the key, so a new key on a backed-up seat
    /// clears `backupSaved` and the app asks for a new backup.
    private func addSignKey(_ gid: String, _ i: Int) async throws {
        let path = "groups/\(gid)/seats/\(i)"
        let leased = try await store.acquire(path, holder: UUID().uuidString, ttlMs: 10_000)
        guard leased else { return }
        let held = vault.sec(gid, i)
        if held.str("signPk") == nil {
            let key = Signed.newKey()
            var made: Doc = ["signSk": key.signSk, "signPk": key.signPk]
            if has(held["keyPackage"]) { made["backupSaved"] = false }
            guard vault.putSec(gid, i, made) else {
                throw ZigsError("The signing key was not saved.")
            }
        }
        guard let cur = open(path, store.docs[path]),
              !Signed.validPk(cur.str("signPk") ?? ""),
              let pk = vault.sec(gid, i).str("signPk") else { return }
        try await patch(path, ["signPk": pk])
    }

    /// Seats whose signing key changed after this device pinned it.
    var changedSigners: [Int] {
        guard let gid else { return [] }
        return state.seatIds.filter { i in
            guard let pk = signPins["\(gid):\(i)"], Signed.validPk(pk) else { return false }
            return state.seats["\(i)"]?.str("signPk") != pk
        }
    }

    // MARK: Wallet messages

    /// Seats of this device that hold the signing key that their seat document names.
    var sendSeats: [Int] {
        guard let gid else { return [] }
        return localSeats.filter { i in
            let s = vault.sec(gid, i)
            return s.str("signSk") != nil && s.str("signPk") != nil
                && s.str("signPk") == state.seats["\(i)"]?.str("signPk") && canWriteAs(i, in: gid)
        }
    }

    /// True once the room of the open wallet has sent its messages.
    var roomLoaded: Bool {
        guard let gid, let rid = chat.rooms[gid] else { return false }
        return chat.messages[rid] != nil
    }

    /// Why this device cannot send in the open wallet, or nil.
    var roomWhy: String? {
        guard let gid else { return nil }
        if let warning = chat.roomWarn[gid] { return warning }
        if let rid = chat.rooms[gid], chat.crowded.contains(rid) { return Chat.crowded }
        if localSeats.isEmpty { return "Take a seat to read and send messages." }
        if chat.rooms[gid] == nil { return "The message room is being set up." }
        if !sendSeats.isEmpty { return nil }
        let making = localSeats.contains {
            !Signed.validPk(state.seats["\($0)"]?.str("signPk") ?? "")
        }
        return making ? "Your seat key is being created."
            : "This \(deviceName) has no signing key for your seat, so it cannot send messages. "
                + "A backup file from before messages does not hold this key."
    }

    func sendRoomMessage(_ text: String, thread: String, seat: Int) async throws {
        guard let gid, let rid = chat.rooms[gid], sendSeats.contains(seat),
              Chat.validThread(thread) else {
            throw ZigsError(roomWhy ?? "This message cannot be sent.")
        }
        let m = ChatMessage(id: try secureHex(10), thread: thread, text: text, at: now(),
                            seat: seat)
        let sig = try Signed.sign(vault.sec(gid, seat).str("signSk"), Chat.signedText(gid, rid, m))
        let doc: Doc = ["seat": seat, "thread": thread, "text": text, "at": m.at, "sig": sig]
        let path = "groups/\(rid)/messages/\(m.id)"
        try await store.set(path, seal(path, doc), timeout: 10)
    }

    /// The name of a seat next to its messages. A version 3 wallet adds the seat number, because
    /// two seats can use one name.
    func senderName(_ seat: Int) -> String {
        guard state.seats["\(seat)"] != nil, state.seatIds.contains(seat) else {
            return "Unknown sender"
        }
        let label = seatLabel(seat)
        return isSigned && !label.contains("(seat") ? "\(label) (seat \(seat))" : label
    }

    func roomTrust(_ m: ChatMessage) -> Chat.Trust {
        guard let gid, let rid = chat.rooms[gid] else { return .no }
        let seat = state.seats["\(m.seat)"]
        let who = Chat.Standing(isMember: seat != nil && state.seatIds.contains(m.seat),
                                memberPk: seat?.str("signPk"),
                                pinnedPk: signPins["\(gid):\(m.seat)"])
        return Chat.roomVerdict(gid, rid, m, who, check: memoCheck("\(rid)|\(m.id)|\(m.sig)"))
    }

    /// A signature check that the memo answers again for the same text and key.
    private func memoCheck(_ key: String) -> (String, String, String) -> Bool {
        { [signMemo] pk, sig, text in
            signMemo.verdict("msg|" + key, text, pk) { Signed.verify(pk, sig, text) }
        }
    }

    /// The messages of one thread of the open wallet, with the payment events of the wallet
    /// thread, oldest first.
    func walletLog(_ thread: String) -> [LogItem] {
        guard let gid, let rid = chat.rooms[gid] else { return [] }
        let msgs = (chat.messages[rid] ?? []).filter { $0.thread == thread }.map(LogItem.message)
        let events = thread == "wallet" ? state.sessions.flatMap { payEvents($0) } : []
        return (msgs + events).sorted { $0.at != $1.at ? $0.at < $1.at : $0.id < $1.id }
    }

    private func payEvents(_ ss: Session) -> [LogItem] {
        let title = payTitle(ss), created = ss.doc.int("createdAt") ?? 0
        let who = proposerName(ss)
        let proposer = who.prefix(1).uppercased() + String(who.dropFirst())
        func event(_ n: String, _ at: Int, _ text: String, _ count: Int = 0) -> LogItem {
            .event(id: ss.id + ":" + n, at: at, sid: ss.id, text: text, unread: count)
        }
        let fresh = unread(gid ?? "", thread: "pay:" + ss.id)
        var out = [event("1", created, proposer + " proposed " + title, fresh)]
        if let sent = ss.doc.int("broadcastAt") { out.append(event("2", sent, "Sent: " + title)) }
        if ss.status == "cancelled" {
            let at = Chat.cancelledAt(ss.doc, created: created)
            out.append(event("3", at, "Cancelled: " + title))
        }
        return out
    }

    /// Who proposed a payment. In a version 3 wallet it is the seat in `by`. Before, it is the
    /// identity in `createdBy`.
    func proposerName(_ ss: Session) -> String {
        if let by = ss.doc.int("by") {
            return localSeats.contains(by) ? "you" : "\(seatLabel(by)) (seat \(by))"
        }
        guard let uid = ss.doc.str("createdBy") else { return "someone" }
        if isMe(uid) { return "you" }
        let seat = state.seats.first { $0.value.str("uid") == uid }
        return seat.flatMap { $0.value.str("name") }.flatMap { $0.isEmpty ? nil : $0 } ?? "a signer"
    }

    // MARK: Direct chats

    /// The secret in a contact link is as secret as the chat.
    func chatLink(_ cid: String) -> String {
        let base = server.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return "\(base)/#c.\(cid).\(chat.book.list[cid]?.key ?? "")"
    }

    func chatInvite(_ link: String) -> String {
        "I started a private chat with you on Zigs. Open this link: \(link). This link is a "
            + "secret. Do not post it in a public place. About Zigs: https://zigs.app"
    }

    /// The member id that this device pinned for the contact of a chat.
    func contactId(_ cid: String) -> String? {
        guard let mine = chat.book.list[cid]?.member else { return nil }
        return Chat.pinnedMembers(chat.chatPins.all, cid).sorted().first { $0 != mine }
    }

    func contactName(_ cid: String) -> String {
        guard let members = chat.members[cid] else { return "Loading…" }
        guard let id = contactId(cid) else { return "Waiting for your contact" }
        let name = members[id]?.name ?? ""
        return name.isEmpty ? "Your contact" : name
    }

    private func pinChat(_ cid: String, _ member: String, _ pk: String) {
        chat.chatPins.change { Chat.pinMember(&$0, cid, member, pk) }
    }

    /// Reads the member documents of a chat and pins the members that `Chat.membersToPin` allows.
    private func readMembers(_ cid: String) {
        var out: [String: Chat.Member] = [:]
        for (id, d) in children("groups/\(cid)/members") {
            let name = String((d.str("name") ?? "").prefix(40))
            out[id] = Chat.Member(name: name, signPk: d.str("signPk"))
        }
        let pinned = Chat.pinnedMembers(chat.chatPins.all, cid)
        for id in Chat.membersToPin(out, pinned: pinned, mine: chat.book.list[cid]?.member) {
            if let pk = out[id]?.signPk { pinChat(cid, id, pk) }
        }
        if chat.members[cid] != out { chat.members[cid] = out }
    }

    private func readChats() {
        for cid in chat.book.list.keys {
            store.join(cid)
            guard store.loaded(cid) else { continue }
            readMembers(cid)
            readMessages(cid, .chat)
            healMember(cid)
        }
    }

    /// A chat saved while the connection dropped may lack this device's member document. It is
    /// written again while the chat has room, so the contact can still join.
    private func healMember(_ cid: String) {
        guard let saved = chat.book.list[cid], let profile = chat.book.profile,
              let members = chat.members[cid], members[saved.member] == nil,
              members.count < 2 else { return }
        quiet("member:" + cid) {
            let doc: Doc = ["name": self.name, "signPk": profile.signPk, "at": now()]
            try await self.put("groups/\(cid)/members/\(saved.member)", doc)
        }
    }

    func dmTrust(_ m: ChatMessage, in cid: String) -> Chat.Trust {
        let member = chat.members[cid]?[m.from]
        let who = Chat.Standing(isMember: member != nil, memberPk: member?.signPk,
                                pinnedPk: chat.chatPins[cid + ":" + m.from])
        return Chat.dmVerdict(cid, m, who, check: memoCheck("\(cid)|\(m.id)|\(m.sig)"))
    }

    func sendDm(_ text: String, in cid: String) async throws {
        guard let saved = chat.book.list[cid], let profile = chat.book.profile else {
            throw ZigsError("This chat is not on this \(deviceName).")
        }
        let m = ChatMessage(id: try secureHex(10), thread: "dm", text: text, at: now(),
                            from: saved.member)
        let sig = try Signed.sign(profile.signSk, Chat.dmText(cid, m))
        let doc: Doc = ["from": saved.member, "text": text, "at": m.at, "sig": sig]
        let path = "groups/\(cid)/messages/\(m.id)"
        try await store.set(path, seal(path, doc), timeout: 10)
    }

    private func badChatLink(_ cid: String, _ key: String) -> Bool {
        !Chat.validRoom(cid, key) || vault.keys[cid] != nil || chat.roomKeys[cid] != nil
    }

    /// A contact link waits here until the person taps "Join chat": a link that is only opened,
    /// for example by a link scanner, must not take the second place. A chat that this device
    /// has opens at once.
    func offerChat(_ cid: String, _ key: String) {
        let known = chat.book.list[cid]
        if key.isEmpty {
            if known != nil { path = [Chat.route(cid)] } else { banner = Chat.missingSecret }
        } else if badChatLink(cid, key) {
            banner = Chat.badContactLink
        } else if let known {
            if known.key == key { path = [Chat.route(cid)] } else { banner = Chat.differentSecret }
        } else {
            chat.offers[cid] = key
            path = []
        }
    }

    func createChat() async throws -> String {
        let room = try Chat.newRoom()
        try await enterChat(room.id, room.key)
        return room.id
    }

    /// The lease keeps two openers of one link apart. A chat holds two members, and only a chat
    /// with exactly one member and a free lease can be joined.
    func joinChat(_ cid: String) async throws {
        guard let key = chat.offers[cid] else { return }
        chat.pending[cid] = key
        defer { chat.pending[cid] = nil }
        if badChatLink(cid, key) { throw ZigsError(Chat.badContactLink) }
        store.join(cid)
        let leased = try await store.acquire("groups/\(cid)/meta/join", holder: UUID().uuidString,
                                             ttlMs: 10_000)
        let count = children("groups/\(cid)/members").count
        if let blocked = Chat.joinBlock(count: count, leased: leased) { throw ZigsError(blocked) }
        readMembers(cid)   // pins the first member before this device becomes the second
        try await enterChat(cid, key)
        chat.offers[cid] = nil
    }

    func declineChat(_ cid: String) { chat.offers[cid] = nil }

    /// The chat and the key are saved here before the member document goes to the server, so a
    /// failed save cannot leave a place taken that this device does not know about.
    private func enterChat(_ cid: String, _ key: String) async throws {
        var book = chat.book
        let profile = book.profile ?? Self.newProfile()
        let member = try secureHex(10)
        book.profile = profile
        book.list[cid] = SavedChat(key: key, member: member, at: now())
        guard vault.putChats(book.doc) else {
            throw ZigsError("Could not save the chat on this \(deviceName), so it was not opened.")
        }
        chat.book = book
        store.join(cid)
        do {
            let doc: Doc = ["name": name, "signPk": profile.signPk, "at": now()]
            try await put("groups/\(cid)/members/\(member)", doc)
        } catch {
            forgetChat(cid)
            throw error
        }
        pinChat(cid, member, profile.signPk)
        chat.offers[cid] = nil
        path = [Chat.route(cid)]
    }

    private static func newProfile() -> SignKey {
        let key = Signed.newKey()
        return SignKey(signSk: key.signSk, signPk: key.signPk)
    }

    /// Takes a chat out of the saved ones. Returns false when the Keychain did not save it.
    @discardableResult
    private func forgetChat(_ cid: String) -> Bool {
        var book = chat.book
        book.list[cid] = nil
        guard vault.putChats(book.doc) else { return false }
        chat.book = book
        return true
    }

    /// "Leave chat" removes the chat from this device. The sealed messages stay on the group
    /// server.
    func leaveChat(_ cid: String) throws {
        guard forgetChat(cid) else {
            throw ZigsError("Could not save this change on this \(deviceName), so the chat stays.")
        }
        chat.chatPins.forget(prefix: cid + ":")
        store.leave(cid)
        forgetMessages(cid)
        chat.members[cid] = nil
        path = []
    }

    // MARK: Unread

    /// The id that the read marks of a conversation hang on: the room of a wallet, or the chat.
    private func markId(_ ns: String) -> String? {
        chat.book.list[ns] != nil ? ns : chat.rooms[ns]
    }

    private func mineIn(_ ns: String) -> [String] {
        if let saved = chat.book.list[ns] { return [saved.member] }
        return vault.seats(in: ns).map(String.init)
    }

    /// Messages that can be unread: those of a chat, and in a wallet the wallet thread and the
    /// threads of payments that exist. A message dated far ahead is shown but not counted.
    private func countable(_ ns: String) -> [ChatMessage] {
        guard let id = markId(ns) else { return [] }
        let horizon = now() + Chat.skew
        let list = (chat.messages[id] ?? []).filter { $0.at <= horizon }
        if chat.book.list[ns] != nil { return list }
        let sessions = ns == gid ? Set(state.sessions.map(\.id)) : chat.payments[ns] ?? []
        let threads = Set(["wallet"] + sessions.map { "pay:" + $0 })
        return list.filter { threads.contains($0.thread) }
    }

    /// Unread messages of a wallet (one `thread`, or all) or of a chat.
    func unread(_ ns: String, thread: String? = nil) -> Int {
        guard let id = markId(ns) else { return 0 }
        return Chat.countUnread(countable(ns), mine: mineIn(ns), marks: chat.marks, roomId: id,
                                thread: thread)
    }

    /// A screen shows a thread (`on`), or stops showing it.
    func viewThread(_ ns: String, _ thread: String, on: Bool) {
        let key = ChatState.Viewing(ns: ns, thread: thread)
        if on { chat.viewing.insert(key) } else { chat.viewing.remove(key) }
        markRead()
    }

    /// A window that does not show Zigs is not reading.
    func setActive(_ active: Bool) {
        chat.active = active
        markRead()
    }

    private func saveMarks(_ marks: [String: Int]) {
        guard marks != chat.marks else { return }
        chat.marks = marks
        UserDefaults.standard.set(marks, forKey: "zf-read")
    }

    // ponytail: the read mark is the time of the newest message from another sender that this
    // device showed. A sender clock behind another sender's clock can make its new messages
    // count as read. Upgrade path: seen ids.
    private func markRead() {
        guard chat.active else { return }
        var marks = chat.marks
        for v in chat.viewing {
            guard let id = markId(v.ns) else { continue }
            let mine = mineIn(v.ns)
            let top = countable(v.ns).filter { $0.thread == v.thread && !mine.contains($0.sender) }
                .map(\.at).max() ?? 0
            let k = id + ":" + v.thread
            if top > (marks[k] ?? 0) { marks[k] = top }
        }
        saveMarks(marks)
    }

    /// Seeds the marks of each namespace once, after its first documents have arrived.
    private func seedMarks() {
        for (ns, list) in chat.messages where store.loaded(ns) && !chat.seeded.contains(ns) {
            chat.seeded.insert(ns)
            let main = chat.book.list[ns] != nil ? "dm" : "wallet"
            if let marks = Chat.seededMarks(chat.marks, id: ns, main: main, messages: list,
                                            now: now()) {
                saveMarks(marks)
            }
        }
    }
}
