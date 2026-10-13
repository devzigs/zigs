import Foundation
import Security

/// A message of a wallet room or of a direct chat. A room message has a `seat`. A direct message
/// has `from`, a member id.
struct ChatMessage: Equatable, Identifiable {
    let id: String
    let thread: String
    let text: String
    let at: Int
    var seat = 0
    var from = ""
    var sig = ""

    /// The sender, as the unread count compares it with the own senders.
    var sender: String { from.isEmpty ? String(seat) : from }
}

/// The personal Ed25519 key of a device for direct chats, in the format of a seat key.
struct SignKey: Equatable {
    let signSk: String
    let signPk: String
}

/// A direct chat that this device joined.
struct SavedChat: Equatable {
    let key: String
    let member: String
    let at: Int
}

/// The direct chats of this device: the personal key and the chats. The same record as `zf-chats`
/// in the web app (normChats in web/chat.js). A damaged entry is dropped.
struct ChatBook: Equatable {
    var profile: SignKey?
    var list: [String: SavedChat] = [:]

    init(_ x: Doc?) {
        if let p = x?.doc("profile"), let sk = p.str("signSk"), let pk = p.str("signPk"),
           Signed.validPk(pk) {
            profile = SignKey(signSk: sk, signPk: pk)
        }
        for (id, v) in x?.doc("list") ?? [:] {
            if let saved = Self.saved(id, v as? Doc) { list[id] = saved }
        }
    }

    private static func saved(_ id: String, _ c: Doc?) -> SavedChat? {
        guard let c, let key = c.str("key"), let member = c.str("member"),
              Chat.validRoom(id, key), Chat.validId(member) else { return nil }
        return SavedChat(key: key, member: member, at: Chat.int(c["at"]) ?? 0)
    }

    var doc: Doc {
        var out: Doc = [:]
        if let profile {
            out["profile"] = ["signSk": profile.signSk, "signPk": profile.signPk] as Doc
        }
        out["list"] = list.mapValues { ["key": $0.key, "member": $0.member, "at": $0.at] as Doc }
        return out
    }
}

/// Pure rules for wallet rooms and direct chats (CHAT.md, PROTOCOL.md section 14). The same rules
/// as web/chat.js. The text that a device signs is the one that the web app builds.
enum Chat {
    static let maxText = 2000
    /// A message dated further ahead than this is never counted as unread.
    static let skew = 10 * 60_000

    static let badContactLink = "This contact link is not valid. Ask for a new one."
    static let missingSecret = "This link is missing the chat secret. Ask your contact for the "
        + "full contact link."
    static let differentSecret = "This contact link has a different secret for a chat you "
        + "already have, so it was ignored."
    static let linkChatId = "This invite link uses the id of a chat or message room that you "
        + "have, so it was ignored."
    static let roomChanged = "The message room of this wallet changed. Messages are paused. "
        + "Ask your signers."
    static let roomMissing = "The message room of this wallet is missing. Messages are paused. "
        + "Ask your signers."
    static let crowded = "This conversation has more messages than Zigs reads. Zigs stopped "
        + "reading it, so new messages do not show."

    // MARK: Ids and rooms

    private static func lowerHex(_ s: String?, _ count: Int) -> Bool {
        guard let s else { return false }
        return s.utf8.count == count
            && s.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }

    /// A room, chat or member id: 20 lowercase hex characters.
    static func validId(_ s: String?) -> Bool { lowerHex(s, 20) }

    /// A room or chat secret: 32 bytes as 43 characters of base64url.
    static func validKey(_ s: String?) -> Bool {
        guard let s else { return false }
        return s.utf8.count == 43 && s.utf8.allSatisfy(Signed.idBytes.contains)
    }

    static func validRoom(_ id: String?, _ key: String?) -> Bool { validId(id) && validKey(key) }

    /// The room in a `{id, key}` document, or nil when it is not a valid room.
    static func room(_ d: Doc?) -> (id: String, key: String)? {
        guard let id = d?.str("id"), let key = d?.str("key"), validRoom(id, key) else { return nil }
        return (id, key)
    }

