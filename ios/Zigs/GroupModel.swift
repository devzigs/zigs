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

    var n: Int { g?.int("n") ?? 0 }
    var t: Int { g?.int("t") ?? 0 }
    var name: String { g?.str("name") ?? "Wallet" }
    var movedTo: String? { g?.str("movedTo") }
    var movedFrom: String? { g?.str("movedFrom") }
    var net: ZcashNetwork { .of(g?.str("network")) }
    /// The network name that the wallet document must carry. A group that names none is testnet.
    var netName: String { g?.str("network") == "mainnet" ? "mainnet" : "testnet" }
    /// 1 when the group document has no version, 2 for the ZIP 2005 ceremony, 0 for a version this
    /// app does not know.
    var version: Int {
        guard let v = g?["version"] else { return 1 }
        // A JSON true is not the number 1.
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              n.doubleValue == 1 || n.doubleValue == 2 else { return 0 }
        return n.intValue
    }
    var seatIds: [Int] { n > 0 ? Array(1...n) : [] }
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
        let packages = Set(docs.map { GroupModel.walletKey($0.doc("publicKeyPackage")) })
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

/// Seats whose confirm document holds another safety number than `number`.
func numberClash(_ number: String, _ docs: [String: Doc], _ ids: [Int]) -> [Int] {
    ids.filter { i in docs["\(i)"]?.str("number").map { $0 != number } ?? false }
}

