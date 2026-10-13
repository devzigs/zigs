import Foundation
import Observation

struct Session: Identifiable {
    let id: String
    let doc: Doc
    var status: String { doc.str("status") ?? "collecting" }
    var amount: Int { doc.int("amount") ?? 0 }
}

/// One wallet in the list, decrypted.
struct GroupInfo: Identifiable {
    let id: String
    let name: String
    let n: Int
    let t: Int
    let createdAt: Int
    let movedTo: String?
    let network: String?
}

extension GroupInfo {
    /// The list entry of a group document.
    init(id: String, doc g: Doc) {
        self.init(id: id, name: g.str("name") ?? "Wallet", n: g.int("n") ?? 0, t: g.int("t") ?? 0,
                  createdAt: g.int("createdAt") ?? 0, movedTo: g.str("movedTo"),
                  network: g.str("network"))
    }
}

/// One group, decrypted. Same document layout as web/app.js.
struct GroupState {
    var g: Doc?
    var seats: [String: Doc] = [:]
    var dkg1: [String: Doc] = [:]
    var dkg2: [String: Doc] = [:]
    var confirm: [String: Doc] = [:]
    var abort: [String: Doc] = [:]
    var done: [String: Doc] = [:]
    var verify: [String: Doc] = [:]
    var wallet: Doc?
    var sessions: [Session] = []
    var commits: [String: [String: Doc]] = [:]
    var shares: [String: [String: Doc]] = [:]
    /// The paths of the documents that a version 3 wallet ignored: no valid signature of the right
    /// seat.
    var ignoredPaths: [String] = []
    /// True when the store shows another number of signers or rule than the first this device saw.
    var shapeMoved: Bool { g?["shapeMoved"] as? Bool ?? false }

    /// FROST identifiers are the seat number as a 32-byte little-endian scalar, in hex.
    static func frostId(_ i: Int) -> String {
        String(format: "%02x", i) + String(repeating: "0", count: 62)
    }

    /// The key package of a done document: JSON text, as both apps publish it, or the object.
    static func packageDoc(_ v: Any?) -> Doc? {
        if let d = v as? Doc { return d }
        guard let text = v as? String else { return nil }
        return (try? Engine.parse(text)) as? Doc
    }

    /// A restored seat must hold the key data that the wallet published for it: the share, the
    /// public key package and the group key. The setup secret of a version 2 or 3 wallet is checked
    /// apart (GroupModel.fit). Same rule as fitsPublished in web/util.js.
    func published(_ i: Int, fits secret: Doc) -> Bool {
        guard let kp = secret.doc("keyPackage"), kp.str("identifier") == Self.frostId(i),
              let share = kp.str("verifying_share"),
              let doc = done["\(i)"], let package = Self.packageDoc(doc["publicKeyPackage"]),
              Self.sameKeyData(secret, doc, package) else { return false }
        return package.doc("verifying_shares")?.str(Self.frostId(i)) == share
    }

    private static func sameKeyData(_ secret: Doc, _ done: Doc, _ package: Doc) -> Bool {
        guard let mine = packageDoc(secret["publicKeyPackage"]),
              let key = secret.str("groupKey") else { return false }
        return key == done.str("groupKey")
            && GroupModel.walletKey(mine) == GroupModel.walletKey(package)
    }

    var n: Int { g?.int("n") ?? 0 }
    var t: Int { g?.int("t") ?? 0 }
    var name: String { g?.str("name") ?? "Wallet" }
    var movedTo: String? { g?.str("movedTo") }
    var movedFrom: String? { g?.str("movedFrom") }
    var net: ZcashNetwork { .of(g?.str("network")) }
    /// The network name that the wallet document must carry. A group that names none is testnet.
    var netName: String { g?.str("network") == "mainnet" ? "mainnet" : "testnet" }
    /// 1 when the group document has no version, 2 for the ZIP 2005 ceremony, 3 for that ceremony
    /// with signed writes, 0 for a version this app does not know.
    var version: Int { Self.version(of: g) }

    static func version(of g: Doc?) -> Int {
        guard let v = g?["version"] else { return 1 }
        // A JSON true is not the number 1.
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              [1.0, 2, 3].contains(n.doubleValue) else { return 0 }
        return n.intValue
    }
    /// The seats of the wallet: 1 to `n`. A group document with no valid `n` has none, so a made-up
    /// `n` never sizes an array.
    var seatIds: [Int] { Signed.seatRange(n) }
    var allSeated: Bool { seatIds.allSatisfy { seats["\($0)"]?.str("boxPk") != nil } }
    var seatedCount: Int { seatIds.filter { seats["\($0)"] != nil }.count }
    var allR1: Bool { seatIds.allSatisfy { dkg1["\($0)"] != nil } }
    var allDone: Bool { !seatIds.isEmpty && seatIds.allSatisfy { done["\($0)"] != nil } }
    /// Every seat computed the same group key and the same public key package. A seat whose
    /// package differs holds a share that does not fit the others, and signing would fail later.
    var keysAgree: Bool {
        let docs = seatIds.compactMap { done["\($0)"] }
        guard allDone, docs.count == seatIds.count else { return false }
        let keys = Set(docs.map { $0.str("groupKey") ?? "" })
        let packages = Set(docs.map {
            GroupModel.walletKey(Self.packageDoc($0["publicKeyPackage"]))
        })
        return keys.count == 1 && packages.count == 1 && !keys.contains("") && !packages.contains("")
    }
    /// A published abort document is one that exists and holds a reason.
    func abortSent(_ i: Int) -> Bool { abort["\(i)"]?.str("reason") != nil }
    var verifiedCount: Int { seatIds.filter { has(verify["\($0)"]?["ok"]) }.count }
    var rejectedSeats: [Int] { seatIds.filter { verify["\($0)"] != nil && !has(verify["\($0)"]?["ok"]) } }
    /// The wallet is ready to use: created, dated, and no seat rejected it.
    var ready: Bool { wallet?.int("birthday") != nil && rejectedSeats.isEmpty }
    func r2For(_ to: Int) -> Bool { seatIds.filter { $0 != to }.allSatisfy { dkg2["\($0)-\(to)"] != nil } }

    func stage(_ i: Int) -> Int {
        if seats["\(i)"] == nil { return 0 }
        if has(verify["\(i)"]?["ok"]) { return 5 }
        if done["\(i)"] != nil { return 4 }
        if seatIds.contains(where: { $0 != i && dkg2["\(i)-\($0)"] != nil }) { return 3 }
        return dkg1["\(i)"] != nil ? 2 : 1
    }
}

enum Gate { case ok, wait, mismatch }

/// Versions 2 and 3 run the same key ceremony. Version 3 adds signed writes.
func usesV2(_ version: Int) -> Bool { version == 2 || version == 3 }

/// Seats whose confirm document holds another safety number than `number`.
func numberClash(_ number: String, _ docs: [String: Doc], _ ids: [Int]) -> [Int] {
    ids.filter { i in docs["\(i)"]?.str("number").map { $0 != number } ?? false }
}

/// May the key ceremony of a version 2 or 3 wallet run? `mine` is the number the person confirmed
/// on this device: a confirm document alone is only a claim. Same rules as confirmGate in
/// web/util.js.
func confirmGate(_ number: String?, mine: String?, _ docs: [String: Doc], _ ids: [Int]) -> Gate {
    guard let number else { return .wait }
    if !numberClash(number, docs, ids).isEmpty { return .mismatch }
    let all = ids.allSatisfy { docs["\($0)"]?.str("number") == number }
    return all && mine == number ? .ok : .wait
}

/// What a seat keeps when its setup ends: the reason as one sentence, then what to do. Same rule
/// as abortText in web/util.js.
func abortText(_ reason: String) -> String {
    var msg = reason
    while msg.hasSuffix(".") { msg.removeLast() }
    if msg.isEmpty { msg = "Setup failed" }
    return msg.prefix(1).uppercased() + msg.dropFirst() + ". Do not use this wallet. Create a new wallet."
}

func secureHex(_ bytes: Int) throws -> String {
    var buf = [UInt8](repeating: 0, count: bytes)
    guard SecRandomCopyBytes(kSecRandomDefault, buf.count, &buf) == errSecSuccess else {
        throw ZigsError("This \(deviceName) could not make a random value.")
    }
    return buf.map { String(format: "%02x", $0) }.joined()
}

/// A seat publishes its first key message right after joining, so stage 2 still reads as joined.
let stageLabels = ["Open", "Joined", "Joined", "Creating key", "Key ready", "Address checked"]

let lockName = "Face ID"

func ruleText(_ t: Int, _ n: Int) -> String { "Any \(t) of \(n) signers must approve each payment." }

@MainActor
@Observable
final class GroupModel {
    private(set) var groups: [GroupInfo] = []
    /// Each group's published wallet (address, viewing key), for the list and for moves.
    private(set) var wallets: [String: Doc] = [:]
    private(set) var toApprove: [String: Int] = [:]
    private(set) var gid: String?
    private(set) var state = GroupState()
    private(set) var chain: Chain?
    private(set) var connected = false
    private(set) var log: [String] = []
    private(set) var balances: [String: Int] = [:]
    /// The key shares are sealed and this launch has not unlocked them yet.
    private(set) var locked = false
    private(set) var lockOn = false
    var banner: String?
    /// A message that is not an error, but that the person must read.
    var warning: String?
    var notice: String?
    var path: [String] = []

