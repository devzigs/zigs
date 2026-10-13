import CryptoKit
import SwiftUI
import UniformTypeIdentifiers

/// Encrypted key share backups. The engine seals and opens the file (backupSeal, backupOpen). The
/// text inside is the JSON that the web app writes, so a backup from either app opens in both.
/// The format is in PROTOCOL.md, section 9.
enum BackupText {
    static let kind = "zec-frost-key-share"
    static let sealedKind = "zigs-backup"
    static let note = "This passphrase opens your key share. Zigs cannot recover it. "
        + "Write it down and keep it apart from the file."
    static let notABackup = "This file is not a Zigs backup."
    static let noKeyShare = "This backup holds no key share."
    static let notEncrypted = "This backup file is not encrypted. Make a new encrypted backup now."
    static let noFit = "This backup does not fit this wallet. It was not used."
    static let restorePending = "A restore of this seat is still being checked. "
        + "Open the wallet and wait, then try again."
    static let counts = "It counts as your seat once it matches the wallet."
    static let setupHeld = "This seat is still being set up on this device. Finish setup, or "
        + "remove the seat first."
    static let staleRestore = "This restored seat does not match the wallet, so this device does not use it. "
        + "Remove it from this device, then restore the right backup."
    static let maxBytes = 1_000_000
    static let seatMax = 7
    /// The fields of a seat secret that a restore takes from a file. The others (wallet checks,
    /// aborts, setup state) are claims of whoever made the file, so this device makes its own.
    /// A restore never takes `uid` or `nonces` either. Same list as RESTORE_FIELDS in util.js.
    static let restoreFields: Set<String> = [
        "keyPackage", "publicKeyPackage", "groupKey", "vaultSk", "boxSk", "boxPk", "signSk",
        "signPk", "version", "room",
    ]
    /// The key pairs among the restore fields. A restore takes none of them from a file at once
    /// (see KeyPairs). Same list as KEY_PAIRS in util.js.
    static let keyFields: Set<String> = ["boxSk", "boxPk", "signSk", "signPk"]
    /// The version and the room of a file. A restore holds them back until the seat fits the
    /// wallet (see BackupData.settled). Same list as LATE_FIELDS in util.js.
    static let lateFields: Set<String> = ["version", "room"]
}

/// A seat has two key pairs: X25519 (DKG boxes) and Ed25519 (messages). A file's pair joins the
/// seat only when its secret key makes the public key that the seat published. Same rule as
/// takenKeys in util.js.
enum KeyPairs {
    struct Pair {
        let sk: String
        let pk: String
        /// An Ed25519 pair for messages. The other one is the X25519 pair for DKG boxes.
        let signing: Bool
    }

    static let all = [
        Pair(sk: "boxSk", pk: "boxPk", signing: false),
        Pair(sk: "signSk", pk: "signPk", signing: true),
    ]

    /// The key fields to add: the secret key of `file` and the published public key. A pair that
    /// the seat holds already wins.
    static func taken(file: Doc, held: Doc, published: Doc) -> Doc {
        var out = Doc()
        for p in all where !has(held[p.sk]) && !has(held[p.pk]) {
            guard let pk = published.str(p.pk), makes(p, file.str(p.sk), pk) else { continue }
            out[p.sk] = file[p.sk]
            out[p.pk] = pk
        }
        return out
    }

    private static func makes(_ p: Pair, _ sk: String?, _ pk: String) -> Bool {
        p.signing ? signMatches(sk, pk) : boxMatches(sk, pk)
    }

    static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

    private static func unhex(_ s: String) -> Data? {
        guard s.count % 2 == 0, s.allSatisfy(\.isHexDigit) else { return nil }
        let bytes = stride(from: 0, to: s.count, by: 2).compactMap { n -> UInt8? in
            let a = s.index(s.startIndex, offsetBy: n)
            return UInt8(s[a..<s.index(a, offsetBy: 2)], radix: 16)
        }
        return Data(bytes)
    }