    /// A new random id and secret, for a room or a chat.
    static func newRoom() throws -> (id: String, key: String) {
        var key = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, key.count, &key) == errSecSuccess else {
            throw ZigsError("This \(deviceName) could not make a random key.")
        }
        let b64 = Data(key).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return (try secureHex(10), b64)
    }

    enum RoomPick { case use, changed, missing, none }

    /// What to do with the room that wallet `gid` names: use it, `changed` (it differs from the
    /// `pinned` room), `missing` (no usable room, but one is pinned) or `none` (no usable room and
    /// no pin). A pinned wallet never gets a new room.
    static func pickRoom(_ gid: String, _ room: Doc?, pinned: String?,
                         isWallet: (String) -> Bool) -> RoomPick {
        guard let r = Self.room(room), r.id != gid, !isWallet(r.id) else {
            return pinned == nil ? .none : .missing
        }
        if let pinned, pinned != r.id { return .changed }
        return .use
    }

    /// The room that wallet `gid` uses, from its wallet document. `pinned` is the first room id
    /// this device saw for the wallet, `keys` the room secrets it holds (the first secret seen
    /// for an id wins). `id` is nil while the room is paused, and `warning` says why. A pinned
    /// room that the document lost stays in use while this device holds its secret.
    static func adoptRoom(_ gid: String, _ doc: Doc?, pinned: String?, keys: [String: String],
                          isWallet: (String) -> Bool)
        -> (pick: RoomPick, id: String?, warning: String?) {
        let pick = heldPick(gid, doc, pinned: pinned, keys: keys, isWallet: isWallet)
        let id: String? = switch pick {
        case .use: room(doc)?.id
        case .missing: pinned.flatMap { keys[$0] == nil ? nil : $0 }
        default: nil
        }
        let warnings: [RoomPick: String] = [.changed: roomChanged, .missing: roomMissing]
        return (pick, id, id == nil ? warnings[pick] : nil)
    }

    /// `pickRoom`, but `changed` when the named room has another secret than the one this device
    /// already holds for its id.
    private static func heldPick(_ gid: String, _ doc: Doc?, pinned: String?,
                                 keys: [String: String], isWallet: (String) -> Bool) -> RoomPick {
        let pick = pickRoom(gid, doc, pinned: pinned, isWallet: isWallet)
        guard pick == .use, let named = room(doc), let held = keys[named.id] else { return pick }
        return held == named.key ? pick : .changed
    }

    // MARK: Pins

    enum PinResult { case new, same, changed, unknown }

    /// The first value seen for a key is kept.
    static func pin(_ pins: inout [String: String], _ key: String, _ value: String) -> PinResult {
        guard let old = pins[key] else {
            pins[key] = value
            return .new
        }
        return old == value ? .same : .changed
    }

    static func pinnedMembers(_ pins: [String: String], _ cid: String) -> [String] {
        pins.keys.filter { $0.hasPrefix(cid + ":") }.map { String($0.dropFirst(cid.count + 1)) }
    }

    /// The first two members seen in a chat are pinned, each with the first signing key seen for
    /// it. A third member is `unknown`.
    static func pinMember(_ pins: inout [String: String], _ cid: String, _ member: String,
                          _ pk: String) -> PinResult {
        let key = cid + ":" + member
        if pins[key] == nil && pinnedMembers(pins, cid).count >= 2 { return .unknown }
        return pin(&pins, key, pk)
    }

    /// The members of a chat to pin in one pass over its member documents: this device's own
    /// member, and another member only when exactly one other new member is present. Anyone with
    /// the contact link can write a member document, and the `at` time in it proves nothing. Two
    /// new members that arrive together cannot be told apart, so none is pinned. The chat then
    /// shows its "third person" warning. A member counts only if its id and key are valid.
    static func membersToPin(_ members: [String: Member], pinned: [String], mine: String?)
        -> [String] {
        let fresh = members.filter {
            !pinned.contains($0.key) && validId($0.key) && Signed.validPk($0.value.signPk ?? "")
        }.keys
        let own = mine.flatMap { fresh.contains($0) ? $0 : nil }
        let others = fresh.filter { $0 != own }
        return (own.map { [$0] } ?? []) + (others.count == 1 ? others : [])
    }

    // MARK: Messages

    /// A whole number that JavaScript also reads as that number: not a JSON boolean, at most 2^53.
    static func int(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        return d == d.rounded() && abs(d) <= 9_007_199_254_740_992 ? n.intValue : nil
    }

    /// The text of a message, trimmed, or the reason why it cannot go out. The limit counts
    /// UTF-16 code units, as the JavaScript `length` does.
    static func checkText(_ raw: String) -> Result<String, ZigsError> {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return .failure(ZigsError("Write a message first.")) }
        let n = text.utf16.count
        if n > maxText {
            return .failure(ZigsError(
                "A message can have at most \(maxText) characters. This one has \(n)."))
        }
        return .success(text)
    }

    /// `wallet`, or `pay:` and the id of a payment (1 to 64 letters, digits, `_` or `-`).
    static func validThread(_ t: String) -> Bool {
        t == "wallet" || (t.hasPrefix("pay:") && Signed.isSessionId(t.dropFirst(4)))
    }

    /// A message document of a wallet room, or nil when it cannot be shown at all.
    static func parseMsg(_ id: String, _ d: Doc?) -> ChatMessage? {
        guard let d, let text = d.str("text"), let thread = d.str("thread"),
              let at = int(d["at"]), text.utf16.count <= maxText, validThread(thread)
        else { return nil }
        return ChatMessage(id: id, thread: thread, text: text, at: at, seat: int(d["seat"]) ?? 0,
                           sig: d.str("sig") ?? "")
    }

    /// A message document of a direct chat, or nil when it cannot be shown at all.
    static func parseDm(_ id: String, _ d: Doc?) -> ChatMessage? {
        guard let d, let text = d.str("text"), text.utf16.count <= maxText,
              let from = d.str("from"), validId(from), let at = int(d["at"]) else { return nil }
        return ChatMessage(id: id, thread: "dm", text: text, at: at, from: from,
                           sig: d.str("sig") ?? "")
    }

    /// A conversation is a wallet room or a direct chat.
    enum Kind: Sendable { case room, chat }

    /// The most message documents that Zigs reads from one conversation. A namespace holds about
    /// 10 MB, which is 5,000 to 10,000 messages of honest size (CHAT.md section 3). Anyone with the
    /// link can fill it with small ones, so past this number Zigs stops reading the namespace.
    static let maxDocs = 10_000

    /// A message document as the store holds it: the sealed text of each field.
    typealias Sealed = [String: String]

    /// What reading a document gave. `sealed` is what was read, so a document that changes is read
    /// again. `message` is nil when the document cannot be shown at all.
    struct Opened: Equatable, Sendable {
        let sealed: Sealed
        let message: ChatMessage?
    }

    static func sealedFields(_ raw: Doc) -> Sealed { raw.compactMapValues { $0 as? String } }

    /// The cached documents that still match the store, and the ids that must be read: new ones and
    /// changed ones. A document is opened once, however often the store reports a change.
    static func plan(cache: [String: Opened], store: [String: Sealed])
        -> (keep: [String: Opened], read: [String]) {
        let keep = cache.filter { store[$0.key] == $0.value.sealed }
        return (keep, store.keys.filter { keep[$0] == nil })
    }

    /// The same depth limit as the web app, which drops a stored value nested deeper than 32.
    static func shallow(_ v: Any, _ depth: Int = 0) -> Bool {
        if let d = v as? Doc { return depth < 32 && d.values.allSatisfy { shallow($0, depth + 1) } }
        if let a = v as? [Any] { return depth < 32 && a.allSatisfy { shallow($0, depth + 1) } }
        return true
    }

    /// Opens the sealed fields of one message document (`path` is its store path) and parses the
    /// message. It touches no shared state, so it can run off the main thread.
    static func openMessage(_ kind: Kind, _ id: String, _ path: String, _ key: String,
                            _ sealed: Sealed) -> ChatMessage? {
        var doc = Doc()
        for (field, ct) in sealed {
            // The path and the field are bound into the seal, so a value moved elsewhere fails.
            guard let pt = try? Engine.call("secretOpen", [key, path + "\n" + field, ct]),
                  let val = try? Engine.parse(pt), shallow(val) else { continue }
            doc[field] = val
        }
        guard !doc.isEmpty else { return nil }
        return kind == .room ? parseMsg(id, doc) : parseDm(id, doc)
    }

    /// Opens documents in turn. `path` is the collection, such as `groups/<id>/messages`.
    static func openAll(_ kind: Kind, _ path: String, _ key: String,
                        _ todo: [(id: String, sealed: Sealed)]) -> [String: Opened] {
        var out: [String: Opened] = [:]
        for (id, sealed) in todo {
            let message = openMessage(kind, id, path + "/" + id, key, sealed)
            out[id] = Opened(sealed: sealed, message: message)
        }
        return out
    }

    /// When a payment was cancelled. The app that cancels writes the time in `cancelledAt`, which
    /// no signature covers. A payment cancelled before that, or a bad value, takes the time of the
    /// proposal.
    static func cancelledAt(_ session: Doc, created: Int) -> Int {
        int(session["cancelledAt"]) ?? created
    }

    static func byTime(_ a: ChatMessage, _ b: ChatMessage) -> Bool {
        a.at != b.at ? a.at < b.at : a.id.utf16.lexicographicallyPrecedes(b.id.utf16)
    }

    /// Messages from other senders that are newer than the read mark of their thread.
    static func countUnread(_ msgs: [ChatMessage], mine: [String], marks: [String: Int],
                            roomId: String, thread: String? = nil) -> Int {
        msgs.filter {
            (thread == nil || $0.thread == thread) && !mine.contains($0.sender)
                && $0.at > (marks[roomId + ":" + $0.thread] ?? 0)
        }.count
    }

    /// The read marks of a namespace that this device sees for the first time, or nil when it has
    /// marks already. A new device treats the history it finds as read, so old messages do not
    /// all show as unread. A message dated in the future never sets a mark beyond `now`. The
    /// main thread gets a mark even when the namespace is empty, so messages that come before
    /// the next visit are unread.
    static func seededMarks(_ marks: [String: Int], id: String, main: String,
                            messages: [ChatMessage], now: Int) -> [String: Int]? {
        guard !marks.keys.contains(where: { $0.hasPrefix(id + ":") }) else { return nil }
        var out = marks
        out[id + ":" + main] = 0
        for m in messages {
            let k = id + ":" + m.thread
            out[k] = max(out[k] ?? 0, min(m.at, now))
        }
        return out
    }

    // MARK: Signed text

    private static let escapes: [UInt32: String] = [
        0x22: "\\\"", 0x5C: "\\\\", 0x08: "\\b", 0x0C: "\\f", 0x0A: "\\n", 0x0D: "\\r", 0x09: "\\t",
    ]

    /// One string as `JSON.stringify` writes it: the escapes above, `\u00xx` for the other control
    /// characters, and everything else (also `/`, U+2028 and U+2029) as it is.
    static func jsString(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            if let e = escapes[u.value] {
                out += e
            } else if u.value < 0x20 {
                out += String(format: "\\u%04x", u.value)
            } else {
                out.unicodeScalars.append(u)
            }
        }
        return out + "\""
    }

    private static func jsArray(_ items: [String]) -> String {
        "[" + items.joined(separator: ",") + "]"
    }

    /// The text that a seat signs. Other apps must build exactly this JSON text.
    static func signedText(_ gid: String, _ rid: String, _ m: ChatMessage) -> String {
        jsArray([jsString("zigs-msg-v1"), jsString(gid), jsString(rid), jsString(m.id),
                 String(m.seat), jsString(m.thread), String(m.at), jsString(m.text)])
    }

    /// The text that a member of a direct chat signs.
    static func dmText(_ cid: String, _ m: ChatMessage) -> String {
        jsArray([jsString("zigs-dm-v1"), jsString(cid), jsString(m.id), jsString(m.from),
                 String(m.at), jsString(m.text)])
    }

    // MARK: Who sent a message

    enum Trust { case yes, no, changed, unknown }

    /// What the store and the pins say about the key of a sender: `isMember` (a seat of the
    /// wallet, or a member of the chat), the key in its document and the key that this device
    /// pinned.
    struct Standing {
        var isMember: Bool
        var memberPk: String?
        var pinnedPk: String?
    }

    /// `yes` when the signature checks with the pinned key. `no` for a sender that is no member,
    /// has no pinned key, or has a bad signature. `changed` when the member document names
    /// another key than the pin.
    static func verdict(_ sig: String, _ text: String, _ who: Standing,
                        check: (_ pk: String, _ sig: String, _ text: String) -> Bool
                            = Signed.verify) -> Trust {
        guard who.isMember, let pinned = who.pinnedPk, Signed.validPk(pinned) else { return .no }
        if who.memberPk != pinned { return .changed }
        return check(pinned, sig, text) ? .yes : .no
    }

    static func roomVerdict(_ gid: String, _ rid: String, _ m: ChatMessage, _ who: Standing,
                            check: (String, String, String) -> Bool = Signed.verify) -> Trust {
        verdict(m.sig, signedText(gid, rid, m), who, check: check)
    }

    /// A sender with no pinned key is `unknown`.
    static func dmVerdict(_ cid: String, _ m: ChatMessage, _ who: Standing,
                          check: (String, String, String) -> Bool = Signed.verify) -> Trust {
        if who.pinnedPk == nil { return .unknown }
        return verdict(m.sig, dmText(cid, m), who, check: check)
    }

    // MARK: Direct chats

    /// A member of a chat, as its member document shows it.
    struct Member: Equatable {
        let name: String
        let signPk: String?
    }

    /// Why this device cannot join a chat that has `count` members, or nil. A full chat wins over
    /// a join lease that someone else holds.
    static func joinBlock(count: Int, leased: Bool) -> String? {
        if count > 1 { return "This chat already has two people. Ask for a new contact link." }
        if !leased { return "Someone else is joining this chat. Try again in a moment." }
        return count == 1 ? nil : "This contact link does not open a chat. Ask for a new one."
    }

    /// The warning that a chat page shows, or nil. Nothing is hidden: the messages stay in the log.
    static func chatWarning(_ pins: [String: String], _ cid: String, _ members: [String: Member]?,
                            _ messages: [ChatMessage]) -> String? {
        guard let members else { return nil }
        let pinned = pinnedMembers(pins, cid)
        let moved = pinned.contains {
            members[$0] == nil || members[$0]?.signPk != pins[cid + ":" + $0]
        }
        if moved {
            return "A signing key in this chat changed or is missing. "
                + "Its messages are not verified."
        }
        let third = members.keys.contains { !pinned.contains($0) }
            || messages.contains { !pinned.contains($0.from) }
        return third ? "A third person wrote in this chat. Their messages are not verified." : nil
    }

    // MARK: Links

    /// The parts of a page fragment: `#<wallet id>.<secret>` or `#c.<chat id>.<secret>`. Parts
    /// after the secret are ignored. An id that is not 20 hex characters comes back as "".
    static func parseHash(_ hash: String) -> (chat: Bool, id: String, key: String) {
        let body = hash.hasPrefix("#") ? hash.dropFirst() : Substring(hash)
        let p = body.split(separator: ".", omittingEmptySubsequences: false)
        func part(_ i: Int) -> String { i < p.count ? String(p[i]) : "" }
        let chat = part(0) == "c", at = chat ? 1 : 0
        return (chat, validId(part(at)) ? part(at) : "", part(at + 1))
    }

    /// The stack entry of a chat screen. A wallet id never starts with "c.".
    static func route(_ cid: String) -> String { "c." + cid }

    static func chatId(ofRoute r: String) -> String? {
        r.hasPrefix("c.") ? String(r.dropFirst(2)) : nil
    }
}