    @ObservationIgnored let store = Store()
    @ObservationIgnored let vault = Vault()
    /// Restored key shares that wait for the documents of their seats (settleRestore), by wallet
    /// and seat.
    @ObservationIgnored var restoreWatches: [String: RestoreWatch] = [:]
    /// The last answers of the wallet check for a restored setup secret. See setupFit.
    @ObservationIgnored private var setupChecks: [String: Bool] = [:]
    @ObservationIgnored let signPins = SignPins()
    @ObservationIgnored let signMemo = SignedMemo()
    @ObservationIgnored var signLogged = Set<String>()
    /// The payment screen that is open. The wallet page counts the ignored approvals and shares
    /// of this payment only, as the web app does.
    var openPayment: String?
    @ObservationIgnored private var busy = Set<String>()
    @ObservationIgnored private(set) var me: String
    @ObservationIgnored private var proving = Set<String>()
    @ObservationIgnored private var autoSeat = false
    @ObservationIgnored private var linkWhileLocked: String?
    @ObservationIgnored private var unlocking = false
    /// Decrypted field values by ciphertext; every store change would otherwise decrypt everything.
    @ObservationIgnored private var opened: [String: Any] = [:]

    var server: String { didSet { UserDefaults.standard.set(server, forKey: "zf-server") } }
    /// The shared password of a server that has one (app.zigs.app until launch).
    var password: String { didSet { UserDefaults.standard.set(password, forKey: "zf-password") } }
    var name: String { didSet { UserDefaults.standard.set(name, forKey: "zf-name") } }

    init() {
        let d = UserDefaults.standard
        if d.string(forKey: "zf-uid") == nil { d.set(UUID().uuidString.lowercased(), forKey: "zf-uid") }
        me = d.string(forKey: "zf-uid") ?? ""
        server = d.string(forKey: "zf-server") ?? "https://app.zigs.app"
        password = d.string(forKey: "zf-password") ?? ""
        name = d.string(forKey: "zf-name") ?? ""
        locked = vault.locked
        lockOn = vault.lockOn
        store.onChange = { [weak self] in self?.refresh() }
        if !locked { start() }
    }

    private func start() {
        loadBalances()
        reconnect()
        if let link = linkWhileLocked { linkWhileLocked = nil; join(link) }
    }

    func unlock() async {
        guard locked, !unlocking else { return }
        unlocking = true
        defer { unlocking = false }
        do {
            try await vault.unlock()
            locked = false
            lockOn = vault.lockOn
            start()
        } catch {
            banner = error.localizedDescription
        }
    }

    func turnOnLock() {
        do {
            try vault.turnOn()
            lockOn = true
            notice = "Locked. Zigs asks for \(lockName) each time it starts."
        } catch {
            banner = error.localizedDescription
        }
    }

    func forgetLockedKeys() {
        vault.forget()
        locked = vault.locked
        lockOn = vault.lockOn
        if !locked { start() }
    }

    func reconnect() {
        guard let url = URL(string: server) else { banner = "The server address is not valid."; return }
        store.connect(server: url, password: password)
        for gid in vault.keys.keys { store.join(gid) }
        refresh()   // with no groups, no socket ever reports, so show the state now
    }

    func note(_ msg: String) {
        let time = Date().formatted(date: .omitted, time: .standard)
        log.insert("\(time)  \(msg)", at: 0)
        if log.count > 60 { log.removeLast() }
    }

    // MARK: Encrypted store

    private func key(_ path: String) -> String? {
        let parts = path.split(separator: "/")
        return parts.count > 1 ? vault.keys[String(parts[1])] : nil
    }

    private func open(_ path: String, _ raw: Doc?) -> Doc? {
        guard let raw, let k = key(path) else { return nil }
        if opened.count > 20_000 { opened = [:] }
        var out = Doc()
        for (field, v) in raw {
            guard let ct = v as? String else { continue }
            // The cache key includes the AAD, so a value moved to another path or field fails to open.
            let aad = path + "\n" + field, cacheKey = aad + "\n" + ct
            if let hit = opened[cacheKey] { out[field] = hit; continue }
            guard let pt = try? Engine.call("secretOpen", [k, aad, ct]),
                  let val = try? Engine.parse(pt), shallow(val) else { continue }
            opened[cacheKey] = val
            out[field] = val
        }
        return out.isEmpty && !raw.isEmpty ? nil : out
    }

    /// The same depth limit as the web app, which drops a stored value nested deeper than 32.
    private func shallow(_ v: Any, _ depth: Int = 0) -> Bool {
        if let d = v as? Doc { return depth < 32 && d.values.allSatisfy { shallow($0, depth + 1) } }
        if let a = v as? [Any] { return depth < 32 && a.allSatisfy { shallow($0, depth + 1) } }
        return true
    }

    private func seal(_ path: String, _ data: Doc) throws -> Doc {
        guard let k = key(path) else { throw ZigsError("No key for \(path).") }
        var out = Doc()
        for (field, v) in data { out[field] = try Engine.call("secretSeal", [k, path + "\n" + field, Engine.json(v)]) }
        return out
    }

    private func put(_ path: String, _ data: Doc) async throws { try await store.set(path, seal(path, data)) }
    private func patch(_ path: String, _ data: Doc) async throws { try await store.update(path, seal(path, data)) }

    /// Writes the document at `rel`, a path below the wallet, with the signature of seat `seat`
    /// in a version 3 wallet.
    private func putSigned(_ gid: String, _ rel: String, as seat: Int, _ fields: Doc) async throws {
        try await put("groups/\(gid)/\(rel)", signed(gid, rel, as: seat, fields))
    }

    private func children(_ path: String) -> [String: Doc] {
        var out: [String: Doc] = [:]
        for (id, raw) in store.children(path) {
            if let d = open(path + "/" + id, raw) { out[id] = d }
        }
        return out
    }

    // MARK: State

    /// Reads the stores again. The vault is not observable, so a change of the seat secrets calls
    /// this.
    func refresh() {
        connected = store.connected
        readGroups()
        if let gid { reload(gid) }
        react()
    }

    private func readGroups() {
        var list: [GroupInfo] = [], ws: [String: Doc] = [:], counts: [String: Int] = [:]
        for (id, raw) in store.children("groups") {
            guard let stored = open("groups/" + id, raw) else { continue }
            pinVersion(id, stored)
            let g = trusted(id, stored)
            list.append(GroupInfo(id: id, doc: g))
            let reader = signedReader(id, g)
            let wpath = "groups/\(id)/meta/wallet"
            if let w = open(wpath, store.docs[wpath]) { ws[id] = reader.map { $0.wallet(w) } ?? w }
            if !vault.seats(in: id).isEmpty {
                counts[id] = sessionsOf(id, reader).filter { needsMyApproval(id, $0) }.count
            }
        }
        groups = list.sorted { $0.createdAt > $1.createdAt }
        wallets = ws
        toApprove = counts
    }

    /// The reader of a signed wallet, with the keys pinned from its seat documents, or nil for a
    /// wallet before version 3.
    private func signedReader(_ gid: String, _ g: Doc) -> SignedReader? {
        guard signedMode(gid) else { return nil }
        let n = g.int("n") ?? 0
        pinSeats(gid, n: n, children("groups/\(gid)/seats"))
        return reader(gid, n: n)
    }

    /// The payments of a wallet. A signed wallet shows only those with a valid proposal.
    private func sessionsOf(_ gid: String, _ reader: SignedReader?) -> [Session] {
        children("groups/\(gid)/sessions").compactMap { id, d in
            guard let reader else { return Session(id: id, doc: d) }
            return Signed.readSession(id, d, reader).doc.map { Session(id: id, doc: $0) }
        }
    }

    /// Reads the open wallet again. A restore that settles can change the seats of this device,
    /// so the state is read a second time then.
    private func reload(_ gid: String) {
        state = load(gid)
        if settleRestore() { state = self.gid.map(load) ?? GroupState() }
    }

    private func load(_ gid: String) -> GroupState {
        var s = readStore(gid)
        pinVersion(gid, s.g)
        if let g = s.g { s.g = trusted(gid, g) }
        if s.g != nil && signedMode(gid) { keepSigned(gid, &s) }
        // The store's verify documents are claims anyone with the wallet key can write. For its own
        // seats this device uses its own result, tied to the exact wallet document.
        let wk = Self.walletKey(s.wallet)
        for i in vault.seats(in: gid) where owns(i, s, gid) {
            let sec = vault.sec(gid, i)
            let checked = sec.str("checkedWallet") == wk, rejected = sec.str("rejectedWallet") == wk
            let mine: Bool? = checked ? true : rejected ? false : nil
            s.verify["\(i)"] = mine.map { ["ok": $0] }
        }
        return s
    }

    /// Keeps the documents of a version 3 wallet that carry a valid signature of the right seat.
    private func keepSigned(_ gid: String, _ s: inout GroupState) {
        pinSeats(gid, n: s.n, s.seats)
        let bad = s.keepSigned(reader(gid, n: s.n))
        s.ignoredPaths = bad
        logIgnored(gid, bad)
    }