    /// True when the X25519 secret key (hex) makes the public key (hex).
    static func boxMatches(_ sk: String?, _ pk: String) -> Bool {
        guard let sk, let raw = unhex(sk),
              let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw) else {
            return false
        }
        return hex(key.publicKey.rawRepresentation) == pk
    }

    /// The first bytes of an Ed25519 key in PKCS #8, as the web app saves it (base64). The last
    /// 32 of its 48 bytes are the seed.
    private static let pkcs8Prefix = unhex("302e020100300506032b657004220420")

    /// True when the Ed25519 secret key (base64 PKCS #8) makes the public key (hex).
    static func signMatches(_ sk: String?, _ pk: String) -> Bool {
        guard let sk, let der = Data(base64Encoded: sk), der.count == 48,
              der.prefix(16) == pkcs8Prefix,
              let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: der.suffix(32)) else {
            return false
        }
        return hex(key.publicKey.rawRepresentation) == pk
    }
}

extension UTType {
    static let zigsBackup = UTType(exportedAs: "app.zigs.backup", conformingTo: .data)
}

/// The rules for a backup passphrase. Same rules as util.js in the web app. A passphrase is
/// normalized to Unicode NFC, counted in Unicode scalar values and never trimmed, so one
/// passphrase gives the same key in both apps, whatever keyboard typed it.
enum Passphrase {
    static let minLength = 16
    static let minDifferent = 8
    private static let symbols = Array("0123456789abcdefghjkmnpqrstvwxyz")

    static func normalized(_ s: String) -> String { s.precomposedStringWithCanonicalMapping }

    static func length(_ s: String) -> Int { s.unicodeScalars.count }

    /// Why the passphrase cannot be used yet, as one sentence, or nil when it can. The comparison
    /// is by scalar after the normalization.
    static func issue(_ pass: String, _ again: String) -> String? {
        let a = normalized(pass)
        let n = length(a), different = Set(a.unicodeScalars).count
        if n < minLength { return "Use at least \(minLength) characters (\(n) so far)." }
        if different < minDifferent {
            return "Use at least \(minDifferent) different characters (\(different) so far), "
                + "or choose Make a passphrase for me."
        }
        if again.isEmpty { return "Type or paste the passphrase again to confirm it." }
        let same = a.unicodeScalars.elementsEqual(normalized(again).unicodeScalars)
        return same ? nil : "The two passphrases are not the same."
    }

    /// 30 random bytes give 30 symbols of 5 bits (150 bits), shown as 6 groups of 5.
    static func made() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 30)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw ZigsError("This \(deviceName) could not make a random value.")
        }
        return from(bytes)
    }

    static func from(_ bytes: [UInt8]) -> String {
        let s = bytes.map { symbols[Int($0 & 31)] }
        return stride(from: 0, to: s.count, by: 5).map { String(s[$0..<min($0 + 5, s.count)]) }
            .joined(separator: "-")
    }
}

/// "zigs-<wallet>-seat-<i>.zigsbackup", with any run of other characters in the name as one "-".
func backupFileName(wallet: String, seat: Int) -> String {
    let name = wallet.replacing(/[^A-Za-z0-9_]+/, with: "-")
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return "zigs-\(name.isEmpty ? "wallet" : name)-seat-\(seat).zigsbackup"
}

/// The file that the exporter writes: the sealed text, as UTF-8.
struct BackupDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.zigsBackup]
    var text: String

    init(text: String) { self.text = text }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = String(decoding: data, as: UTF8.self)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

/// Reads a picked file as text. It reads one byte more than the limit, whatever size the file
/// provider reports, so a wrong file cannot fill the memory.
func readBackupFile(_ url: URL) throws -> String {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    guard let data = try handle.read(upToCount: BackupText.maxBytes + 1),
          data.count <= BackupText.maxBytes,
          let text = String(data: data, encoding: .utf8) else {
        throw ZigsError(BackupText.notABackup)
    }
    return text
}

/// A backup that passed the checks of `init`.
struct BackupData {
    let group: String
    let seat: Int
    let key: String?
    let secret: Doc
    let keyPackage: Doc
    let name: String
    /// The key pairs of the file. They wait for the seat's published keys (see KeyPairs).
    let keys: Doc

    /// A whole number that is not a JSON boolean.
    private static func integer(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              n.doubleValue == n.doubleValue.rounded() else { return nil }
        return n.intValue
    }

