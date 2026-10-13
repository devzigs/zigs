import CryptoKit
import Foundation

/// Signed writes of version 3 wallets (PROTOCOL.md section 15). The same rules as web/signed.js.
/// The engine builds the signed text (docPayload), so the web and the iPhone sign the same bytes.
enum Signed {
    static let ignoredNote = "Some data in this wallet was not signed by a signer. Zigs ignored it."
    static let noSeatKey = "This \(deviceName) has no signing key for a seat of this wallet, "
        + "so it cannot write to this wallet."
    /// The fields of the signature of a document that a seat signs as a whole.
    static let whole = (by: "by", sig: "sig")

    /// The seat that writes, and the secret key it signs with.
    struct Signer {
        let seat: Int
        let signSk: String?
    }

    // MARK: Keys

    /// A new Ed25519 key in the format of the web app: the secret as base64 PKCS #8, the public key
    /// as lowercase hex.
    static func newKey() -> (signSk: String, signPk: String) {
        let key = Curve25519.Signing.PrivateKey()
        return ((KeyPairs.pkcs8Prefix + key.rawRepresentation).base64EncodedString(),
                KeyPairs.hex(key.publicKey.rawRepresentation))
    }

    static func validPk(_ pk: String) -> Bool {
        pk.utf8.count == 64
            && pk.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }

    /// The signature of `text` as base64.
    static func sign(_ signSk: String?, _ text: String) throws -> String {
        guard let key = KeyPairs.signingKey(signSk) else { throw ZigsError(noSeatKey) }
        return try key.signature(for: Data(text.utf8)).base64EncodedString()
    }

    /// `fields` as JSON text with sorted keys, so equal documents give equal text.
    static func sortedJson(_ fields: Doc) -> String {
        let opts: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? JSONSerialization.data(withJSONObject: fields, options: opts) else {
            return "{}"
        }
        return String(decoding: data, as: UTF8.self)
    }

    /// `fields` with the writer and the signature of `signer`, over the engine's text for `rel`,
    /// a path below the wallet. `pair` names the two fields.
    static func signDoc(_ gid: String, _ rel: String, as signer: Signer, _ fields: Doc,
                        pair: (by: String, sig: String) = whole) throws -> Doc {
        let text = try Engine.call("docPayload", [gid, rel, signer.seat, sortedJson(fields)])
        var out = fields
        out[pair.by] = signer.seat
        out[pair.sig] = try sign(signer.signSk, text)
        return out
    }

    /// `fields` of a payment with the signature of `part`. The signature covers only the fields
    /// that the part names. A field that the part does not name would stay unsigned, so it is an
    /// error, as on the web. The status and the progress marks go in apart.
    static func signPart(_ gid: String, _ sid: String, _ part: Part, as signer: Signer,
                         _ fields: Doc) throws -> Doc {
        let extra = Set(fields.keys).subtracting(part.fields).subtracting(part.spec.fixed.keys)
        guard extra.isEmpty else {
            let names = extra.sorted().joined(separator: ", ")
            throw ZigsError("Unsigned field in the part \(part): \(names)")
        }
        let signedDoc = try signDoc(gid, "sessions/" + sid, as: signer, part.signedFields(fields),
                                    pair: part.pair)
        return fields.merging(signedDoc) { $1 }
    }