    /// The documents of one wallet as the store holds them, decrypted.
    private func readStore(_ gid: String) -> GroupState {
        let base = "groups/" + gid
        var s = GroupState()
        s.g = open(base, store.docs[base])
        s.seats = children(base + "/seats")
        s.dkg1 = children(base + "/dkg1")
        s.dkg2 = children(base + "/dkg2")
        s.confirm = children(base + "/confirm")
        s.abort = children(base + "/abort")
        s.done = children(base + "/done")
        s.verify = children(base + "/verify")
        s.wallet = open(base + "/meta/wallet", store.docs[base + "/meta/wallet"])
        s.sessions = children(base + "/sessions").map { Session(id: $0.key, doc: $0.value) }
            .sorted { ($0.doc.int("createdAt") ?? 0) > ($1.doc.int("createdAt") ?? 0) }
        for ss in s.sessions {
            s.commits[ss.id] = children(base + "/sessions/" + ss.id + "/commits")
            s.shares[ss.id] = children(base + "/sessions/" + ss.id + "/shares")
        }
        return s
    }

    func select(_ id: String?) {
        guard id != gid else { return }
        gid = id
        if let id { signLogged = signLogged.filter { !$0.hasPrefix(id + "|") } }
        chain?.close()
        chain = nil
        state = id.map(load) ?? GroupState()
        react()
    }

    /// A seat is this device's when it took the seat, or when it restored the key data that the
    /// wallet published for the seat (SeatOwner). Same rule as ownsSeat in web/app.js.
    private func owns(_ i: Int, _ st: GroupState, _ gid: String) -> Bool {
        guard let seat = st.seats["\(i)"] else { return false }
        let s = vault.sec(gid, i)
        return SeatOwner.owns(uid: seat.str("uid"), me: me, secret: s, fit: fit(i, s, in: st))
    }

    /// Does the key data in the seat secret `s` equal what the wallet published for seat `i`?
    /// nil while the documents that decide it have not loaded. Same as fitState in web/app.js.
    func fit(_ i: Int, _ s: Doc, in st: GroupState) -> Bool? {
        guard let done = st.done["\(i)"], st.g != nil else { return nil }
        return st.published(i, fits: s) ? setupFit(i, s, done, in: st) : false
    }

    /// A seat of a version 2 or 3 wallet must hold the setup secret that, with the seat's published
    /// data, gives the full viewing key of the wallet. A seat of another version holds none. The
    /// engine call is slow and views ask again and again, so the answers are kept.
    private func setupFit(_ i: Int, _ s: Doc, _ done: Doc, in st: GroupState) -> Bool? {
        guard let sk = s.str("vaultSk") else { return !usesV2(st.version) }
        guard let wallet = st.wallet else { return nil }
        let published = done["publicKeyPackage"] ?? NSNull()
        let package = published as? String ?? Engine.json(published)
        let key = [sk, package, Self.walletKey(wallet)].joined(separator: "|")
        if let hit = setupChecks[key] { return hit }
        let ok = (try? Engine.call("walletVerifyV2", [Engine.json(wallet), package, sk])) != nil
        if setupChecks.count > 32 { setupChecks = [:] }
        setupChecks[key] = ok
        return ok
    }

    var localSeats: [Int] {
        guard let gid else { return [] }
        return vault.seats(in: gid).filter { owns($0, state, gid) }
    }

    var myVerified: Bool { localSeats.contains { has(state.verify["\($0)"]?["ok"]) } }
    /// A signer sees the address only after its own seat checked it against its key share.
    var addressHidden: Bool { !localSeats.isEmpty && !myVerified }
    var isCreator: Bool { isMe(state.g?.str("createdBy")) }

    /// This device, or a seat that it holds in the open wallet. Same rule as isMe in web/app.js.
    func isMe(_ uid: String?) -> Bool {
        guard let uid, !uid.isEmpty else { return false }
        return uid == me || localSeats.contains { state.seats["\($0)"]?.str("uid") == uid }
    }

    /// The identity that other signers know: the first local seat's, which outlives a reinstall.
    var myUid: String { localSeats.first.flatMap { state.seats["\($0)"]?.str("uid") } ?? me }

    func seatLabel(_ i: Int) -> String {
        guard let s = state.seats["\(i)"] else { return "Open seat" }
        if localSeats.contains(i) { return localSeats.count > 1 ? "You (seat \(i))" : "You" }
        let n = s.str("name") ?? ""
        return n.isEmpty ? "Signer \(i)" : n
    }

    func groupName(_ id: String) -> String { groups.first { $0.id == id }?.name ?? "the new wallet" }

    func inviteLink(_ id: String) -> String {
        "\(server.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/#\(id).\(vault.keys[id] ?? "")"
    }

    /// A seat records its nonces on this device when it approves, so no server read is needed.
    func needsMyApproval(_ gid: String, _ ss: Session) -> Bool {
        guard ss.status == "collecting", !has(ss.doc["package"]), !has(ss.doc["error"]) else { return false }
        // In the open wallet only owned seats count; a restored seat that does not fit cannot approve.
        let seats = gid == self.gid ? localSeats : vault.seats(in: gid)
        return seats.contains { i in
            let s = vault.sec(gid, i)
            return has(s["keyPackage"]) && s.doc("nonces")?[ss.id] == nil
        }
    }

    // MARK: Balance

    /// Sent payments that no synced block contains yet. Until one does, the synced balance still
    /// counts their inputs as unspent, so the app subtracts them itself.
    var inFlight: [Session] {
        guard let chain else { return [] }
        return state.sessions.filter {
            has($0.doc["broadcastTxid"]) && $0.doc.doc("final") != nil
                && !chain.sent.contains($0.doc.doc("final")?.str("txid") ?? "")
        }
    }

    func balanceNow() -> (spendable: Int, pending: Int, sending: Int)? {
        guard let b = chain?.balance else { return nil }
        let out = inFlight
        let sum = { (f: (Session) -> Int) in out.reduce(0) { $0 + f($1) } }
        return (max(0, (b.int("spendable") ?? 0) - sum { $0.doc.int("noteValue") ?? 0 }),
                (b.int("pending") ?? 0) + sum { $0.doc.int("change") ?? 0 },
                sum { $0.amount + ($0.doc.int("fee") ?? 0) })
    }

    var maxSend: Int { chain?.balance?.int("max_send") ?? 0 }

    /// A mainnet wallet at its cap: the app stops showing its address. Payments out still work.
    var atCap: Bool {
        guard let cap = state.net.cap, let b = balanceNow() else { return false }
        return b.spendable + b.pending >= cap
    }

    func onNetwork(_ address: String) -> Bool { normalized(address)?.hasPrefix(state.net.prefix) ?? false }

    /// Why Send is unavailable, or nil when it is available.
    var sendBlocker: String? {
        if localSeats.isEmpty { return "You hold no seat in this wallet." }
        if !myVerified { return "Your seat is still checking the wallet address." }
        guard let b = balanceNow() else { return "Wait for the first sync to finish." }
        // ponytail: the engine does not know about unmined spends and would pick the same notes again.
        if !inFlight.isEmpty { return "A payment is waiting for its block. Send again in a minute." }
        if maxSend > 0 { return nil }
        return b.pending > 0 ? "Incoming funds need 3 confirmations first." : "This wallet has no funds yet."
    }

    private func ensureChain(_ gid: String) {
        guard chain == nil, let w = state.wallet, let ufvk = w.str("ufvk"), let birthday = w.int("birthday"),
              let key = vault.keys[gid] else { return }
        let c = Chain(gid: gid, ufvk: ufvk, birthday: birthday, groupKey: key, net: state.net)
        c.onSynced = { [weak self] b in self?.saveBalance(gid, b) }
        chain = c
        Task { await c.sync() }
    }

    // Balances are sealed with each wallet's key: settings go into device backups, keys do not.
    private func saveBalance(_ gid: String, _ b: Doc) {
        let total = (b.int("spendable") ?? 0) + (b.int("pending") ?? 0)
        balances[gid] = total
        guard let key = vault.keys[gid], let sealed = try? Engine.call("secretSeal", [key, "bal\n" + gid, String(total)]) else { return }
        var all = UserDefaults.standard.dictionary(forKey: "zf-bal") as? [String: String] ?? [:]
        all[gid] = sealed
        UserDefaults.standard.set(all, forKey: "zf-bal")
    }

    private func loadBalances() {
        // Entries from before sealing hold plain amounts; drop them.
        let all = (UserDefaults.standard.dictionary(forKey: "zf-bal") ?? [:]).compactMapValues { $0 as? String }
        UserDefaults.standard.set(all, forKey: "zf-bal")
        for (gid, sealed) in all {
            guard let key = vault.keys[gid], let text = try? Engine.call("secretOpen", [key, "bal\n" + gid, sealed]),
                  let total = Int(text) else { continue }
            balances[gid] = total
        }
    }

    // MARK: Reactor

    /// Runs `op` once at a time per key, then re-checks what can advance.
    private func once(_ key: String, _ op: @escaping @MainActor () async throws -> Void) {
        guard !busy.contains(key) else { return }
        busy.insert(key)
        Task { @MainActor in
            var failed = false
            do { try await op() } catch {
                failed = true
                note("✗ \(key): \(error.localizedDescription)")
                banner = error.localizedDescription
            }
            busy.remove(key)
            // A step that failed waits before the next try, so a closed socket is not hammered.
            if failed { try? await Task.sleep(for: .seconds(Self.retrySeconds)) }
            react()
        }
    }

    private static let retrySeconds = 3