    static func parse(_ text: String) throws -> Doc {
        guard let b = (try? Engine.parse(text)) as? Doc else {
            throw ZigsError(BackupText.notABackup)
        }
        return b
    }

    private static func isGroupId(_ s: String) -> Bool { s.wholeMatch(of: /[0-9a-f]{20}/) != nil }

    /// The wallet secret. A backup without one is allowed; a wrong one is not.
    private static func walletSecret(_ v: Any?) throws -> String? {
        guard let v else { return nil }
        guard let key = v as? String, key.wholeMatch(of: /[A-Za-z0-9_-]{43}/) != nil else {
            throw ZigsError(BackupText.notABackup)
        }
        return key
    }

    /// A key package names its share by identifier and verifying share.
    static func share(_ kp: Doc?) -> (String, String)? {
        guard let id = kp?.str("identifier"), let verifying = kp?.str("verifying_share") else {
            return nil
        }
        return (id, verifying)
    }

    /// True when both key packages name the same share.
    static func sameShare(_ a: Doc?, _ b: Doc?) -> Bool {
        guard let x = share(a), let y = share(b) else { return false }
        return x == y
    }

    /// Why the seat secret `held` blocks a restore of the key share `file` for `seat`, or nil. A
    /// seat in setup holds secrets but no key share. A restore would take its data from the file
    /// at once. Same rule as heldRefusal in util.js.
    static func heldRefusal(_ held: Doc?, file: Doc, seat: Int) -> String? {
        guard let held else { return nil }
        guard share(held.doc("keyPackage")) != nil else { return BackupText.setupHeld }
        guard !sameShare(held.doc("keyPackage"), file) else { return nil }
        return "This \(deviceName) holds another key share for seat \(seat) of this wallet, so "
            + "the backup was not restored."
    }

    /// A restored seat secret that the wallet does not confirm (`fit` is false), and that no
    /// restore that waits will settle. It is no seat of this device (SeatOwner). Same rule as
    /// staleRestore in util.js.
    static func staleRestore(_ held: Doc?, waiting: Bool, fit: @autoclosure () -> Bool?) -> Bool {
        guard let held, has(held["restored"]), !waiting else { return false }
        return fit() == false
    }

    /// The wallet id and the seat number.
    private static func seatRef(_ b: Doc) throws -> (group: String, seat: Int) {
        guard let group = b.str("group"), isGroupId(group), let seat = integer(b["seat"]),
              (1...BackupText.seatMax).contains(seat) else {
            throw ZigsError(BackupText.notABackup)
        }
        return (group, seat)
    }

    private static func walletName(_ b: Doc) -> String {
        guard let name = b.str("groupName"), !name.isEmpty else { return "wallet" }
        return name
    }

    init(_ b: Doc) throws {
        guard b.str("kind") == BackupText.kind, let secret = b.doc("secret") else {
            throw ZigsError(BackupText.notABackup)
        }
        let ref = try Self.seatRef(b)
        guard let keyPackage = secret.doc("keyPackage"), Self.share(keyPackage) != nil else {
            throw ZigsError(BackupText.noKeyShare)
        }
        self.group = ref.group
        self.seat = ref.seat
        self.key = try Self.walletSecret(b["key"])
        self.secret = secret
        self.keyPackage = keyPackage
        self.name = Self.walletName(b)
        self.keys = secret.filter { BackupText.keyFields.contains($0.key) }
    }

    /// The part of the seat secret that a restore takes from the file now: the allowed fields
    /// without the key pairs, the version and the room.
    var restoredFields: Doc {
        secret.filter {
            BackupText.restoreFields.contains($0.key) && !BackupText.keyFields.contains($0.key)
                && !BackupText.lateFields.contains($0.key)
        }
    }

    /// What a restore stores now. A device that holds a key share for the seat takes no field of
    /// the file: it keeps what it holds, and a copied share (identifier and verifying share)
    /// cannot add other secret values. Same rule as restoredSecret in util.js.
    func restoredSecret(over held: Doc) -> Doc {
        guard Self.share(held.doc("keyPackage")) != nil else { return restoredFields }
        return held.filter { BackupText.restoreFields.contains($0.key) }
    }