    /// False for a wrong key, a changed text, or a malformed key or signature.
    static func verify(_ signPk: String, _ sig: String, _ text: String) -> Bool {
        guard validPk(signPk), let raw = KeyPairs.unhex(signPk),
              let signature = Data(base64Encoded: sig),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw)
        else { return false }
        return key.isValidSignature(signature, for: Data(text.utf8))
    }

    // MARK: Who wrote a document

    private static func seatNumber<S: StringProtocol>(_ s: S) -> Int? {
        let digits = s.utf8
        guard (1...2).contains(digits.count), digits.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              digits.first != 48 else { return nil }
        return Int(s)
    }

    /// The bytes of a session id: letters, digits, underscore and hyphen.
    static let idBytes = Set(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".utf8)

    static func isSessionId(_ s: Substring) -> Bool {
        (1...64).contains(s.utf8.count) && s.utf8.allSatisfy(idBytes.contains)
    }

    private static let wholeDirs: Set<Substring> = [
        "seats", "confirm", "abort", "dkg1", "done", "verify",
    ]
    private static let sessionDirs: Set<Substring> = ["commits", "shares"]

    /// The seat that must have written the document at `rel`, a path below the wallet: the seat in
    /// its name, or seat 1 (the creator) for the wallet document. nil: `rel` is no such document.
    static func writerOf(_ rel: String) -> Int? {
        if rel == "meta/wallet" { return 1 }
        let p = rel.split(separator: "/", omittingEmptySubsequences: false)
        switch p.count {
        case 2 where wholeDirs.contains(p[0]): return seatNumber(p[1])
        case 2 where p[0] == "dkg2": return pairWriter(p[1])
        case 4 where p[0] == "sessions" && isSessionId(p[1]) && sessionDirs.contains(p[2]):
            return seatNumber(p[3])
        default: return nil
        }
    }

    /// The session id of a path such as `sessions/<id>/commits/<i>` or `sessions/<id>/shares/<i>`,
    /// or nil for any other path.
    static func sessionOfPart(_ path: String) -> String? {
        let p = path.split(separator: "/", omittingEmptySubsequences: false)
        guard p.count == 4, p[0] == "sessions", sessionDirs.contains(p[2]) else { return nil }
        return String(p[1])
    }

    /// The sender of `dkg2/<i>-<j>`.
    private static func pairWriter(_ name: Substring) -> Int? {
        let ends = name.split(separator: "-", omittingEmptySubsequences: false)
        guard ends.count == 2, seatNumber(ends[1]) != nil else { return nil }
        return seatNumber(ends[0])
    }

    /// The signed fields of a document that a seat signs as a whole: all but the signature.
    static func docFields(_ d: Doc) -> Doc { d.filter { $0.key != "by" && $0.key != "sig" } }

    /// The seats of a wallet with `n` signers: 1 to `n`. A wallet has 2 to 7, so any other `n`
    /// has none.
    static func seatRange(_ n: Int) -> [Int] {
        n >= 2 && n <= BackupText.seatMax ? Array(1...n) : []
    }

    /// The seat in a `by` field, or nil when it is no seat of 1 to `n` or not the seat `need`.
    static func writer(_ by: Any?, need: Int?, n: Int) -> Int? {
        guard let seat = BackupData.integer(by), seat >= 1, seat <= n else { return nil }
        return need == nil || need == seat ? seat : nil
    }

    // MARK: Shape of a wallet

    /// A wallet has 2 to 7 signers, and a rule of at least 2 and at most all of them.
    static func validShape(_ n: Int, _ t: Int) -> Bool {
        (2...BackupText.seatMax).contains(n) && (2...n).contains(t)
    }

    /// "n/t" for a group document with a valid shape, or nil.
    static func shape(_ g: Doc) -> String? {
        guard let n = BackupData.integer(g["n"]), let t = BackupData.integer(g["t"]),
              validShape(n, t) else { return nil }
        return "\(n)/\(t)"
    }

    /// The number of signers and the rule that a pin holds ("n/t"), or nil.
    static func parseShape(_ pin: String) -> (n: Int, t: Int)? {
        let parts = pin.split(separator: "/").compactMap { Int($0) }
        guard parts.count == 2, validShape(parts[0], parts[1]) else { return nil }
        return (parts[0], parts[1])
    }

    // MARK: Session documents

    /// A session document has several writers. Each part has its own writer and signature over
    /// only its own fields. The status and the progress marks are not signed. The signed PCZT,
    /// the proof and the sent transaction are signed by the seat that made them, and each needs
    /// the part before it.
    enum Part: CaseIterable {
        case proposal, package, signed, final, sent, cancel, failure

        struct Spec: Sendable {
            let by: String
            let sig: String
            let fields: [String]
            var fixed: [String: String] = [:]
            var needs: Part?
        }

        static let specs: [Part: Spec] = [
            .proposal: Spec(by: "by", sig: "sig", fields: [
                "payees", "note", "pool", "amount", "change", "fee", "noteValue", "pczt", "move",
                "createdAt",
            ]),
            .package: Spec(by: "packageBy", sig: "packageSig", fields: ["package", "signers"]),
            .signed: Spec(by: "signedBy", sig: "signedSig", fields: ["signed", "signatures"],
                          needs: .package),
            .final: Spec(by: "finalBy", sig: "finalSig", fields: ["final"], needs: .signed),
            .sent: Spec(by: "sentBy", sig: "sentSig", fields: ["broadcastTxid", "broadcastAt"],
                        needs: .final),
            .cancel: Spec(by: "cancelBy", sig: "cancelSig", fields: ["error"],
                          fixed: ["status": "cancelled"]),
            .failure: Spec(by: "errorBy", sig: "errorSig", fields: ["error"]),
        ]

        var spec: Spec { Self.specs[self] ?? Spec(by: "", sig: "", fields: []) }
        /// The fields that hold the writer and the signature of this part.
        var pair: (by: String, sig: String) { (spec.by, spec.sig) }
        var by: String { spec.by }
        var sig: String { spec.sig }
        var fields: [String] { spec.fields }
        /// The part that this one builds on.
        var needs: Part? { spec.needs }

        /// A part is there when the document holds any of its fields, its writer or its signature.
        /// A lone `error` belongs to a cancel when the cancel has a writer, else to a failure.
        func present(in d: Doc) -> Bool {
            let holds = { (keys: [String]) in keys.contains { d[$0] != nil } }
            switch self {
            case .proposal: return true
            case .cancel: return holds([by, sig])
            case .failure: return holds([by, sig]) || (holds(fields) && !Part.cancel.present(in: d))
            default: return holds(fields + [by, sig])
            }
        }

        /// The fields that this part signs, as the document holds them now.
        func signedFields(_ d: Doc) -> Doc {
            var out = Doc(uniqueKeysWithValues: spec.fixed.map { ($0.key, $0.value as Any) })
            for k in fields { if let v = d[k] { out[k] = v } }
            return out
        }

        fileprivate func drop(from d: inout Doc) {
            for k in fields + [by, sig] { d[k] = nil }
        }
    }

    /// The state of a payment follows from its verified parts. The stored `status` counts only
    /// for "proving", a progress mark with no signature.
    private static let stateOf: [(Part, String)] = [
        (.cancel, "cancelled"), (.failure, "failed"), (.sent, "broadcast"), (.final, "complete"),
    ]

    private static func statusOf(stored: String?, _ ok: Set<Part>) -> String {
        if let hit = stateOf.first(where: { ok.contains($0.0) }) { return hit.1 }
        if ok.contains(.signed) { return stored == "proving" ? "proving" : "signed" }
        return ok.contains(.package) ? "signing" : "collecting"
    }

    private static func build(_ d: Doc, _ ok: Set<Part>) -> Doc {
        var ss = d
        for part in Part.allCases where part != .proposal && !ok.contains(part) {
            part.drop(from: &ss)
        }
        if ok.contains(.cancel) || ok.contains(.failure) { ss["error"] = d["error"] }
        ss["status"] = statusOf(stored: d.str("status"), ok)
        return ss
    }

    /// A sent mark must name the txid of the final transaction.
    private static func sentMatches(_ d: Doc) -> Bool {
        d.str("broadcastTxid") != nil && d.doc("final")?.str("txid") == d.str("broadcastTxid")
    }

    private static func partHolds(_ part: Part, _ id: String, _ d: Doc, _ r: SignedReader,
                                  _ ok: Set<Part>) -> Bool {
        if let need = part.needs, !ok.contains(need) { return false }
        if part == .sent && !sentMatches(d) { return false }
        return r.accepts("sessions/" + id, by: d[part.by], sig: d[part.sig],
                         fields: part.signedFields(d), need: nil)
    }

    /// Reads a session document. A session with no valid proposal is dropped (`doc` nil). Another
    /// part that is not valid is taken out of it. `bad` names the parts that failed.
    static func readSession(_ id: String, _ d: Doc, _ r: SignedReader) -> (doc: Doc?, bad: [Part]) {
        var ok = Set<Part>(), bad: [Part] = []
        for part in Part.allCases where part.present(in: d) {
            if partHolds(part, id, d, r, ok) { ok.insert(part) } else { bad.append(part) }
            if part == .proposal && !ok.contains(.proposal) { return (nil, bad) }
        }
        return (build(d, ok), bad)
    }

    /// The documents of `docs` ("prefix" + id is the path) that verify, without their signature
    /// fields. The paths of the others go to `bad`.
    static func keepWhole(_ docs: [String: Doc], _ prefix: String, _ r: SignedReader,
                          _ bad: inout [String]) -> [String: Doc] {
        var out: [String: Doc] = [:]
        for (id, d) in docs {
            let rel = prefix + id
            if let need = writerOf(rel),
               r.accepts(rel, by: d["by"], sig: d["sig"], fields: docFields(d), need: need) {
                out[id] = docFields(d)
            } else {
                bad.append(rel)
            }
        }
        return out
    }
}