    private func react() {
        guard let gid, state.g != nil, state.version != 0 else { return }
        takeFirstOpenSeat()
        reactStops(gid)
        reactConfirm(gid)
        for i in localSeats { advanceSeat(gid, i) }
        if canCreateWallet {
            once("wallet") { try await self.createWallet(gid) }
        }
        reactWallet(gid)
    }

    private func reactWallet(_ gid: String) {
        guard state.wallet != nil else { return }
        if state.ready && myVerified { ensureChain(gid) }
        for ss in state.sessions { reactSession(ss) }
    }

    // MARK: Key ceremony
    // Version 1 wallets: the creator picks nk and rivk. Version 2 wallets (ZIP 2005): the signers
    // agree on a secret sk together, and nk, qsk and rivk follow from it (PROTOCOL.md section 4).

    private static let differentSetup = "Signers saw different setup data"

    /// A seat keeps the version that its wallet had when it took the seat ("version"), so a change
    /// of the wallet document later cannot move the seat to another ceremony. A seat from before
    /// that follows its own progress; before it began, the wallet's version decides.
    private func seatMode(_ s: Doc) -> Int {
        if let v = s.int("version"), v > 0 { return v }
        if has(s["skPart"]) || has(s["vaultSk"]) { return 2 }
        return has(s["r1secret"]) || has(s["r2secret"]) || has(s["keyPackage"]) ? 1 : state.version
    }

    // Reasons to end the setup of a seat for good. Each returns the reason, or nil.

    private var sawV2Data: Bool {
        !state.confirm.isEmpty || state.dkg1.values.contains { $0["commit"] != nil }
    }

    private func versionChanged(_ s: Doc) -> String? {
        guard let v = s.int("version"), v != state.version else { return nil }
        return "The setup version of this wallet changed after you took your seat"
    }

    private func v2DataSeen(_ s: Doc) -> String? {
        guard seatMode(s) == 1, !has(s["keyPackage"]), sawV2Data else { return nil }
        return "Other signers use the new setup, but this seat does not"
    }

    private func keyReplaced(_ i: Int, _ s: Doc) -> String? {
        guard usesV2(seatMode(s)), let mine = s.str("boxPk"),
              let shown = state.seats["\(i)"]?.str("boxPk"), mine != shown else { return nil }
        return "Your seat key was replaced"
    }

    private func numberChanged(_ s: Doc) -> String? {
        guard usesV2(seatMode(s)), !has(s["keyPackage"]), let confirmed = s.str("confirmed"),
              let number = safetyNumber, confirmed != number else { return nil }
        return "The safety number changed after you confirmed it. Someone may have replaced a seat"
    }

    private func conflictOf(_ i: Int, _ s: Doc) -> String? {
        versionChanged(s) ?? v2DataSeen(s) ?? keyReplaced(i, s) ?? numberChanged(s)
    }

    /// Runs over every seat that this device holds a secret for, also a seat that the store now
    /// shows under another identity. A stopped seat tells the other seats until the store holds its
    /// abort document with a reason.
    private func reactStops(_ gid: String) {
        for i in vault.seats(in: gid) {
            let s = vault.sec(gid, i)
            if !has(s["aborted"]), let reason = conflictOf(i, s) {
                vault.putSec(gid, i, ["aborted": abortText(reason)])
            }
            guard let text = vault.sec(gid, i).str("aborted"), !state.abortSent(i),
                  canWriteAs(i, in: gid) else { continue }
            once("abort:\(i)") {
                try await self.putSigned(gid, "abort/\(i)", as: i, ["reason": text])
            }
        }
    }

    private func launch(_ key: String, _ op: @escaping @MainActor () async throws -> Void) -> Bool {
        once(key, op)
        return true
    }

    /// A seat that stopped, or that holds no key share while another seat stopped, does no more.
    private func isStopped(_ s: Doc) -> Bool {
        has(s["aborted"]) || (!has(s["keyPackage"]) && !remoteAborts.isEmpty)
    }

    private func needVerify(_ i: Int, _ s: Doc) -> Bool {
        has(s["keyPackage"]) && state.wallet != nil && state.verify["\(i)"] == nil
    }

    private func advanceSeat(_ gid: String, _ i: Int) {
        let s = vault.sec(gid, i)
        // A seat that cannot sign writes nothing in a version 3 wallet (SignedNotes says so).
        if isStopped(s) || !canWriteAs(i, in: gid) { return }
        let started = usesV2(seatMode(s)) ? stepV2(gid, i, s) : stepV1(gid, i, s)
        if !started && needVerify(i, s) {
            once("verify:\(i)") { try await self.verifyWallet(gid, i) }
        }
    }

    private func needR1(_ i: Int, _ s: Doc) -> Bool { state.dkg1["\(i)"] == nil && !has(s["keyPackage"]) }
    /// Round 2 needs every seat taken (for their encryption keys) and every round-1 package.
    private func needR2(_ s: Doc) -> Bool {
        has(s["r1secret"]) && !has(s["r2secret"]) && !has(s["keyPackage"]) && state.allSeated && state.allR1
    }
    private func needR3(_ i: Int, _ s: Doc) -> Bool {
        has(s["r2secret"]) && !has(s["keyPackage"]) && state.allR1 && state.r2For(i)
    }
    /// The done document is the only proof to the other seats that this seat holds its key share.
    /// A failed write is retried until it succeeds.
    private func needDone(_ i: Int, _ s: Doc) -> Bool {
        has(s["keyPackage"]) && !has(s["doneSent"]) && state.done["\(i)"] == nil
    }

    private func stepV1(_ gid: String, _ i: Int, _ s: Doc) -> Bool {
        if needR1(i, s) { return launch("r1:\(i)") { try await self.round1(gid, i) } }
        if needR2(s) { return launch("r2:\(i)") { try await self.round2(gid, i) } }
        if needR3(i, s) { return launch("r3:\(i)") { try await self.round3(gid, i) } }
        if needDone(i, s) { return launch("done:\(i)") { try await self.publishDone(gid, i) } }
        return false
    }

    private func publishDone(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        let groupKey = s.str("groupKey") ?? ""
        let package = Engine.json(s["publicKeyPackage"] ?? NSNull())
        try await putSigned(gid, "done/\(i)", as: i,
                            ["groupKey": groupKey, "publicKeyPackage": package, "at": now()])
        vault.putSec(gid, i, ["doneSent": true])
        note("seat \(i): key share ready, group key \(groupKey.prefix(12))…")
    }

    private func round1(_ gid: String, _ i: Int) async throws {
        var s = vault.sec(gid, i)
        if !has(s["r1secret"]) {
            let r = try Engine.object("dkgPart1", [i, state.n, state.t])
            vault.putSec(gid, i, ["r1secret": r["secret"] ?? NSNull(), "r1package": r["package"] ?? NSNull()])
            s = vault.sec(gid, i)
        }
        try await putSigned(gid, "dkg1/\(i)", as: i,
                            ["package": s["r1package"] ?? NSNull(), "at": now()])
        note("seat \(i): round 1 commitment published")
    }

    private func round2(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        var r1 = Doc()
        for j in state.seatIds where j != i { r1["\(j)"] = state.dkg1["\(j)"]?["package"] }
        let r = try Engine.object("dkgPart2", [Engine.json(s["r1secret"] ?? NSNull()), Engine.json(r1)])
        let outgoing = r.doc("outgoing") ?? [:]
        for (to, pkg) in outgoing {
            guard let pk = state.seats[to]?.str("boxPk"), let sk = s.str("boxSk") else { continue }
            let sealed = try Engine.call("boxSeal", [sk, pk, "\(gid):\(i)->\(to)", Engine.json(pkg)])
            try await putSigned(gid, "dkg2/\(i)-\(to)", as: i, ["sealed": sealed, "at": now()])
        }
        vault.putSec(gid, i, ["r2secret": r["secret"] ?? NSNull(), "r1secret": NSNull()])
        note("seat \(i): \(outgoing.count) encrypted shares sent")
    }

    private func round3(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        var r1 = Doc(), r2 = Doc()
        for j in state.seatIds where j != i {
            r1["\(j)"] = state.dkg1["\(j)"]?["package"]
            guard let sk = s.str("boxSk"), let pk = state.seats["\(j)"]?.str("boxPk"),
                  let sealed = state.dkg2["\(j)-\(i)"]?.str("sealed") else { throw ZigsError("missing share from seat \(j)") }
            r2["\(j)"] = try Engine.parse(Engine.call("boxOpen", [sk, pk, "\(gid):\(j)->\(i)", sealed]))
        }
        let r = try Engine.object("dkgPart3", [Engine.json(s["r2secret"] ?? NSNull()), Engine.json(r1), Engine.json(r2)])
        let groupKey = r.str("group_key") ?? ""
        vault.putSec(gid, i, ["keyPackage": r["key_package"] ?? NSNull(),
                              "publicKeyPackage": r["public_key_package"] ?? NSNull(),
                              "groupKey": groupKey, "r2secret": NSNull(), "r1package": NSNull()])
    }

    // MARK: Key ceremony, versions 2 and 3
    // The safety number covers the wallet id, t, n, the network and every seat's encryption key. The
    // signers compare it out of band. A confirm document is only a claim, so a seat also keeps the
    // number its person confirmed ("confirmed"), and the ceremony runs only when both agree with the
    // local number.