    /// The fields of the file that a restore holds back until the seat fits the wallet. Same rule
    /// as lateFields in util.js.
    func lateFields(over held: Doc) -> Doc {
        guard Self.share(held.doc("keyPackage")) == nil else { return [:] }
        return secret.filter { BackupText.lateFields.contains($0.key) }
    }

    /// What to store of the late fields once the seat fits. A field of the file counts only when
    /// it equals the wallet's own value (the version of the wallet document, its room). The stored
    /// value is the wallet's. Same rule as settledFields in util.js.
    static func settled(_ late: Doc, version: Int, room: Doc?) -> Doc {
        var out = Doc()
        if [1, 2].contains(version), integer(late["version"]) == version {
            out["version"] = version
        }
        if let same = sameRoom(late.doc("room"), room) { out["room"] = same }
        return out
    }

    private static func sameRoom(_ a: Doc?, _ b: Doc?) -> Doc? {
        guard let id = b?.str("id"), let key = b?.str("key"),
              a?.str("id") == id, a?.str("key") == key else { return nil }
        return ["id": id, "key": key]
    }
}

/// A restore that waits until the documents of its seat have loaded.
struct RestoreWatch {
    let gid: String
    let seat: Int
    let encrypted: Bool
    /// The seat secret before the restore, to put back when the backup does not fit.
    let before: Doc?
    /// The restore added the wallet secret, so an undo removes it. A restore of the same wallet
    /// that still waits takes over this duty (releaseKey).
    var addedKey: Bool
    let what: String
    /// The key pairs of the file, which join the seat after its published keys confirm them.
    let keys: Doc
    /// The version and the room of the file, which join the seat after the wallet document
    /// confirms them (BackupData.settled).
    let late: Doc

    /// A restore waits by wallet and seat, like the seat secret.
    static func key(_ gid: String, _ seat: Int) -> String { "\(gid):\(seat)" }
}

/// How to undo a restore, from the seat secret `before` it: remove it when the seat held nothing,
/// else keep it. A seat that held a key share keeps it, because the old copy has old nonces. A seat
/// that held a secret without a key share takes no restore (BackupData.heldRefusal). Same rule as
/// undoPlan in util.js.
enum UndoPlan {
    case keep, remove

    init(before: Doc?) { self = before == nil ? .remove : .keep }
}

/// Does this device own a seat? A restored seat (`restored` in its secret) counts only while its
/// key data fits the wallet: `fit` is true. The identity of the seat does not count then, because
/// the secret can hold an identity that a restore recorded. Same rule as seatOwned in util.js.
enum SeatOwner {
    static func owns(uid: String?, me: String, secret: Doc, fit: @autoclosure () -> Bool?) -> Bool {
        if has(secret["restored"]) { return fit() == true }
        return uid == me
    }
}

extension GroupModel {
    /// Seats of this device that hold a key share.
    var keyShareSeats: [Int] {
        guard let gid else { return [] }
        return localSeats.filter { has(vault.sec(gid, $0)["keyPackage"]) }
    }

    /// A restored seat of the open wallet that the wallet does not confirm. It is no seat of this
    /// device (SeatOwner). The watch of a restore is in memory, so after a restart no restore
    /// settles it: the note stays.
    var hasStaleRestore: Bool {
        guard let gid else { return false }
        return vault.seats(in: gid).contains { i in
            let s = vault.sec(gid, i)
            return BackupData.staleRestore(
                s, waiting: restoreWatches[RestoreWatch.key(gid, i)] != nil,
                fit: fit(i, s, in: state))
        }
    }

    /// Deletes this device's copy of the stale restored seats of the open wallet. The wallet's
    /// verdict comes from documents that any holder of the invite link can rewrite, so the view asks first.
    func dropStaleRestores() {
        guard let gid else { return }
        for i in vault.seats(in: gid) {
            let s = vault.sec(gid, i)
            let stale = BackupData.staleRestore(
                s, waiting: restoreWatches[RestoreWatch.key(gid, i)] != nil, fit: fit(i, s, in: state))
            if stale { vault.setSec(gid, i, nil) }
        }
        refresh()
    }