/// A bounded memo of signature checks. An entry answers only for the same signed text and the same
/// key, so a text of the same length is a new check. Past `maxEntries` or `maxChars` of kept text
/// the memo drops its oldest entries first.
/// ponytail: a store with more than `maxChars` of signed documents makes the app check some of
/// them again on every refresh. Upgrade path: keep a SHA-256 digest of the text, not the text.
final class SignedMemo {
    private struct Entry {
        let fields: String
        let pk: String
        let ok: Bool
    }

    private var entries: [String: Entry] = [:]
    /// The keys of `entries`, the oldest first.
    private var order: [String] = []
    private var chars = 0
    private let maxEntries: Int
    private let maxChars: Int

    init(maxEntries: Int = 4000, maxChars: Int = 32_000_000) {
        self.maxEntries = maxEntries
        self.maxChars = maxChars
    }

    var count: Int { entries.count }

    /// The answer for the document `key` with the signed text `fields` and the key `pk`. `check`
    /// runs when the memo does not hold this exact input.
    func verdict(_ key: String, _ fields: String, _ pk: String, _ check: () -> Bool) -> Bool {
        if let old = entries[key] {
            if old.fields == fields && old.pk == pk { return old.ok }
            chars -= old.fields.utf8.count
        } else {
            order.append(key)
        }
        let ok = check()
        entries[key] = Entry(fields: fields, pk: pk, ok: ok)
        chars += fields.utf8.count
        trim()
        return ok
    }