    /// The safety number of the wallet id, t, n, the network and the seats' encryption keys, or nil
    /// until every seat is taken.
    var safetyNumber: String? {
        guard let gid, state.allSeated else { return nil }
        var keys = Doc()
        for i in state.seatIds { if let pk = state.seats["\(i)"]?.str("boxPk") { keys["\(i)"] = pk } }
        let args: [Any] = [gid, state.t, state.n, state.netName, Engine.json(keys)]
        return try? Engine.call("safetyNumber", args)
    }

    private func canConfirm(_ s: Doc) -> Bool {
        !has(s["keyPackage"]) && !has(s["aborted"]) && usesV2(seatMode(s))
    }

    private var confirmable: [Int] {
        guard let gid else { return [] }
        return localSeats.filter { canWriteAs($0, in: gid) && canConfirm(vault.sec(gid, $0)) }
    }

    /// A device that holds every seat has nobody else to compare with.
    var holdsAllSeats: Bool { localSeats.count == state.n }

    /// The safety number card shows until every seat holds its key share.
    var safetyOpen: Bool {
        usesV2(state.version) && state.allSeated && !state.allDone && !holdsAllSeats
    }

    /// Seats of this device whose person has not yet confirmed the safety number.
    var unconfirmedSeats: [Int] {
        guard let gid, let no = safetyNumber else { return [] }
        return confirmable.filter { vault.sec(gid, $0).str("confirmed") != no }
    }

    func confirmedBy(_ no: String) -> [Int] { state.seatIds.filter { state.confirm["\($0)"]?.str("number") == no } }

    /// The reason a seat of this device ended its setup, or nil. This counts every seat that the
    /// device holds a secret for, also a seat that the store shows under another identity.
    var abortedText: String? {
        guard let gid else { return nil }
        return vault.seats(in: gid).compactMap { vault.sec(gid, $0).str("aborted") }.first
    }

    /// Seats that stopped their setup, as their devices reported it. They also stop the seats that
    /// hold no key share yet.
    private var remoteAborts: [Int] {
        state.seatIds.filter { state.abortSent($0) }
    }

    private var remoteAbortText: String? {
        guard let i = remoteAborts.first,
              let reason = state.abort["\(i)"]?.str("reason") else { return nil }
        return "Seat \(i) stopped setup. \(reason.prefix(200))"
    }

    private static func isHex64(_ text: String?) -> Bool {
        guard let text, text.count == 64 else { return false }
        return text.allSatisfy { "0123456789abcdef".contains($0) }
    }

    /// Seats whose round-1 document has no commitment: an old app made it.
    private var oldAppText: String? {
        guard usesV2(state.version) else { return nil }
        let old = state.seatIds.filter { i in
            state.dkg1["\(i)"].map { !Self.isHex64($0.str("commit")) } ?? false
        }
        guard !old.isEmpty else { return nil }
        return "Seat \(old.map(String.init).joined(separator: ", ")) uses an old version of Zigs "
            + "and cannot join this wallet. Update it, or create a new wallet."
    }

    private var unreadableKeyText: String? {
        guard usesV2(state.version), state.allSeated, safetyNumber == nil else { return nil }
        return "A seat holds a key that this app cannot read. Do not use this wallet. "
            + "Create a new wallet."
    }

    private var clashText: String? {
        guard usesV2(state.version), !state.allDone, let no = safetyNumber else { return nil }
        let clash = numberClash(no, state.confirm, state.seatIds)
        guard !clash.isEmpty else { return nil }
        let seats = clash.map(String.init).joined(separator: ", ")
        return "Seat \(seats) confirmed another safety number. Do not continue. Create a new wallet."
    }

    private var waitText: String? {
        guard usesV2(state.version), !state.allDone, let no = safetyNumber else { return nil }
        let yes = confirmedBy(no).count
        guard state.dkg1.count < state.n, yes < state.n else { return nil }
        return "Starts when every signer confirmed the safety number (\(yes) of \(state.n))."
    }

    /// What stops the key step, or nil. `bad` is true when it cannot recover. The first check that
    /// holds decides.
    var keyBlock: (bad: Bool, text: String)? {
        let bad = abortedText ?? remoteAbortText ?? oldAppText ?? unreadableKeyText ?? clashText
        if let bad { return (true, bad) }
        return waitText.map { (false, $0) }
    }

    /// Writes the confirm document of a seat whose person confirmed but whose document is missing,
    /// and confirms for itself when this device holds every seat.
    private func reactConfirm(_ gid: String) {
        guard usesV2(state.version), let no = safetyNumber else { return }
        let auto = holdsAllSeats
        let todo = confirmable.filter { i in
            vault.sec(gid, i).str("confirmed") == no ? state.confirm["\(i)"] == nil : auto
        }
        if !todo.isEmpty { once("confirm") { try await self.confirmSeats(gid, todo, no) } }
    }

    /// The person compared the safety number and tapped "It matches".
    /// Confirms the number the person compared. If the seats changed since it was drawn, nothing is
    /// confirmed and the card shows the new number.
    func confirmSafetyNumber(shown: String) {
        guard let gid, let no = safetyNumber, no == shown else { return }
        let ids = unconfirmedSeats
        once("confirm:tap") { try await self.confirmSeats(gid, ids, no) }
    }

    private func confirmSeats(_ gid: String, _ ids: [Int], _ no: String) async throws {
        for i in ids {
            // Sign first: a seat that cannot sign must not keep a number that nobody saw.
            let doc = try signed(gid, "confirm/\(i)", as: i, ["number": no])
            vault.putSec(gid, i, ["confirmed": no])
            try await put("groups/\(gid)/confirm/\(i)", doc)
        }
        note("safety number confirmed for seat \(ids.map(String.init).joined(separator: ", "))")
    }

    /// A failed check ends this seat's setup for good. The reason stays in the seat, so the reactor
    /// does not retry it.
    private func ceremonyStep<T>(_ gid: String, _ i: Int, _ compute: () throws -> T) throws -> T {
        do { return try compute() } catch {
            let text = abortText(error.localizedDescription)
            vault.putSec(gid, i, ["aborted": text])
            throw ZigsError(text)
        }
    }

    private func stepV2(_ gid: String, _ i: Int, _ s: Doc) -> Bool {
        let open = confirmGate(safetyNumber, mine: s.str("confirmed"), state.confirm, state.seatIds) == .ok
        let r1 = needR1(i, s) && !saveFailed.contains("\(gid):\(i)")
        if open && r1 { return launch("r1:\(i)") { try await self.round1V2(gid, i) } }
        if open && needR2(s) { return launch("r2:\(i)") { try await self.round2V2(gid, i) } }
        if needR3(i, s) { return launch("r3:\(i)") { try await self.round3V2(gid, i) } }
        if needDone(i, s) { return launch("done:\(i)") { try await self.publishDone(gid, i) } }
        return false
    }

    /// Seats whose setup secret this device could not save. Another try waits for the person.
    private(set) var saveFailed = Set<String>()

    var setupSaveFailed: Bool {
        guard let gid else { return false }
        return saveFailed.contains { $0.hasPrefix(gid + ":") }
    }

    func retrySetup() {
        saveFailed = []
        react()
    }

    var saveFailedText: String {
        "This \(deviceName) could not save your setup secret, so setup did not start."
    }

    /// The secret part of sk is saved before its commitment goes out: a seat that loses it cannot finish.
    private func round1V2(_ gid: String, _ i: Int) async throws {
        if !has(vault.sec(gid, i)["r1secret"]) {
            let r = try Engine.object("dkgPart1", [i, state.n, state.t])
            let made: Doc = ["r1secret": r["secret"] ?? NSNull(), "r1package": r["package"] ?? NSNull(),
                             "skPart": try secureHex(32)]
            guard vault.putSec(gid, i, made) else {
                vault.putSec(gid, i, ["r1secret": NSNull(), "r1package": NSNull(), "skPart": NSNull()])
                saveFailed.insert("\(gid):\(i)")
                throw ZigsError(saveFailedText)
            }
        }
        let s = vault.sec(gid, i)
        guard let boxPk = state.seats["\(i)"]?.str("boxPk"), let part = s.str("skPart") else {
            throw ZigsError("Seat \(i) has no key or setup secret.")
        }
        let commit = try Engine.call("skCommit", [gid, i, boxPk, part])
        try await putSigned(gid, "dkg1/\(i)", as: i,
                            ["package": s["r1package"] ?? NSNull(), "commit": commit, "at": now()])
        note("seat \(i): round 1 commitment published")
    }

    /// One digest of every seat's round-1 document. Each seat puts it in its round-2 documents, so a
    /// seat that saw other data than the rest is found before anyone uses its data.
    private func echoNow(_ gid: String) throws -> String {
        var r1 = Doc()
        for j in state.seatIds {
            guard let d = state.dkg1["\(j)"], let commit = d.str("commit") else {
                throw ZigsError("Seat \(j) sent no commitment, so its app is too old for this wallet")
            }
            r1["\(j)"] = ["package": d["package"] ?? NSNull(), "commit": commit] as Doc
        }
        return try Engine.call("dkgEcho", [gid, Engine.json(r1)])
    }