    /// Seats whose key share has no backup yet.
    var unsavedSeats: [Int] {
        guard let gid else { return [] }
        return keyShareSeats.filter { !has(vault.sec(gid, $0)["backedUp"]) }
    }

    /// The text that a backup seals. Same fields as backupText in web/app.js. Nonces stay out: a
    /// restored copy must never sign with a nonce that this device may also use.
    func backupText(_ i: Int) throws -> String {
        guard let gid, let key = vault.keys[gid], localSeats.contains(i) else {
            throw ZigsError("This \(deviceName) holds no key share for seat \(i).")
        }
        var secret = vault.sec(gid, i)
        secret["nonces"] = nil
        secret["backedUp"] = nil
        if !has(secret["uid"]), let uid = state.seats["\(i)"]?.str("uid") { secret["uid"] = uid }
        let b: Doc = [
            "kind": BackupText.kind, "group": gid, "groupName": state.name, "seat": i,
            "threshold": state.t, "of": state.n, "key": key, "wallet": state.wallet ?? NSNull(),
            "secret": secret,
        ]
        return Engine.json(b)
    }

    func markBackedUp(_ i: Int, in gid: String?) {
        guard let gid else { return }
        vault.putSec(gid, i, ["backedUp": true])
        refresh()
    }

    /// What a picked file is. A sealed file needs its passphrase, so this returns true. A plain
    /// file from before encryption restores at once, with a warning.
    func receiveBackup(_ text: String) throws -> Bool {
        let b = try BackupData.parse(text)
        if b.str("kind") == BackupText.sealedKind { return true }
        try restore(BackupData(b), encrypted: false)
        return false
    }

    func restoreSealed(_ text: String, passphrase: String) async throws {
        let pass = Passphrase.normalized(passphrase)
        let plain = try await Task.detached { try Engine.call("backupOpen", [pass, text]) }.value
        try restore(BackupData(BackupData.parse(plain)), encrypted: true)
    }

    /// A restore must not replace what this device holds: not the wallet secret (the rule for
    /// invite links, too), not a seat that is still in setup, and not the key share of the seat.
    /// A seat with a restore that still waits takes no second restore.
    private func checkClash(_ b: BackupData) throws {
        if restoreWatches[RestoreWatch.key(b.group, b.seat)] != nil {
            throw ZigsError(BackupText.restorePending)
        }
        if let key = b.key, let known = vault.keys[b.group], known != key {
            throw ZigsError("This backup has a different wallet secret for a wallet you already "
                + "have, so it was not restored.")
        }
        let held = vault.secrets["\(b.group):\(b.seat)"]
        if let why = BackupData.heldRefusal(held, file: b.keyPackage, seat: b.seat) {
            throw ZigsError(why)
        }
    }

    /// A wallet that is open already shows whether the backup fits. While a document that decides
    /// it has not loaded, settleRestore decides later.
    private func checkRestore(_ b: BackupData) throws {
        try checkClash(b)
        if b.group == gid, fit(b.seat, b.secret, in: state) == false {
            throw ZigsError(BackupText.noFit)
        }
    }

    /// Stores the key share of a backup like a seat of an invite link, then opens the wallet. A
    /// restore takes only the allowed fields, and never brings back nonces. The seat counts as
    /// backed up only for a sealed file, and only when the backup fits the wallet.
    private func restore(_ b: BackupData, encrypted: Bool) throws {
        try checkRestore(b)
        let before = vault.secrets["\(b.group):\(b.seat)"]
        let addedKey = b.key != nil && vault.keys[b.group] == nil
        var secret = b.restoredSecret(over: before ?? [:])
        secret["nonces"] = before?.doc("nonces") ?? [:]
        // A seat that held a key share stays what it was: the flag would put the seat of this
        // device under the fit rule of SeatOwner.
        if before == nil { secret["restored"] = true }
        secret["backedUp"] = false
        if let key = b.key { vault.putKey(b.group, key) }
        guard vault.putSec(b.group, b.seat, secret) else {
            throw ZigsError("This \(deviceName) could not save the restored key share.")
        }
        let what = "seat \(b.seat) of \(b.name)"
        restoreWatches[RestoreWatch.key(b.group, b.seat)] = RestoreWatch(
            gid: b.group, seat: b.seat, encrypted: encrypted, before: before, addedKey: addedKey,
            what: what, keys: b.keys, late: b.lateFields(over: before ?? [:]))
        announceRestore(what, encrypted: encrypted)
        store.join(b.group)
        path = [b.group]
        select(b.group)
        refresh()
    }