    private func trim() {
        while entries.count > maxEntries || chars > maxChars, entries.count > 1 {
            let oldest = order.removeFirst()
            if let gone = entries.removeValue(forKey: oldest) { chars -= gone.fields.utf8.count }
        }
    }
}

/// What a reader knows to check a signature in one wallet: the number of seats and the pinned
/// signing key of each seat.
struct SignedReader {
    /// The longest signature that is read: an Ed25519 signature is 88 characters in base64.
    static let sigMax = 128

    let gid: String
    let n: Int
    let pins: [Int: String]
    var memo = SignedMemo()
    var verify: (String, String, String) -> Bool = Signed.verify

    /// True when `by` names a seat of the wallet (the seat `need`, when given), and `sig` is the
    /// signature of that seat's pinned key over the engine's text for `fields`. A memo keeps the
    /// answer for the same text, so a refresh does not check a payment that did not change.
    func accepts(_ rel: String, by: Any?, sig: Any?, fields: Doc, need: Int?) -> Bool {
        guard let seat = Signed.writer(by, need: need, n: n), let pk = pins[seat],
              Signed.validPk(pk), let sig = sig as? String, sig.utf8.count <= Self.sigMax
        else { return false }
        let text = Signed.sortedJson(fields)
        return memo.verdict("\(gid)|\(rel)|\(seat)|\(sig)", text, pk) {
            guard let signed = try? Engine.call("docPayload", [gid, rel, seat, text]) else {
                return false
            }
            return verify(pk, sig, signed)
        }
    }