    private func round2V2(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        let out = try ceremonyStep(gid, i) { () throws -> (echo: String, boxes: [String: String], secret: Any) in
            let echo = try s.str("echo") ?? echoNow(gid)
            var r1 = Doc()
            for j in state.seatIds where j != i { r1["\(j)"] = state.dkg1["\(j)"]?["package"] }
            let r = try Engine.object("dkgPart2", [Engine.json(s["r1secret"] ?? NSNull()), Engine.json(r1)])
            var boxes: [String: String] = [:]
            for (to, pkg) in r.doc("outgoing") ?? [:] {
                guard let pk = state.seats[to]?.str("boxPk"), let sk = s.str("boxSk") else {
                    throw ZigsError("Seat \(to) has no key")
                }
                let payload: Doc = ["package": pkg, "r": s["skPart"] ?? NSNull()]
                boxes[to] = try Engine.call("boxSeal", [sk, pk, "\(gid):\(i)->\(to)", Engine.json(payload)])
            }
            return (echo, boxes, r["secret"] ?? NSNull())
        }
        vault.putSec(gid, i, ["echo": out.echo])
        for (to, sealed) in out.boxes {
            try await putSigned(gid, "dkg2/\(i)-\(to)", as: i,
                                ["sealed": sealed, "echo": out.echo, "at": now()])
        }
        vault.putSec(gid, i, ["r2secret": out.secret, "r1secret": NSNull()])
        note("seat \(i): \(out.boxes.count) encrypted shares sent")
    }

    private static func unreadable(_ j: Int) -> ZigsError {
        ZigsError("Seat \(j) sent an unreadable message")
    }

    /// Opens the sealed box that seat `j` sent to seat `i`, and returns what is inside.
    private func openBox(_ gid: String, from j: Int, to i: Int, _ s: Doc) throws -> Doc {
        guard let sealed = state.dkg2["\(j)-\(i)"]?.str("sealed"), let sk = s.str("boxSk"),
              let pk = state.seats["\(j)"]?.str("boxPk") else { throw Self.unreadable(j) }
        let opened: String
        do { opened = try Engine.call("boxOpen", [sk, pk, "\(gid):\(j)->\(i)", sealed]) } catch {
            throw ZigsError("Seat \(j) sent a message that cannot be opened")
        }
        guard let box = try Engine.parse(opened) as? Doc else { throw Self.unreadable(j) }
        return box
    }

    /// Opens the box seat `j` sent to seat `i`: its round-2 package and its secret part of sk.
    private func unbox(_ gid: String, from j: Int, to i: Int, _ s: Doc, _ echo: String) throws -> (package: Doc, r: String) {
        guard let d = state.dkg2["\(j)-\(i)"], d.str("echo") == echo else { throw ZigsError(Self.differentSetup) }
        let box = try openBox(gid, from: j, to: i, s)
        guard let r = box.str("r"), let package = box.doc("package") else { throw Self.unreadable(j) }
        return (package, r)
    }

    private func sealedPart(_ j: Int, _ r: Any) -> Doc {
        ["r": r, "commit": state.dkg1["\(j)"]?["commit"] ?? NSNull(), "boxPk": state.seats["\(j)"]?["boxPk"] ?? NSNull()]
    }

    /// Every check of round 3 runs before the key share is made: the echo twice (my stored echo, and
    /// each seat's), every commitment, and then the key share itself.
    private func openRound3(_ gid: String, _ i: Int, _ s: Doc) throws -> (key: Doc, sk: String) {
        guard let echo = s.str("echo"), try echoNow(gid) == echo else { throw ZigsError(Self.differentSetup) }
        var r1 = Doc(), r2 = Doc()
        var parts: Doc = ["\(i)": sealedPart(i, s["skPart"] ?? NSNull())]
        for j in state.seatIds where j != i {
            let box = try unbox(gid, from: j, to: i, s, echo)
            r1["\(j)"] = state.dkg1["\(j)"]?["package"]
            r2["\(j)"] = box.package
            parts["\(j)"] = sealedPart(j, box.r)
        }
        let sk = try Engine.call("vaultSk", [gid, echo, Engine.json(parts)])
        let key = try Engine.object("dkgPart3", [Engine.json(s["r2secret"] ?? NSNull()), Engine.json(r1), Engine.json(r2)])
        return (key, sk)
    }

    private func round3V2(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        let (r, sk) = try ceremonyStep(gid, i) { try openRound3(gid, i, s) }
        let groupKey = r.str("group_key") ?? ""
        let saved = vault.putSec(gid, i, ["keyPackage": r["key_package"] ?? NSNull(),
                                          "publicKeyPackage": r["public_key_package"] ?? NSNull(),
                                          "groupKey": groupKey, "vaultSk": sk, "skPart": NSNull(),
                                          "echo": NSNull(), "r2secret": NSNull(), "r1package": NSNull()])
        if !saved { banner = "This \(deviceName) could not save your key share. Keep Zigs open." }
    }