    private func announceRestore(_ what: String, encrypted: Bool) {
        if encrypted {
            notice = "Restored \(what). \(BackupText.counts)"
        } else {
            warning = "Restored \(what). \(BackupText.counts) \(BackupText.notEncrypted)"
        }
    }

    /// Settles each restore whose seat documents have loaded: the seat counts when the key data of
    /// the seat equals what the wallet published for it. Else the restore is undone. The first
    /// restore may close the wallet, so each one checks that its wallet is open.
    /// Returns true when it may have changed the seat secrets, so the caller reads the state again.
    func settleRestore() -> Bool {
        var settled = false
        for key in restoreWatches.keys.sorted() {
            if settleOne(key) { settled = true }
        }
        return settled
    }

    private func settleOne(_ key: String) -> Bool {
        guard let w = restoreWatches[key], w.gid == gid, let seat = state.seats["\(w.seat)"],
              let fits = fit(w.seat, vault.sec(w.gid, w.seat), in: state) else { return false }
        restoreWatches[key] = nil
        if fits { acceptRestore(w, published: seat) } else { rejectRestore(w) }
        return true
    }

    /// The key pairs of the file join the seat after its published keys confirm them, and the
    /// version and the room after the wallet document confirms them.
    private func acceptRestore(_ w: RestoreWatch, published: Doc) {
        let held = vault.sec(w.gid, w.seat)
        var add = KeyPairs.taken(file: w.keys, held: held, published: published)
        let wallet = BackupData.settled(w.late, version: state.version, room: state.g?.doc("room"))
        add.merge(wallet) { _, new in new }
        vault.putSec(w.gid, w.seat, add)
        guard w.encrypted else { return }
        vault.putSec(w.gid, w.seat, ["backedUp": true])
        notice = "Restored \(w.what). It matches the wallet."
    }

    private func rejectRestore(_ w: RestoreWatch) {
        let closed = undoRestore(w)
        warning = nil
        notice = nil
        banner = BackupText.noFit
        if closed { path = []; select(nil) }
    }

    /// Removes the seat secret that the restore made (UndoPlan). Returns false when it leaves the
    /// seat alone, else true when the wallet secret went away too.
    private func undoRestore(_ w: RestoreWatch) -> Bool {
        guard case .remove = UndoPlan(before: w.before) else { return false }
        vault.setSec(w.gid, w.seat, nil)
        return releaseKey(w)
    }

    /// The restore that added the wallet secret removes it again, unless a seat of the wallet
    /// remains. A restore of the same wallet that still waits takes over the duty to remove it.
    private func releaseKey(_ w: RestoreWatch) -> Bool {
        if w.addedKey, let heir = restoreWatches.first(where: { $0.value.gid == w.gid })?.key {
            restoreWatches[heir]?.addedKey = true
        }
        guard w.addedKey, vault.seats(in: w.gid).isEmpty else { return false }
        vault.removeKey(w.gid)
        return true
    }
}

// MARK: Views

private struct SeatRef: Identifiable { let id: Int }

/// The key share of each seat on this device, with a button to back it up.
struct BackupCard: View {
    @Environment(GroupModel.self) private var model
    @State private var seat: SeatRef?