/// May the key ceremony of a version 2 wallet run? `mine` is the number the person confirmed on
/// this device: a confirm document alone is only a claim. Same rules as confirmGate in web/util.js.
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
    var notice: String?
    var path: [String] = []

    @ObservationIgnored let store = Store()
    @ObservationIgnored let vault = Vault()
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

    private func note(_ msg: String) {
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
                  let val = try? Engine.parse(pt) else { continue }
            opened[cacheKey] = val
            out[field] = val
        }
        return out.isEmpty && !raw.isEmpty ? nil : out
    }

    private func seal(_ path: String, _ data: Doc) throws -> Doc {
        guard let k = key(path) else { throw ZigsError("No key for \(path).") }
        var out = Doc()
        for (field, v) in data { out[field] = try Engine.call("secretSeal", [k, path + "\n" + field, Engine.json(v)]) }
        return out
    }

    private func put(_ path: String, _ data: Doc) async throws { try await store.set(path, seal(path, data)) }
    private func patch(_ path: String, _ data: Doc) async throws { try await store.update(path, seal(path, data)) }

    private func children(_ path: String) -> [String: Doc] {
        var out: [String: Doc] = [:]
        for (id, raw) in store.children(path) {
            if let d = open(path + "/" + id, raw) { out[id] = d }
        }
        return out
    }

    // MARK: State

    private func refresh() {
        connected = store.connected
        var list: [GroupInfo] = [], ws: [String: Doc] = [:], counts: [String: Int] = [:]
        for (id, raw) in store.children("groups") {
            guard let g = open("groups/" + id, raw) else { continue }
            list.append(GroupInfo(id: id, name: g.str("name") ?? "Wallet", n: g.int("n") ?? 0, t: g.int("t") ?? 0,
                                  createdAt: g.int("createdAt") ?? 0, movedTo: g.str("movedTo"), network: g.str("network")))
            let wpath = "groups/\(id)/meta/wallet"
            if let w = open(wpath, store.docs[wpath]) { ws[id] = w }
            if !vault.seats(in: id).isEmpty {
                let sessions = children("groups/\(id)/sessions").map { Session(id: $0.key, doc: $0.value) }
                counts[id] = sessions.filter { needsMyApproval(id, $0) }.count
            }
        }
        groups = list.sorted { $0.createdAt > $1.createdAt }
        wallets = ws
        toApprove = counts
        if let gid { state = load(gid) }
        react()
    }

    private func load(_ gid: String) -> GroupState {
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
        // The store's verify documents are claims anyone with the wallet key can write. For its own
        // seats this device uses its own result, tied to the exact wallet document.
        let wk = Self.walletKey(s.wallet)
        for i in vault.seats(in: gid) where s.seats["\(i)"]?.str("uid") == me {
            let sec = vault.sec(gid, i)
            let mine: Bool? = sec.str("checkedWallet") == wk ? true : sec.str("rejectedWallet") == wk ? false : nil
            s.verify["\(i)"] = mine.map { ["ok": $0] }
        }
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
        chain?.close()
        chain = nil
        state = id.map(load) ?? GroupState()
        react()
    }

    var localSeats: [Int] {
        guard let gid else { return [] }
        return vault.seats(in: gid).filter { state.seats["\($0)"]?.str("uid") == me }
    }

    var myVerified: Bool { localSeats.contains { has(state.verify["\($0)"]?["ok"]) } }
    /// A signer sees the address only after its own seat checked it against its key share.
    var addressHidden: Bool { !localSeats.isEmpty && !myVerified }
    var isCreator: Bool { state.g?.str("createdBy") == me }

    func seatLabel(_ i: Int) -> String {
        guard let s = state.seats["\(i)"] else { return "Open seat" }
        if s.str("uid") == me { return localSeats.count > 1 ? "You (seat \(i))" : "You" }
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
        return vault.seats(in: gid).contains { i in
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
            has($0.doc["broadcastTxid"]) && !chain.sent.contains($0.doc.doc("final")?.str("txid") ?? "")
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
        guard seatMode(s) == 2, let mine = s.str("boxPk"),
              let shown = state.seats["\(i)"]?.str("boxPk"), mine != shown else { return nil }
        return "Your seat key was replaced"
    }

    private func numberChanged(_ s: Doc) -> String? {
        guard seatMode(s) == 2, !has(s["keyPackage"]), let confirmed = s.str("confirmed"),
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
            guard let text = vault.sec(gid, i).str("aborted"), !state.abortSent(i) else {
                continue
            }
            once("abort:\(i)") { try await self.put("groups/\(gid)/abort/\(i)", ["reason": text]) }
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
        if isStopped(s) { return }
        let started = seatMode(s) == 2 ? stepV2(gid, i, s) : stepV1(gid, i, s)
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
        try await put("groups/\(gid)/done/\(i)", ["groupKey": groupKey, "publicKeyPackage": package, "at": now()])
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
        try await put("groups/\(gid)/dkg1/\(i)", ["package": s["r1package"] ?? NSNull(), "at": now()])
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
            try await put("groups/\(gid)/dkg2/\(i)-\(to)", ["sealed": sealed, "at": now()])
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

    // MARK: Key ceremony, version 2
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

    private func canConfirm(_ s: Doc) -> Bool { !has(s["keyPackage"]) && !has(s["aborted"]) && seatMode(s) == 2 }

    private var confirmable: [Int] {
        guard let gid else { return [] }
        return localSeats.filter { canConfirm(vault.sec(gid, $0)) }
    }

    /// A device that holds every seat has nobody else to compare with.
    var holdsAllSeats: Bool { localSeats.count == state.n }

    /// The safety number card shows until every seat holds its key share.
    var safetyOpen: Bool { state.version == 2 && state.allSeated && !state.allDone && !holdsAllSeats }

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
        guard state.version == 2 else { return nil }
        let old = state.seatIds.filter { i in
            state.dkg1["\(i)"].map { !Self.isHex64($0.str("commit")) } ?? false
        }
        guard !old.isEmpty else { return nil }
        return "Seat \(old.map(String.init).joined(separator: ", ")) uses an old version of Zigs "
            + "and cannot join this wallet. Update it, or create a new wallet."
    }

    private var unreadableKeyText: String? {
        guard state.version == 2, state.allSeated, safetyNumber == nil else { return nil }
        return "A seat holds a key that this app cannot read. Do not use this wallet. "
            + "Create a new wallet."
    }

    private var clashText: String? {
        guard state.version == 2, !state.allDone, let no = safetyNumber else { return nil }
        let clash = numberClash(no, state.confirm, state.seatIds)
        guard !clash.isEmpty else { return nil }
        let seats = clash.map(String.init).joined(separator: ", ")
        return "Seat \(seats) confirmed another safety number. Do not continue. Create a new wallet."
    }

    private var waitText: String? {
        guard state.version == 2, !state.allDone, let no = safetyNumber else { return nil }
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
        guard state.version == 2, let no = safetyNumber else { return }
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
            vault.putSec(gid, i, ["confirmed": no])
            try await put("groups/\(gid)/confirm/\(i)", ["number": no])
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
        try await put("groups/\(gid)/dkg1/\(i)", ["package": s["r1package"] ?? NSNull(), "commit": commit, "at": now()])
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
            try await put("groups/\(gid)/dkg2/\(i)-\(to)", ["sealed": sealed, "echo": out.echo, "at": now()])
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
        vault.putSec(gid, i, ok ? ["checkedWallet": wk, "rejectedWallet": NSNull()] : ["rejectedWallet": wk])
        try await put("groups/\(gid)/verify/\(i)", ["ok": ok, "error": reason, "at": now()])
        note(ok ? "seat \(i): wallet verified, ak equals my group key" : "seat \(i): WALLET REJECTED")
    }

    /// The wallet must name its group's network. A seat that holds sk checks every part of the
    /// wallet, so only version 2 verification applies to it, whatever the stored documents say. A
    /// seat without sk never accepts a version 2 wallet.
    private func verifyCall(_ s: Doc) throws {
        guard state.wallet?.str("network") == state.netName else {
            throw ZigsError("The wallet names another network than its group. Do not use this wallet.")
        }
        let wallet = Engine.json(state.wallet ?? [:]), pkp = Engine.json(s["publicKeyPackage"] ?? NSNull())
        if let sk = s.str("vaultSk") {
            _ = try Engine.call("walletVerifyV2", [wallet, pkp, sk])
            return
        }
        if state.version == 2 {
            throw ZigsError("This seat holds no setup secret for a version 2 wallet. Do not use this wallet.")
        }
        _ = try Engine.call("walletVerify", [wallet, pkp])
    }

    private var v2Secret: Doc? {
        guard let gid else { return nil }
        return localSeats.map { vault.sec(gid, $0) }.first { has($0["vaultSk"]) && has($0["publicKeyPackage"]) }
    }

    private var canCreateWallet: Bool {
        isCreator && state.wallet == nil && state.keysAgree && (state.version != 2 || v2Secret != nil)
    }

    /// The wallet document for the group's version, or nil when its key data is not there yet.
    private func walletDoc(_ net: String) throws -> Doc? {
        if state.version == 2 {
            guard let mine = v2Secret, let sk = mine.str("vaultSk") else { return nil }
            return try Engine.object("walletCreateV2", [Engine.json(mine["publicKeyPackage"] ?? NSNull()), net, sk])
        }
        guard let pkp = state.done["1"]?.str("publicKeyPackage") else { return nil }
        return try Engine.object("walletCreate", [pkp, net])
    }

    /// The creator builds the shared wallet once every seat computed the same group key.
    private func createWallet(_ gid: String) async throws {
        // The wallet document can arrive after the key ones; never replace a published wallet.
        if store.docs["groups/\(gid)/meta/wallet"] != nil { return }
        var birthday: Int?
        for url in state.net.servers where birthday == nil { birthday = try? await Lightwalletd.latestHeight(url) }
        guard let birthday else { throw ZigsError("No light-wallet server answers, so the wallet cannot be dated.") }
        guard var w = try walletDoc(state.g?.str("network") ?? "testnet") else { return }
        w["birthday"] = birthday
        w["at"] = now()
        try await put("groups/\(gid)/meta/wallet", w)
        note("wallet created: \((w.str("address") ?? "").prefix(24))…")
    }

    private func reactSession(_ ss: Session) {
        guard let gid, let fvk = state.wallet?.str("orchard_fvk"), !has(ss.doc["error"]) else { return }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        let commits = state.commits[ss.id] ?? [:]
        // Proposer: once enough signers approve, build the signing package.
        if ss.doc.str("createdBy") == me && !has(ss.doc["package"]) {
            let ids = commits.keys.compactMap(Int.init).sorted().prefix(state.t)
            if ids.count >= state.t {
                once("pkg:\(ss.id)") {
                    var c = Doc()
                    for i in ids { c["\(i)"] = commits["\(i)"]?["commitments"] }
                    let pkg = try Engine.call("signPackage", [ss.doc.str("pczt") ?? "", fvk, Engine.json(c), self.state.t])
                    try await self.patch(path, ["package": pkg, "signers": Array(ids), "status": "signing"])
                    self.note("signing package sent to signers \(ids.map(String.init).joined(separator: ", "))")
                }
            }
            return
        }
        guard let package = ss.doc.str("package") else { return }
        let signers = (ss.doc["signers"] as? [NSNumber])?.map(\.intValue) ?? []
        let shares = state.shares[ss.id] ?? [:]
        for i in localSeats where signers.contains(i) && shares["\(i)"] == nil {
            guard let n = vault.sec(gid, i).doc("nonces")?.doc(ss.id) else { continue }
            once("share:\(ss.id):\(i)") { try await self.signShare(gid, ss, i, fvk, package, n) }
        }
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
            try await patch("groups/\(gid)/sessions/\(ss.id)",
                            ["error": "The payment changed after a signer approved it.", "status": "failed"])
            throw ZigsError("This payment changed after you approved it, so this device did not sign it.")
        }
        // The engine checks the approved sighash again before it signs.
        let share = try Engine.call("signShare", [ss.doc.str("pczt") ?? "", fvk, package, Engine.json(n),
                                                  Engine.json(s["keyPackage"] ?? NSNull()), i])
        // Burn the nonces before the share goes out: a nonce that comes back could sign twice.
        guard vault.putSec(gid, i, ["nonces": nonces]) else {
            throw ZigsError("Could not save the used nonce, so the signature share was not sent.")
        }
        try await put("groups/\(gid)/sessions/\(ss.id)/shares/\(i)", ["shares": share, "at": now()])
        note("seat \(i): signature share sent")
    }

    private func aggregate(_ gid: String, _ ss: Session, _ package: String, _ signers: [Int]) async throws {
        let shares = state.shares[ss.id] ?? [:]
        var sh = Doc()
        for i in signers { sh["\(i)"] = try Engine.parse(shares["\(i)"]?.str("shares") ?? "") }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        let pkp = state.done["1"]?.str("publicKeyPackage") ?? ""
        do {
            let r = try Engine.object("signAggregate", [ss.doc.str("pczt") ?? "", pkp, package, Engine.json(sh)])
            try await patch(path, ["signed": r["signed_pczt"] ?? NSNull(), "signatures": r["signatures"] ?? NSNull(),
                                   "status": "signed"])
            note("signatures aggregated and verified under rk")
        } catch {
            try await patch(path, ["error": error.localizedDescription, "status": "failed"])
            throw error
        }
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
        // A wallet that is not version 2 asks the person first (the join card shows the warning).
        guard state.version == 2, localSeats.isEmpty, let open = state.seatIds.first(where: { state.seats["\($0)"] == nil }) else { return }
        takeSeat(open)
    }

    /// The seat keeps the version of its wallet and its own box key. The store can show another
    /// version or key later (reactStops). `version` is only set for a wallet that is new here.
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
            self.vault.putSec(gid, i, ["boxSk": kp["sk"] ?? NSNull(), "version": version])
            try await self.put(path, ["uid": self.me, "name": self.name, "boxPk": kp["pk"] ?? NSNull(), "at": now()])
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
        var g: Doc = ["name": name, "n": n, "t": t, "network": network, "version": 2, "createdBy": me, "createdAt": now()]
        if let from { g["movedFrom"] = from }
        try await put("groups/\(id)", g)
        if let from { try await patch("groups/\(from)", ["movedTo": id, "movedAt": now()]) }
        path = [id]
        select(id)
        takeSeat(1, version: 2)
    }

    /// Proposes a payment to one or more recipients, in one transaction. `payees` and `note` are
    /// the proposer's words, which approvers check against the transaction itself.
    func propose(payees: [(to: String, amount: Int)], note: String?, move: String? = nil) async throws {
        guard let gid, let chain, chain.balance != nil else { throw ZigsError("The wallet has not finished its first sync.") }
        let list: [Doc] = payees.map { ["to": $0.to, "amount": $0.amount] }
        let amount = payees.reduce(0) { $0 + $1.amount }
        let t = try await chain.spend(payees: list)
        let sid = randomHex(10)
        try await put("groups/\(gid)/sessions/\(sid)", [
            "createdBy": me, "createdAt": now(), "payees": list, "note": note ?? NSNull(), "pool": t["pool"] ?? "ironwood",
            "amount": t["amount"] ?? amount, "change": t["change"] ?? 0, "fee": t["fee"] ?? 0,
            "noteValue": t["note_value"] ?? 0, "pczt": t["pczt"] ?? "", "move": move ?? NSNull(), "status": "collecting",
        ])
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
            guard self.vault.putSec(gid, i, ["nonces": nonces]) else {
                throw ZigsError("Could not save the approval on this device, so it was not sent.")
            }
            try await self.put("groups/\(gid)/sessions/\(ss.id)/commits/\(i)",
                               ["commitments": r["commitments"] ?? NSNull(), "at": now()])
            self.note("seat \(i): approved the payment")
        }
    }

    /// Until the signatures are combined, any signer can withdraw a payment, for example one that
    /// lost an approval. A signature share alone cannot move funds.
    func cancel(_ ss: Session) {
        guard let gid, !has(ss.doc["signed"]), !has(ss.doc["error"]) else { return }
        once("cancel:\(ss.id)") {
            let name = self.localSeats.first.flatMap { self.state.seats["\($0)"]?.str("name") } ?? ""
            let who = name.isEmpty ? "a signer" : name
            try await self.patch("groups/\(gid)/sessions/\(ss.id)", ["status": "cancelled", "error": "Cancelled by \(who)."])
            for i in self.localSeats {
                var nonces = self.vault.sec(gid, i).doc("nonces") ?? [:]
                if nonces.removeValue(forKey: ss.id) != nil { self.vault.putSec(gid, i, ["nonces": nonces]) }
            }
            self.notice = "Payment cancelled."
        }
    }

    func canProve(_ ss: Session) -> Bool {
        let stalled = now() - (ss.doc.int("provingAt") ?? 0) > 180_000
        return has(ss.doc["signed"]) && !has(ss.doc["final"]) && (ss.status != "proving" || stalled)
            && !proving.contains(ss.id)
    }

    /// Builds the Halo2 proof on this iPhone and checks the whole transaction.
    func prove(_ ss: Session) {
        guard let gid, let signed = ss.doc.str("signed") else { return }
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
            try await self.patch(path, ["status": "complete", "final": out])
            self.note("proof built on this \(deviceName) in \(out.int("ms") ?? 0) ms")
        }
    }

    func broadcast(_ ss: Session) {
        guard let gid, let final = ss.doc.doc("final"), let hex = final.str("tx_hex") else { return }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        once("broadcast:\(ss.id)") {
            do {
                try await Lightwalletd.send(hex: hex, toFirstOf: self.state.net.servers)
                try await self.patch(path, ["broadcastTxid": final.str("txid") ?? "", "broadcastAt": now(),
                                            "broadcastError": NSNull(), "status": "broadcast"])
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