    /// A stable text form of the wallet document: sorted keys, so the same document gives the same key.
    nonisolated static func walletKey(_ wallet: Doc?) -> String {
        guard let wallet, let data = try? JSONSerialization.data(withJSONObject: wallet, options: [.sortedKeys])
        else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    private func verifyWallet(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        let wk = Self.walletKey(state.wallet)
        var ok = true
        var reason: Any = NSNull()
        do {
            try verifyCall(s)
        } catch {
            ok = false
            reason = error.localizedDescription
        }
        // Sign first: the result is kept only for a seat that can tell the others.
        let doc = try signed(gid, "verify/\(i)", as: i, ["ok": ok, "error": reason, "at": now()])
        vault.putSec(gid, i, ok ? ["checkedWallet": wk, "rejectedWallet": NSNull()] : ["rejectedWallet": wk])
        try await put("groups/\(gid)/verify/\(i)", doc)
        note(ok ? "seat \(i): wallet verified, ak equals my group key" : "seat \(i): WALLET REJECTED")
    }

    /// The wallet must name its group's network. A seat that holds sk checks every part of the
    /// wallet, so only version 2 verification applies to it, whatever the stored documents say. A
    /// seat without sk never accepts a version 2 or 3 wallet.
    private func verifyCall(_ s: Doc) throws {
        guard state.wallet?.str("network") == state.netName else {
            throw ZigsError("The wallet names another network than its group. Do not use this wallet.")
        }
        let wallet = Engine.json(state.wallet ?? [:]), pkp = Engine.json(s["publicKeyPackage"] ?? NSNull())
        if let sk = s.str("vaultSk") {
            _ = try Engine.call("walletVerifyV2", [wallet, pkp, sk])
            return
        }
        if usesV2(state.version) {
            throw ZigsError("This seat holds no setup secret for a version 2 or 3 wallet. "
                + "Do not use this wallet.")
        }
        _ = try Engine.call("walletVerify", [wallet, pkp])
    }

    private var v2Secret: Doc? {
        guard let gid else { return nil }
        return localSeats.map { vault.sec(gid, $0) }.first { has($0["vaultSk"]) && has($0["publicKeyPackage"]) }
    }

    private var canCreateWallet: Bool {
        guard let gid else { return false }
        return isCreator && state.wallet == nil && state.keysAgree
            && (!usesV2(state.version) || v2Secret != nil) && canWriteAs(1, in: gid)
    }

    /// The wallet document for the group's version, or nil when its key data is not there yet.
    private func walletDoc(_ net: String) throws -> Doc? {
        if usesV2(state.version) {
            guard let mine = v2Secret, let sk = mine.str("vaultSk") else { return nil }
            return try Engine.object("walletCreateV2", [Engine.json(mine["publicKeyPackage"] ?? NSNull()), net, sk])
        }
        guard let pkp = state.done["1"]?.str("publicKeyPackage") else { return nil }
        return try Engine.object("walletCreate", [pkp, net])
    }

    /// The creator builds the shared wallet once every seat computed the same group key.
    private func createWallet(_ gid: String) async throws {
        // The wallet document can arrive after the key ones; never replace a published wallet.
        if walletStands(gid) { return }
        var birthday: Int?
        for url in state.net.servers where birthday == nil { birthday = try? await Lightwalletd.latestHeight(url) }
        guard let birthday else { throw ZigsError("No light-wallet server answers, so the wallet cannot be dated.") }
        // The person may have opened another wallet while the server answered.
        guard self.gid == gid else { return }
        guard var w = try walletDoc(state.g?.str("network") ?? "testnet") else { return }
        w["birthday"] = birthday
        w["at"] = now()
        try await putSigned(gid, "meta/wallet", as: 1, w)
        note("wallet created: \((w.str("address") ?? "").prefix(24))…")
    }

    /// Does the stored wallet document stand? In a version 3 wallet, a document that seat 1 did not
    /// sign is no wallet, so it does not block the real one.
    private func walletStands(_ gid: String) -> Bool {
        let path = "groups/\(gid)/meta/wallet"
        guard let stored = store.docs[path] else { return false }
        guard signedMode(gid) else { return true }
        return open(path, stored).map { reader(gid, n: state.n).wallet($0) != nil } ?? false
    }

    /// In a version 3 wallet the proposer is the seat in `by`, if this device can sign for it.
    /// Before, it is the identity in `createdBy`.
    private func isProposer(_ gid: String, _ ss: Session) -> Bool {
        guard signedMode(gid) else { return isMe(ss.doc.str("createdBy")) }
        guard let by = ss.doc.int("by") else { return false }
        return localSeats.contains(by) && canWriteAs(by, in: gid)
    }

    private func reactSession(_ ss: Session) {
        guard let gid, let fvk = state.wallet?.str("orchard_fvk"), !has(ss.doc["error"]),
              canAct else { return }
        // Proposer: once enough signers approve, build the signing package.
        if isProposer(gid, ss) && !has(ss.doc["package"]) {
            proposePackage(gid, ss, fvk)
            return
        }
        guard let package = ss.doc.str("package") else { return }
        signAndAggregate(gid, ss, fvk, package)
    }

    private func proposePackage(_ gid: String, _ ss: Session, _ fvk: String) {
        let path = "groups/\(gid)/sessions/\(ss.id)"
        let commits = state.commits[ss.id] ?? [:]
        let ids = commits.keys.compactMap(Int.init).sorted().prefix(state.t)
        guard ids.count >= state.t else { return }
        once("pkg:\(ss.id)") {
            var c = Doc()
            for i in ids { c["\(i)"] = commits["\(i)"]?["commitments"] }
            let pkg = try Engine.call("signPackage", [ss.doc.str("pczt") ?? "", fvk, Engine.json(c), self.state.t])
            let fields: Doc = ["package": pkg, "signers": Array(ids)]
            let data = try self.partSigned(gid, ss.id, .package, fields, prefer: ss.doc.int("by"))
            try await self.patch(path, data.merging(["status": "signing"]) { $1 })
            self.note("signing package sent to signers \(ids.map(String.init).joined(separator: ", "))")
        }
    }

    /// Signers: each seat of this device that was chosen sends its share. When every chosen signer
    /// has sent one, this device aggregates them.
    private func signAndAggregate(_ gid: String, _ ss: Session, _ fvk: String, _ package: String) {
        let signers = (ss.doc["signers"] as? [NSNumber])?.map(\.intValue) ?? []
        let shares = state.shares[ss.id] ?? [:]
        let todo = localSeats.filter { signers.contains($0) && canWriteAs($0, in: gid) }
        for i in todo where shares["\(i)"] == nil {
            guard let n = vault.sec(gid, i).doc("nonces")?.doc(ss.id) else { continue }
            once("share:\(ss.id):\(i)") { try await self.signShare(gid, ss, i, fvk, package, n) }
        }
        aggregateWhenComplete(gid, ss, package, signers, shares)
    }

    private func aggregateWhenComplete(_ gid: String, _ ss: Session, _ package: String,
                                       _ signers: [Int], _ shares: [String: Doc]) {
        let complete = !signers.isEmpty && signers.allSatisfy { shares["\($0)"] != nil }
        if !localSeats.isEmpty && complete && !has(ss.doc["signed"]) {
            once("agg:\(ss.id)") { try await self.aggregate(gid, ss, package, signers) }
        }
    }

    private func signShare(_ gid: String, _ ss: Session, _ i: Int, _ fvk: String, _ package: String, _ n: Doc) async throws {
        let s = vault.sec(gid, i)
        var nonces = s.doc("nonces") ?? [:]
        nonces[ss.id] = nil
        // The approval covers one exact transaction: sign only if the sighash is still the same.
        let approved = n.str("sighash")
        guard approved != nil, case .success(let ins) = inspect(ss), ins.str("sighash") == approved else {
            vault.putSec(gid, i, ["nonces": nonces])
            let why = "The payment changed after a signer approved it."
            try await failSession(gid, ss, why, prefer: i)
            throw ZigsError("This payment changed after you approved it, so this device did not sign it.")
        }
        // The engine checks the approved sighash again before it signs.
        let share = try Engine.call("signShare", [ss.doc.str("pczt") ?? "", fvk, package, Engine.json(n),
                                                  Engine.json(s["keyPackage"] ?? NSNull()), i])
        // A seat that cannot sign fails here, before the nonce is burned.
        let rel = "sessions/\(ss.id)/shares/\(i)"
        let doc = try signed(gid, rel, as: i, ["shares": share, "at": now()])
        // Burn the nonces before the share goes out: a nonce that comes back could sign twice.
        guard vault.putSec(gid, i, ["nonces": nonces]) else {
            throw ZigsError("Could not save the used nonce, so the signature share was not sent.")
        }
        try await put("groups/\(gid)/\(rel)", doc)
        note("seat \(i): signature share sent")
    }

    private func aggregate(_ gid: String, _ ss: Session, _ package: String, _ signers: [Int]) async throws {
        let shares = state.shares[ss.id] ?? [:]
        var sh = Doc()
        for i in signers { sh["\(i)"] = try Engine.parse(shares["\(i)"]?.str("shares") ?? "") }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        let pkp = state.done["1"]?.str("publicKeyPackage") ?? ""
        let r: Doc
        do {
            r = try Engine.object("signAggregate",
                                  [ss.doc.str("pczt") ?? "", pkp, package, Engine.json(sh)])
        } catch {
            try await failSession(gid, ss, error.localizedDescription)
            throw error
        }
        // A seat signs the result. A seat that cannot sign is no failure of the payment.
        let result: Doc = ["signed": r["signed_pczt"] ?? NSNull(),
                           "signatures": r["signatures"] ?? NSNull()]
        let data = try partSigned(gid, ss.id, .signed, result)
        try await patch(path, data.merging(["status": "signed"]) { $1 })
        note("signatures aggregated and verified under rk")
    }

    /// Marks a payment as failed. In a version 3 wallet the failure carries a seat's signature.
    private func failSession(_ gid: String, _ ss: Session, _ error: String,
                             prefer: Int? = nil) async throws {
        var data = try partSigned(gid, ss.id, .failure, ["error": error], prefer: prefer)
        data["status"] = "failed"
        try await patch("groups/\(gid)/sessions/\(ss.id)", data)
    }

    // MARK: Actions

    /// Accepts a web invite link (`https://…/#gid.secret`) or `zigs://join#gid.secret`.
    func join(_ link: String) {
        if locked { linkWhileLocked = link; return }
        guard let frag = link.split(separator: "#", maxSplits: 1).last, frag.contains(".") else {
            banner = "This is not a full invite link. Ask for the link that ends with # and the wallet secret."
            return
        }
        let parts = frag.split(separator: ".", maxSplits: 1).map(String.init)
        let hex = CharacterSet(charactersIn: "0123456789abcdef")
        guard parts.count == 2, parts[0].count == 20, parts[1].count == 43,
              parts[0].unicodeScalars.allSatisfy(hex.contains) else {
            banner = "The key in this link is not valid."
            return
        }
        // A link must not replace a wallet key this device already has.
        if let known = vault.keys[parts[0]], known != parts[1] {
            banner = "This invite link has a different key for a wallet you already have, so it was ignored."
            return
        }
        vault.putKey(parts[0], parts[1])
        store.join(parts[0])
        autoSeat = true
        path = [parts[0]]
        select(parts[0])
        note("joined wallet \(parts[0].prefix(8))…")
    }

    /// After joining from an invite link, take the lowest open seat once.
    private func takeFirstOpenSeat() {
        guard autoSeat, store.connected else { return }
        autoSeat = false
        // A wallet that is not version 2 or 3 asks the person first (the join card warns).
        let free = state.seatIds.first { state.seats["\($0)"] == nil }
        guard usesV2(state.version), localSeats.isEmpty, let free else { return }
        takeSeat(free)
    }

    /// The seat keeps the version of its wallet, its own box key and its own signing key. The store
    /// can show another version or box key later (reactStops). `version` is only set for a wallet
    /// that is new here. Every seat gets a signing key; a version 3 wallet needs it.
    func takeSeat(_ i: Int, version: Int? = nil) {
        guard let gid else { return }
        once("seat:\(i)") {
            let version = version ?? self.state.version
            guard version != 0 else { throw ZigsError("This version of Zigs cannot set up this wallet.") }
            let path = "groups/\(gid)/seats/\(i)"
            guard try await self.store.acquire(path, holder: UUID().uuidString, ttlMs: 5000) else {
                throw ZigsError("Someone else is taking seat \(i) right now.")
            }
            if self.state.seats["\(i)"]?.str("uid") != nil { throw ZigsError("Seat \(i) is already taken.") }
            let kp = try Engine.object("boxKeypair", [])
            let sign = Signed.newKey()
            let secret: Doc = ["boxSk": kp["sk"] ?? NSNull(), "version": version,
                               "signSk": sign.signSk, "signPk": sign.signPk]
            guard self.vault.putSec(gid, i, secret) else {
                throw ZigsError("This \(deviceName) could not save the keys of your seat, "
                    + "so the seat was not taken.")
            }
            var seatDoc: Doc = ["uid": self.me, "name": self.name, "boxPk": kp["pk"] ?? NSNull(),
                                "signPk": sign.signPk, "at": now()]
            // In a version 3 wallet the seat signs its own document with the new key. Readers
            // pin this key only when the signature checks out.
            if version == 3 {
                let signer = Signed.Signer(seat: i, signSk: sign.signSk)
                seatDoc = try Signed.signDoc(gid, "seats/\(i)", as: signer, seatDoc)
            }
            try await self.put(path, seatDoc)
            // Saved only after the store holds the seat: a failed take must not look like a replaced key.
            self.vault.putSec(gid, i, ["boxPk": kp["pk"] ?? NSNull()])
            self.note("you took seat \(i)")
        }
    }

    /// Creates a wallet and takes seat 1. With `from`, the new wallet replaces `from`: the old wallet
    /// gets only the new id, never its key, so signers left out cannot read the new wallet.
    func createGroup(name: String, n: Int, t: Int, from: String? = nil, network: String = "testnet") async throws {
        let id = randomHex(10)
        var key = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, key.count, &key) == errSecSuccess else {
            throw ZigsError("This \(deviceName) could not make a random key.")
        }
        let b64 = Data(key).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        vault.putKey(id, b64)
        store.join(id)
        var g: Doc = ["name": name, "n": n, "t": t, "network": network, "version": 3,
                      "createdBy": me, "createdAt": now()]
        if let from { g["movedFrom"] = from }
        try await put("groups/\(id)", g)
        if let from { try await patch("groups/\(from)", ["movedTo": id, "movedAt": now()]) }
        path = [id]
        select(id)
        takeSeat(1, version: 3)
    }

