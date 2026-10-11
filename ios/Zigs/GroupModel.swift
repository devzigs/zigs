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
}

/// One group, decrypted. Same document layout as web/index.html.
struct GroupState {
    var g: Doc?
    var seats: [String: Doc] = [:]
    var dkg1: [String: Doc] = [:]
    var dkg2: [String: Doc] = [:]
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
    var seatIds: [Int] { n > 0 ? Array(1...n) : [] }
    var allSeated: Bool { seatIds.allSatisfy { seats["\($0)"]?.str("boxPk") != nil } }
    var seatedCount: Int { seatIds.filter { seats["\($0)"] != nil }.count }
    var allR1: Bool { seatIds.allSatisfy { dkg1["\($0)"] != nil } }
    var allDone: Bool { !seatIds.isEmpty && seatIds.allSatisfy { done["\($0)"] != nil } }
    var keysAgree: Bool { allDone && Set(seatIds.compactMap { done["\($0)"]?.str("groupKey") }).count == 1 }
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

/// A seat publishes its first key message right after joining, so stage 2 still reads as joined.
let stageLabels = ["Open", "Joined", "Joined", "Creating key", "Key ready", "Address checked"]

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
    var banner: String?
    var notice: String?
    var path: [String] = []

    @ObservationIgnored let store = Store()
    @ObservationIgnored let vault = Vault()
    @ObservationIgnored private var busy = Set<String>()
    @ObservationIgnored private(set) var me: String
    @ObservationIgnored private var proving = Set<String>()
    @ObservationIgnored private var autoSeat = false
    /// Decrypted field values by ciphertext; every store change would otherwise decrypt everything.
    @ObservationIgnored private var opened: [String: Any] = [:]

    var server: String { didSet { UserDefaults.standard.set(server, forKey: "zf-server") } }
    var name: String { didSet { UserDefaults.standard.set(name, forKey: "zf-name") } }

    init() {
        let d = UserDefaults.standard
        if d.string(forKey: "zf-uid") == nil { d.set(UUID().uuidString.lowercased(), forKey: "zf-uid") }
        me = d.string(forKey: "zf-uid") ?? ""
        server = d.string(forKey: "zf-server") ?? "https://app.zigs.app"
        name = d.string(forKey: "zf-name") ?? ""
        loadBalances()
        store.onChange = { [weak self] in self?.refresh() }
        reconnect()
    }