    var body: some View {
        let seats = model.keyShareSeats
        if !seats.isEmpty {
            let unsaved = model.unsavedSeats
            Card(highlight: !unsaved.isEmpty) {
                Text("Back up your key share").font(.headline)
                Text("If you lose this \(deviceName), or delete Zigs, the key share is lost. "
                     + "The backup file is locked with a passphrase that you choose. "
                     + "Keep the file safe, and keep the passphrase apart from it.")
                    .font(.subheadline).foregroundStyle(Color.mist)
                ForEach(seats, id: \.self) { i in
                    HStack {
                        Text("Seat \(i)").font(.subheadline.weight(.medium))
                        Badge(text: unsaved.contains(i) ? "Not backed up" : "Backed up",
                              kind: unsaved.contains(i) ? .warn : .ok)
                        Spacer()
                        Button("Back up seat \(i)") { seat = SeatRef(id: i) }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .sheet(item: $seat) { BackupSheet(seat: $0.id) }
        }
    }
}

/// Asks for a passphrase, seals the seat, proves in memory that the file opens, and then offers it
/// for saving. The seat counts as backed up only after the file is saved.
struct BackupSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let seat: Int
    @State private var pass = ""
    @State private var again = ""
    @State private var shown = false
    @State private var busy = false
    @State private var error: String?
    @State private var document: BackupDocument?
    @State private var exporting = false
    /// The wallet that was open when the person pressed save. The sheet outlives a change of it.
    @State private var wallet: String?

    var body: some View {
        let issue = Passphrase.issue(pass, again)
        NavigationStack {
            Form {
                Section {
                    Text(BackupText.note).font(.subheadline)
                }
                Section {
                    if shown {
                        TextField("Passphrase", text: $pass).font(.body.monospaced()).codeEntry()
                        CopyButton(text: pass, label: "Copy passphrase", sensitive: true)
                        Text("Copy keeps the passphrase for 2 minutes. Write it down.")
                            .font(.footnote).foregroundStyle(Color.mist)
                    } else {
                        SecureField("Passphrase", text: $pass)
                    }
                    Button("Make a passphrase for me", systemImage: "wand.and.stars") { make() }
                    SecureField("Type it again", text: $again)
                } footer: {
                    Text(error ?? issue ?? "The passphrases match.")
                        .foregroundStyle(hintColor(issue))
                }
                .disabled(busy)
                Section {
                    Text("The file holds your key share. Anyone who has the file and the "
                         + "passphrase can sign as this seat.")
                        .font(.footnote).foregroundStyle(Color.mist)
                }
            }
            .navigationTitle("Back up seat \(seat)")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Encrypting…" : "Encrypt and save") { save() }
                        .disabled(issue != nil || busy)
                }
            }
            .fileExporter(isPresented: $exporting, document: document, contentType: .zigsBackup,
                          defaultFilename: backupFileName(wallet: model.state.name, seat: seat)) {
                saved($0)
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private func hintColor(_ issue: String?) -> Color {
        if error != nil { return .bad }
        return issue == nil ? .good : .mist
    }

    private func make() {
        do {
            pass = try Passphrase.made()
            again = ""
            shown = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save() {
        busy = true
        error = nil
        let p = Passphrase.normalized(pass)
        wallet = model.gid
        Task {
            do {
                let plain = try model.backupText(seat)
                let sealed = try await Task.detached {
                    try Engine.call("backupSeal", [p, plain])
                }.value
                let back = try await Task.detached {
                    try Engine.call("backupOpen", [p, sealed])
                }.value
                // By bytes: Swift's `==` accepts text that has a different composition.
                guard back.utf8.elementsEqual(plain.utf8) else {
                    throw ZigsError("The backup did not open to the same key share, so it was not "
                        + "saved. Try again.")
                }
                document = BackupDocument(text: sealed)
                exporting = true
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func saved(_ result: Result<URL, Error>) {
        switch result {
        case .success:
            model.markBackedUp(seat, in: wallet)
            model.notice = "Backup saved. Keep the passphrase apart from the file."
            dismiss()
        case .failure(let e):
            if (e as? CocoaError)?.code != .userCancelled {
                error = "Backup not saved: \(e.localizedDescription)"
            }
        }
    }
}

/// Asks for the passphrase of a sealed backup file, then restores the seat.
struct RestoreSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let name: String
    let text: String
    @State private var pass = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Passphrase", text: $pass).disabled(busy)
                } header: {
                    Text("Passphrase of \(name)")
                } footer: {
                    if let error { Text(error).foregroundStyle(Color.bad) }
                }
            }
            .navigationTitle("Open a backup")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Opening…" : "Open backup") { open() }
                        .disabled(pass.isEmpty || busy)
                }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private func open() {
        busy = true
        error = nil
        Task {
            do {
                try await model.restoreSealed(text, passphrase: pass)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