    /// Proposes a payment to one or more recipients, in one transaction. `payees` and `note` are
    /// the proposer's words, which approvers check against the transaction itself.
    func propose(payees: [(to: String, amount: Int)], note: String?, move: String? = nil) async throws {
        guard let gid, let chain, chain.balance != nil else { throw ZigsError("The wallet has not finished its first sync.") }
        if signedMode(gid) && writer(in: gid) == nil { throw ZigsError(Signed.noSeatKey) }
        let list: [Doc] = payees.map { ["to": $0.to, "amount": $0.amount] }
        let amount = payees.reduce(0) { $0 + $1.amount }
        let t = try await chain.spend(payees: list)
        let sid = randomHex(10)
        let fields: Doc = [
            "createdAt": now(), "payees": list, "note": note ?? NSNull(),
            "pool": t["pool"] ?? "ironwood", "amount": t["amount"] ?? amount,
            "change": t["change"] ?? 0, "fee": t["fee"] ?? 0,
            "noteValue": t["note_value"] ?? 0, "pczt": t["pczt"] ?? "", "move": move ?? NSNull(),
        ]
        var doc = try partSigned(gid, sid, .proposal, fields)
        doc["createdBy"] = myUid
        doc["status"] = "collecting"
        try await put("groups/\(gid)/sessions/\(sid)", doc)
        self.note("new payment: \(zec(amount))")
        notice = "Payment proposed. It needs \(state.t) approvals."
    }

    /// Sends every confirmed note to the wallet that replaces this one.
    func proposeMove() async throws {
        guard let to = state.movedTo, let address = wallets[to]?.str("address") else {
            throw ZigsError("The new wallet has no address yet.")
        }
        guard maxSend > 0 else { throw ZigsError("No confirmed funds to move yet.") }
        try await propose(payees: [(address, maxSend)], note: "Move to \(groupName(to))", move: to)
    }

    func cancelMove() async throws {
        guard let gid else { return }
        try await patch("groups/\(gid)", ["movedTo": NSNull(), "movedAt": NSNull()])
        notice = "Move cancelled. This wallet stays as it is."
    }

    func inspect(_ ss: Session) -> Result<Doc, ZigsError> {
        do {
            return .success(try Engine.object("inspect", [ss.doc.str("pczt") ?? "", state.wallet?.str("orchard_fvk") ?? ""]))
        } catch {
            return .failure(ZigsError(error.localizedDescription))
        }
    }

    func normalized(_ address: String) -> String? { try? Engine.call("normalizeAddress", [address]) }

    func pendingApprovals(_ ss: Session) -> [Int] {
        guard let gid, !has(ss.doc["package"]), !has(ss.doc["error"]) else { return [] }
        let commits = state.commits[ss.id] ?? [:]
        return localSeats.filter {
            has(vault.sec(gid, $0)["keyPackage"]) && has(state.verify["\($0)"]?["ok"]) && commits["\($0)"] == nil
                && canWriteAs($0, in: gid)
        }
    }

    /// The address of wallet `gid` as one of this device's seats checked it, or nil. The store's
    /// copy is a claim anyone with the wallet key can write.
    func checkedAddress(of gid: String) -> String? {
        let checked = vault.seats(in: gid).lazy.compactMap { self.vault.sec(gid, $0).str("checkedWallet") }.first
        let doc = checked.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? Doc }
        return doc?.str("address")
    }

    func approve(_ ss: Session, _ i: Int) {
        guard let gid, let fvk = state.wallet?.str("orchard_fvk") else { return }
        once("approve:\(ss.id):\(i)") {
            let s = self.vault.sec(gid, i)
            guard !has(ss.doc["error"]) else { throw ZigsError("This payment was cancelled or failed, so it was not approved.") }
            guard has(self.state.verify["\(i)"]?["ok"]) else {
                throw ZigsError("Seat \(i) has not checked this wallet against its key share, so it did not approve.")
            }
            guard case .success(let ins) = self.inspect(ss), let sighash = ins.str("sighash") else {
                throw ZigsError("This device could not check the payment, so it did not approve.")
            }
            let r = try Engine.object("signCommit", [ss.doc.str("pczt") ?? "", fvk, Engine.json(s["keyPackage"] ?? NSNull())])
            var nonces = s.doc("nonces") ?? [:]
            nonces[ss.id] = ["nonces": r["nonces"] ?? NSNull(), "commitments": r["commitments"] ?? NSNull(),
                             "sighash": sighash]
            // A seat that cannot sign fails here, before the approval is saved.
            let rel = "sessions/\(ss.id)/commits/\(i)"
            let doc = try self.signed(gid, rel, as: i,
                                      ["commitments": r["commitments"] ?? NSNull(), "at": now()])
            guard self.vault.putSec(gid, i, ["nonces": nonces]) else {
                throw ZigsError("Could not save the approval on this device, so it was not sent.")
            }
            try await self.put("groups/\(gid)/\(rel)", doc)
            self.note("seat \(i): approved the payment")
        }
    }

    /// Until the signatures are combined, any signer can withdraw a payment, for example one that
    /// lost an approval. A signature share alone cannot move funds.
    func cancel(_ ss: Session) {
        guard let gid, !has(ss.doc["signed"]), !has(ss.doc["error"]) else { return }
        once("cancel:\(ss.id)") {
            let seat = self.writer(in: gid) ?? self.localSeats.first
            let name = seat.flatMap { self.state.seats["\($0)"]?.str("name") } ?? ""
            let who = (name.isEmpty ? "a signer" : name) + (seat.map { " (seat \($0))" } ?? "")
            let fields: Doc = ["status": "cancelled", "error": "Cancelled by \(who)."]
            let data = try self.partSigned(gid, ss.id, .cancel, fields, prefer: seat)
            try await self.patch("groups/\(gid)/sessions/\(ss.id)", data)
            for i in self.localSeats {
                var nonces = self.vault.sec(gid, i).doc("nonces") ?? [:]
                if nonces.removeValue(forKey: ss.id) != nil { self.vault.putSec(gid, i, ["nonces": nonces]) }
            }
            self.notice = "Payment cancelled."
        }
    }

    func canProve(_ ss: Session) -> Bool {
        let stalled = (ss.doc.int("provingAt") ?? 0) < now() - 180_000
        return has(ss.doc["signed"]) && !has(ss.doc["final"]) && (ss.status != "proving" || stalled)
            && !proving.contains(ss.id) && canAct
    }

    /// Builds the Halo2 proof on this iPhone and checks the whole transaction.
    func prove(_ ss: Session) {
        guard let gid, canAct, let signed = ss.doc.str("signed") else { return }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        proving.insert(ss.id)
        once("prove:\(ss.id)") {
            defer { self.proving.remove(ss.id) }
            try await self.patch(path, ["status": "proving", "provingAt": now()])
            let start = Date()
            let text: String
            do {
                text = try await Task.detached { try Engine.call("finalize", [signed]) }.value
            } catch {
                try await self.patch(path, ["status": "signed"])
                throw error
            }
            guard var out = try Engine.parse(text) as? Doc else { throw ZigsError("bad proof result") }
            out["ms"] = Int(Date().timeIntervalSince(start) * 1000)
            let data = try self.partSigned(gid, ss.id, .final, ["final": out])
            try await self.patch(path, data.merging(["status": "complete"]) { $1 })
            self.note("proof built on this \(deviceName) in \(out.int("ms") ?? 0) ms")
        }
    }

    func broadcast(_ ss: Session) {
        guard let gid, canAct, let final = ss.doc.doc("final"), let hex = final.str("tx_hex"),
              let txid = final.str("txid") else { return }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        once("broadcast:\(ss.id)") {
            do {
                // The sent mark names the txid of the final transaction, and a seat signs it. A
                // seat that cannot sign fails here, before the transaction goes out.
                let sent = try self.partSigned(gid, ss.id, .sent,
                                               ["broadcastTxid": txid, "broadcastAt": now()])
                try await Lightwalletd.send(hex: hex, toFirstOf: self.state.net.servers)
                try await self.patch(path, sent.merging(["broadcastError": NSNull(),
                                                          "status": "broadcast"]) { $1 })
                self.note("transaction broadcast: \(final.str("txid") ?? "")")
                self.notice = "Sent to the network. It confirms with the next block."
                if let chain = self.chain { Task { await chain.sync() } }
            } catch {
                try await self.patch(path, ["broadcastError": error.localizedDescription])
                throw error
            }
        }
    }
}

func now() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

func randomHex(_ bytes: Int) -> String {
    (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
}
