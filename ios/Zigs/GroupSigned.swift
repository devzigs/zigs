import Foundation

/// Signed writes in the model (PROTOCOL.md section 15): which wallets are signed, the pinned
/// keys, and the seat that writes. The rules for the documents are in Signed.swift.
extension GroupModel {
    /// A wallet is signed when this device holds a seat of version 3, or first saw it as version 3.
    /// A later lower version in the store does not turn the checks off.
    func signedMode(_ gid: String) -> Bool {
        vault.seats(in: gid).contains { vault.sec(gid, $0).int("version") == 3 }
            || signPins["version:" + gid] == "3"
    }

    var isSigned: Bool { gid.map(signedMode) ?? false }

    func pinVersion(_ gid: String, _ g: Doc?) {
        guard let g else { return }
        let version = GroupState.version(of: g)
        if version > 0 { signPins.pin("version:" + gid, String(version)) }
    }

    /// The group document of a signed wallet with the number of signers (n) and the rule (t) that
    /// this device saw first. The group document has no signature, so a later value in the store
    /// never counts. `shapeMoved` is true when the store shows other values.
    func trusted(_ gid: String, _ g: Doc) -> Doc {
        guard signedMode(gid) else { return g }
        let key = "shape:" + gid
        if let shape = Signed.shape(g) { signPins.pin(key, shape) }
        guard let pinned = signPins[key].flatMap(Signed.parseShape) else { return g }
        var out = g
        out["shapeMoved"] = Signed.shape(g) != "\(pinned.n)/\(pinned.t)"
        out["n"] = pinned.n
        out["t"] = pinned.t
        return out
    }

    /// Pins the first signing key of each seat of 1 to `n`. A seat document counts only when it
    /// carries a signature of the key that it names, so a made-up document pins nothing. A key
    /// that this device made itself is pinned only after the seat document shows it.
    func pinSeats(_ gid: String, n: Int, _ seats: [String: Doc]) {
        for i in Signed.seatRange(n) where signPins["\(gid):\(i)"] == nil {
            guard let doc = seats["\(i)"], let pk = doc.str("signPk"), Signed.validPk(pk) else {
                continue
            }
            let own = SignedReader(gid: gid, n: n, pins: [i: pk], memo: signMemo)
            if own.accepts("seats/\(i)", by: doc["by"], sig: doc["sig"],
                           fields: Signed.docFields(doc), need: i) {
                signPins.pin("\(gid):\(i)", pk)
            }
        }
    }

    func reader(_ gid: String, n: Int) -> SignedReader {
        let seats = Signed.seatRange(n)
        let pins = seats.reduce(into: [Int: String]()) { $0[$1] = signPins["\(gid):\($1)"] }
        return SignedReader(gid: gid, n: seats.count, pins: pins, memo: signMemo)
    }

    /// May this device write as seat `i`? Always before version 3. After, the seat needs the
    /// signing key that readers pinned (the key in the seat document only while nothing is pinned).
    func canWriteAs(_ i: Int, in gid: String) -> Bool {
        guard signedMode(gid) else { return true }
        let s = vault.sec(gid, i)
        guard s.str("signSk") != nil, let mine = s.str("signPk") else { return false }
        let shown = gid == self.gid ? state.seats["\(i)"]?.str("signPk") : nil
        return mine == (signPins["\(gid):\(i)"] ?? shown)
    }

    /// The seat of this device that signs a write that has no seat of its own: `prefer` if this
    /// device can sign for it, else another seat. nil before version 3, or when no seat can sign.
    func writer(in gid: String, prefer: Int? = nil) -> Int? {
        guard signedMode(gid) else { return nil }
        let held = gid == self.gid ? localSeats : vault.seats(in: gid)
        let own = held.filter { canWriteAs($0, in: gid) }
        return prefer.flatMap { own.contains($0) ? $0 : nil } ?? own.first
    }

    /// Seats of this device that hold a secret but no signing key that the wallet accepts.
    var mutedSeats: [Int] {
        guard let gid, signedMode(gid) else { return [] }
        return localSeats.filter { !canWriteAs($0, in: gid) }
    }

    /// May this device change the open wallet? Always before version 3. After, it needs a seat
    /// that can sign: the proof, the sent mark and the signed PCZT are signed parts.
    var canAct: Bool {
        guard let gid else { return false }
        return !signedMode(gid) || writer(in: gid) != nil
    }

    /// `fields` with the writer and the signature of seat `seat`. Before version 3, `fields` as
    /// they are.
    func signed(_ gid: String, _ rel: String, as seat: Int, _ fields: Doc) throws -> Doc {
        guard signedMode(gid) else { return fields }
        guard canWriteAs(seat, in: gid) else { throw ZigsError(Signed.noSeatKey) }
        let signer = Signed.Signer(seat: seat, signSk: vault.sec(gid, seat).str("signSk"))
        return try Signed.signDoc(gid, rel, as: signer, fields)
    }

    /// `fields` of a payment with the signature of `part`, written by `prefer` or another seat.
    func partSigned(_ gid: String, _ sid: String, _ part: Signed.Part, _ fields: Doc,
                    prefer: Int? = nil) throws -> Doc {
        guard signedMode(gid) else { return fields }
        guard let seat = writer(in: gid, prefer: prefer) else { throw ZigsError(Signed.noSeatKey) }
        let signer = Signed.Signer(seat: seat, signSk: vault.sec(gid, seat).str("signSk"))
        return try Signed.signPart(gid, sid, part, as: signer, fields)
    }

    /// Logs a document that the reader ignored, once each time its wallet opens. The key is the
    /// path, never the signature, and a wallet logs at most 200 paths.
    func logIgnored(_ gid: String, _ paths: [String]) {
        let prefix = gid + "|"
        var used = signLogged.filter { $0.hasPrefix(prefix) }.count
        for path in paths where used < 200 {
            let shown = String(path.prefix(120))
            guard signLogged.insert(prefix + shown).inserted else { continue }
            used += 1
            note("ignored data without a valid signature (wallet \(gid.prefix(6))): \(shown)")
        }
    }

    /// How many ignored documents the wallet page reports: those of the wallet and its payments,
    /// and the approvals and shares of the open payment (the web app loads only those).
    var ignoredCount: Int {
        state.ignoredPaths.filter { path in
            guard let sid = Signed.sessionOfPart(path) else { return true }
            return sid == openPayment
        }.count
    }
}
