import Foundation
import Observation

/// Own node first; ChainSafe's public proxy is the backup.
let lightwalletds = [URL(string: "https://lwd.zigs.app")!, URL(string: "https://zcash-testnet.chainsafe.dev")!]
let explorerTx = "https://testnet.zcashexplorer.app/transactions/"

struct Session: Identifiable {
    let id: String
    let doc: Doc
    var status: String { doc.str("status") ?? "collecting" }
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
    var seatIds: [Int] { n > 0 ? Array(1...n) : [] }
    var allSeated: Bool { seatIds.allSatisfy { seats["\($0)"]?.str("boxPk") != nil } }
    var allR1: Bool { seatIds.allSatisfy { dkg1["\($0)"] != nil } }
    func r2For(_ to: Int) -> Bool { seatIds.filter { $0 != to }.allSatisfy { dkg2["\($0)-\(to)"] != nil } }

    func stage(_ i: Int) -> Int {
        if seats["\(i)"] == nil { return 0 }
        if has(verify["\(i)"]?["ok"]) { return 5 }
        if done["\(i)"] != nil { return 4 }
        if seatIds.contains(where: { $0 != i && dkg2["\(i)-\($0)"] != nil }) { return 3 }
        return dkg1["\(i)"] != nil ? 2 : 1
    }
}

let stageLabels = ["Open seat", "Joined", "Round 1 sent", "Round 2 sent", "Holds key share", "Verified wallet"]

@MainActor
@Observable
final class GroupModel {
    private(set) var groups: [(id: String, name: String, n: Int, t: Int)] = []
    private(set) var gid: String?
    private(set) var state = GroupState()
    private(set) var connected = false
    private(set) var log: [String] = []
    var banner: String?
    var path: [String] = []

    @ObservationIgnored let store = Store()
    @ObservationIgnored let vault = Vault()
    @ObservationIgnored private var busy = Set<String>()
    @ObservationIgnored private(set) var me: String
    @ObservationIgnored private var proving = Set<String>()
    @ObservationIgnored private var autoSeat = false

    var server: String { didSet { UserDefaults.standard.set(server, forKey: "zf-server") } }
    var name: String { didSet { UserDefaults.standard.set(name, forKey: "zf-name") } }

    init() {
        let d = UserDefaults.standard
        if d.string(forKey: "zf-uid") == nil { d.set(UUID().uuidString.lowercased(), forKey: "zf-uid") }
        me = d.string(forKey: "zf-uid") ?? ""
        server = d.string(forKey: "zf-server") ?? "https://app.zigs.app"
        name = d.string(forKey: "zf-name") ?? "iPhone"
        store.onChange = { [weak self] in self?.refresh() }
        reconnect()
    }

    func reconnect() {
        guard let url = URL(string: server) else { banner = "The server address is not valid."; return }
        store.connect(server: url)
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
        var out = Doc()
        for (field, v) in raw {
            guard let ct = v as? String,
                  let pt = try? Engine.call("secretOpen", [k, path + "\n" + field, ct]),
                  let val = try? Engine.parse(pt) else { continue }
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
        groups = store.children("groups").compactMap { id, raw in
            guard let g = open("groups/" + id, raw) else { return nil }
            return (id, g.str("name") ?? "Group", g.int("n") ?? 0, g.int("t") ?? 0)
        }.sorted { $0.name < $1.name }
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
        gid = id
        state = id.map(load) ?? GroupState()
        react()
    }

    var localSeats: [Int] {
        guard let gid else { return [] }
        return vault.seats(in: gid).filter { state.seats["\($0)"]?.str("uid") == me }
    }

    func seatName(_ i: Int) -> String {
        guard let s = state.seats["\(i)"] else { return "Seat \(i)" }
        if s.str("uid") == me { return "You (seat \(i))" }
        return "\(s.str("name") ?? "Seat \(i)") (seat \(i))"
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
        guard state.wallet != nil else { return }
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

    private func reactSession(_ ss: Session) {
        guard let gid, let fvk = state.wallet?.str("orchard_fvk"), !has(ss.doc["error"]),
              let package = ss.doc.str("package") else { return }
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
        guard parts.count == 2, parts[1].count == 43 else { banner = "The key in this link is not valid."; return }
        vault.putKey(parts[0], parts[1])
        autoSeat = true
        path = [parts[0]]
        select(parts[0])
        note("joined group \(parts[0].prefix(8))…")
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

    func inspect(_ ss: Session) -> Result<Doc, ZigsError> {
        do {
            return .success(try Engine.object("inspect", [ss.doc.str("pczt") ?? "", state.wallet?.str("orchard_fvk") ?? ""]))
        } catch {
            return .failure(ZigsError(error.localizedDescription))
        }
    }

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
            self.note("seat \(i): approved the spend")
        }
    }

    func canProve(_ ss: Session) -> Bool {
        let stalled = now() - (ss.doc.int("provingAt") ?? 0) > 180_000
        return has(ss.doc["signed"]) && !has(ss.doc["final"]) && (ss.status != "proving" || stalled)
            && !proving.contains(ss.id)
    }

    /// Builds the Halo2 proof natively and checks the whole transaction.
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
            } catch {
                try await self.patch(path, ["broadcastError": error.localizedDescription])
                throw error
            }
        }
    }
}

func now() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