    func reconnect() {
        guard let url = URL(string: server) else { banner = "The server address is not valid."; return }
        store.connect(server: url)
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
            if let hit = opened[ct] { out[field] = hit; continue }
            guard let pt = try? Engine.call("secretOpen", [k, path + "\n" + field, ct]),
                  let val = try? Engine.parse(pt) else { continue }
            opened[ct] = val
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
                                  createdAt: g.int("createdAt") ?? 0, movedTo: g.str("movedTo")))
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
        let c = Chain(gid: gid, ufvk: ufvk, birthday: birthday, groupKey: key)
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
            do { try await op() } catch {
                note("✗ \(key): \(error.localizedDescription)")
                banner = error.localizedDescription
            }
            busy.remove(key)
            react()
        }
    }

    private func react() {
        guard let gid, state.g != nil else { return }
        takeFirstOpenSeat()
        for i in localSeats { advanceSeat(gid, i) }
        if isCreator && state.wallet == nil && state.keysAgree {
            once("wallet") { try await self.createWallet(gid) }
        }
        guard state.wallet != nil else { return }
        if state.ready && myVerified { ensureChain(gid) }
        for ss in state.sessions { reactSession(ss) }
    }

    private func advanceSeat(_ gid: String, _ i: Int) {
        let s = vault.sec(gid, i)
        let ready = !has(s["keyPackage"])
        if state.dkg1["\(i)"] == nil && ready { return once("r1:\(i)") { try await self.round1(gid, i) } }
        if has(s["r1secret"]) && !has(s["r2secret"]) && ready && state.allSeated && state.allR1 {
            return once("r2:\(i)") { try await self.round2(gid, i) }
        }
        if has(s["r2secret"]) && ready && state.allR1 && state.r2For(i) {
            return once("r3:\(i)") { try await self.round3(gid, i) }
        }
        if !ready && state.wallet != nil && state.verify["\(i)"] == nil {
            once("verify:\(i)") { try await self.verifyWallet(gid, i) }
        }
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
        try await put("groups/\(gid)/done/\(i)", ["groupKey": groupKey,
                                                 "publicKeyPackage": Engine.json(r["public_key_package"] ?? NSNull()),
                                                 "at": now()])
        note("seat \(i): key share ready, group key \(groupKey.prefix(12))…")
    }

    private func verifyWallet(_ gid: String, _ i: Int) async throws {
        let s = vault.sec(gid, i)
        var ok = true
        var reason: Any = NSNull()
        do {
            _ = try Engine.call("walletVerify", [Engine.json(state.wallet ?? [:]), Engine.json(s["publicKeyPackage"] ?? NSNull())])
        } catch {
            ok = false
            reason = error.localizedDescription
        }
        try await put("groups/\(gid)/verify/\(i)", ["ok": ok, "error": reason, "at": now()])
        note(ok ? "seat \(i): wallet verified, ak equals my group key" : "seat \(i): WALLET REJECTED")
    }

    /// The creator builds the shared wallet once every seat computed the same group key.
    private func createWallet(_ gid: String) async throws {
        // The wallet document can arrive after the key ones; never replace a published wallet.
        if store.docs["groups/\(gid)/meta/wallet"] != nil { return }
        var birthday: Int?
        for url in lightwalletds where birthday == nil { birthday = try? await Lightwalletd.latestHeight(url) }
        guard let birthday else { throw ZigsError("No light-wallet server answers, so the wallet cannot be dated.") }
        guard let pkp = state.done["1"]?.str("publicKeyPackage") else { return }
        var w = try Engine.object("walletCreate", [pkp, state.g?.str("network") ?? "testnet"])
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
        let share = try Engine.call("signShare", [ss.doc.str("pczt") ?? "", fvk, package,
                                                  Engine.json(n["nonces"] ?? NSNull()),
                                                  Engine.json(n["commitments"] ?? NSNull()),
                                                  Engine.json(s["keyPackage"] ?? NSNull()), i])
        var nonces = s.doc("nonces") ?? [:]
        nonces[ss.id] = nil
        vault.putSec(gid, i, ["nonces": nonces])   // burn the nonces: never sign twice with them
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
        guard let frag = link.split(separator: "#", maxSplits: 1).last, frag.contains(".") else {
            banner = "This is not a full invite link. Ask for the link that ends with #group.key."
            return
        }
        let parts = frag.split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2, parts[0].count == 20, parts[1].count == 43 else {
            banner = "The key in this link is not valid."
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
        guard localSeats.isEmpty, let open = state.seatIds.first(where: { state.seats["\($0)"] == nil }) else { return }
        takeSeat(open)
    }

    func takeSeat(_ i: Int) {
        guard let gid else { return }
        once("seat:\(i)") {
            let path = "groups/\(gid)/seats/\(i)"
            guard try await self.store.acquire(path, holder: self.me, ttlMs: 5000) else {
                throw ZigsError("Someone else is taking seat \(i) right now.")
            }
            if self.state.seats["\(i)"]?.str("uid") != nil { throw ZigsError("Seat \(i) is already taken.") }
            let kp = try Engine.object("boxKeypair", [])
            self.vault.putSec(gid, i, ["boxSk": kp["sk"] ?? NSNull()])
            try await self.put(path, ["uid": self.me, "name": self.name, "boxPk": kp["pk"] ?? NSNull(), "at": now()])
            self.note("you took seat \(i)")
        }
    }

    /// Creates a wallet and takes seat 1. With `from`, the new wallet replaces `from`: the old wallet
    /// gets only the new id, never its key, so signers left out cannot read the new wallet.
    func createGroup(name: String, n: Int, t: Int, from: String? = nil) async throws {
        let id = randomHex(10)
        var key = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, key.count, &key) == errSecSuccess else {
            throw ZigsError("This iPhone could not make a random key.")
        }
        let b64 = Data(key).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        vault.putKey(id, b64)
        store.join(id)
        var g: Doc = ["name": name, "n": n, "t": t, "network": "testnet", "createdBy": me, "createdAt": now()]
        if let from { g["movedFrom"] = from }
        try await put("groups/\(id)", g)
        if let from { try await patch("groups/\(from)", ["movedTo": id, "movedAt": now()]) }
        path = [id]
        select(id)
        takeSeat(1)
    }

    /// Proposes a payment; `to` and `note` are the proposer's words, which approvers check
    /// against the transaction itself.
    func propose(to: String, amount: Int, note: String?, move: String? = nil) async throws {
        guard let gid, let chain, chain.balance != nil else { throw ZigsError("The wallet has not finished its first sync.") }
        let t = try await chain.spend(to: to, amount: amount)
        let sid = randomHex(10)
        try await put("groups/\(gid)/sessions/\(sid)", [
            "createdBy": me, "createdAt": now(), "to": to, "note": note ?? NSNull(), "pool": t["pool"] ?? "ironwood",
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
        try await propose(to: address, amount: maxSend, note: "Move to \(groupName(to))", move: to)
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
        guard let gid, !has(ss.doc["package"]) else { return [] }
        let commits = state.commits[ss.id] ?? [:]
        return localSeats.filter { has(vault.sec(gid, $0)["keyPackage"]) && commits["\($0)"] == nil }
    }

    func approve(_ ss: Session, _ i: Int) {
        guard let gid, let fvk = state.wallet?.str("orchard_fvk") else { return }
        once("approve:\(ss.id):\(i)") {
            let s = self.vault.sec(gid, i)
            let r = try Engine.object("signCommit", [ss.doc.str("pczt") ?? "", fvk, Engine.json(s["keyPackage"] ?? NSNull())])
            var nonces = s.doc("nonces") ?? [:]
            nonces[ss.id] = ["nonces": r["nonces"] ?? NSNull(), "commitments": r["commitments"] ?? NSNull()]
            self.vault.putSec(gid, i, ["nonces": nonces])
            try await self.put("groups/\(gid)/sessions/\(ss.id)/commits/\(i)",
                               ["commitments": r["commitments"] ?? NSNull(), "at": now()])
            self.note("seat \(i): approved the payment")
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
            self.note("proof built on this iPhone in \(out.int("ms") ?? 0) ms")
        }
    }

    func broadcast(_ ss: Session) {
        guard let gid, let final = ss.doc.doc("final"), let hex = final.str("tx_hex") else { return }
        let path = "groups/\(gid)/sessions/\(ss.id)"
        once("broadcast:\(ss.id)") {
            do {
                try await Lightwalletd.send(hex: hex, toFirstOf: lightwalletds)
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