    /// The wallet document without its signature, or nil. Seat 1 (the creator) writes it.
    func wallet(_ w: Doc) -> Doc? {
        accepts("meta/wallet", by: w["by"], sig: w["sig"], fields: Signed.docFields(w), need: 1)
            ? Signed.docFields(w) : nil
    }
}

extension GroupState {
    /// Keeps only the documents with a valid signature of the right seat, and the valid parts of
    /// each session. A proposal gets its proposer from the seat in `by`, never from a field.
    /// Returns the paths of what it ignored.
    mutating func keepSigned(_ r: SignedReader) -> [String] {
        var bad: [String] = []
        seats = Signed.keepWhole(seats, "seats/", r, &bad)
        dkg1 = Signed.keepWhole(dkg1, "dkg1/", r, &bad)
        dkg2 = Signed.keepWhole(dkg2, "dkg2/", r, &bad)
        confirm = Signed.keepWhole(confirm, "confirm/", r, &bad)
        abort = Signed.keepWhole(abort, "abort/", r, &bad)
        done = Signed.keepWhole(done, "done/", r, &bad)
        verify = Signed.keepWhole(verify, "verify/", r, &bad)
        if let w = wallet {
            wallet = r.wallet(w)
            if wallet == nil { bad.append("meta/wallet") }
        }
        sessions = sessions.compactMap { keepSession($0, r, &bad) }
        let kept = Set(sessions.map(\.id))
        commits = commits.filter { kept.contains($0.key) }
        shares = shares.filter { kept.contains($0.key) }
        for id in kept {
            commits[id] = Signed.keepWhole(commits[id] ?? [:], "sessions/\(id)/commits/", r, &bad)
            shares[id] = Signed.keepWhole(shares[id] ?? [:], "sessions/\(id)/shares/", r, &bad)
        }
        return bad
    }

    private func keepSession(_ s: Session, _ r: SignedReader, _ bad: inout [String]) -> Session? {
        let read = Signed.readSession(s.id, s.doc, r)
        bad += read.bad.map { "sessions/\(s.id) \($0)" }
        guard var doc = read.doc else { return nil }
        let proposer = Signed.writer(doc["by"], need: nil, n: n)
        doc["createdBy"] = proposer.flatMap { seats["\($0)"]?.str("uid") }
        return Session(id: s.id, doc: doc)
    }
}

/// The first value that this device saw for a name. A later value is never trusted. The signing
/// pins hold each seat signing key ("wallet id:seat"), each wallet version ("version:wallet id")
/// and each wallet shape ("shape:wallet id", as "n/t"). Messages have pins of their own: the room
/// of each wallet, and the signing key of each member of a chat ("chat id:member id").
@MainActor
final class Pins {
    private let name: String
    private(set) var all: [String: String]

    init(_ name: String) {
        self.name = name
        all = UserDefaults.standard.dictionary(forKey: name) as? [String: String] ?? [:]
    }

    subscript(key: String) -> String? { all[key] }

    /// Keeps `value` when the key has none yet.
    @discardableResult
    func pin(_ key: String, _ value: String) -> Chat.PinResult {
        change { Chat.pin(&$0, key, value) }
    }

    /// Runs a rule on the pins and saves them when it added one.
    @discardableResult
    func change(_ rule: (inout [String: String]) -> Chat.PinResult) -> Chat.PinResult {
        let result = rule(&all)
        if result == .new { UserDefaults.standard.set(all, forKey: name) }
        return result
    }

    /// Removes every pin whose key starts with `prefix`.
    func forget(prefix: String) {
        all = all.filter { !$0.key.hasPrefix(prefix) }
        UserDefaults.standard.set(all, forKey: name)
    }
}
