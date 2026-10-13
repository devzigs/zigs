// Swift side of ios/check-backup.sh: the backup rules of Backup.swift, and a file from the web app.
import CryptoKit
import Foundation

func check(_ ok: Bool, _ what: String) {
    if !ok { print("FAIL: \(what)"); exit(1) }
}

func failure(_ run: () throws -> Any) -> String {
    do { _ = try run() } catch { return error.localizedDescription }
    return ""
}

let dir = CommandLine.arguments[1]
// The web side writes the passphrase with split letters (NFD). Both apps normalize it to NFC.
let typed = try String(contentsOfFile: dir + "/pass.txt", encoding: .utf8)
let pass = Passphrase.normalized(typed)
let sealed = try String(contentsOfFile: dir + "/web-made.zigsbackup", encoding: .utf8)
check(!typed.unicodeScalars.elementsEqual(pass.unicodeScalars), "the test passphrase is split")

// A web backup opens, passes the checks, and fits the key data that the wallet published.
let plain = try Engine.call("backupOpen", [pass, sealed])
let b = try BackupData(BackupData.parse(plain))
let keyOk = b.key == String(repeating: "A", count: 43)
check(b.seat == 2 && b.name == "Team treasury" && keyOk, "web fields")
var st = GroupState()
let id = GroupState.frostId(2)
check(id.count == 64 && id.hasPrefix("0200"), "frost id")
func published(_ share: String, key: String = "gk", others: String = "") -> [String: Doc] {
    let shares = "\"\(id)\":\"\(share)\"" + others
    return ["2": ["publicKeyPackage": "{\"verifying_shares\":{\(shares)},\"verifying_key\":\"gk\"}",
                  "groupKey": key]]
}
st.done = published("abc")
check(st.published(2, fits: b.secret), "key data fits")
check(!st.published(3, fits: b.secret), "key data of another seat")
st.done = published("zzz")
check(!st.published(2, fits: b.secret), "key share of another wallet")
st.done = published("abc", key: "other")
check(!st.published(2, fits: b.secret), "another group key")
st.done = published("abc", others: ",\"x\":\"y\"")
check(!st.published(2, fits: b.secret), "another public key package")
st.done = ["2": ["groupKey": "gk"]]
check(!st.published(2, fits: b.secret), "no public key package published")
// The published package may also be the object itself, in another key order.
let asObject: Doc = ["verifying_key": "gk", "verifying_shares": [id: "abc"] as Doc]
st.done = ["2": ["publicKeyPackage": asObject, "groupKey": "gk"]]
check(st.published(2, fits: b.secret), "package as an object")
st.done = published("abc")
func without(_ k: String) -> Doc { var d = b.secret; d[k] = nil; return d }
check(!st.published(2, fits: without("publicKeyPackage")), "the file has no package")
check(!st.published(2, fits: without("groupKey")), "the file has no group key")
check(!st.published(2, fits: without("keyPackage")), "the file has no key share")
var otherPackage = b.secret
let otherShares: Doc = [id: "abd"]
otherPackage["publicKeyPackage"] = ["verifying_key": "gk", "verifying_shares": otherShares] as Doc
check(!st.published(2, fits: otherPackage), "the file has another package")

// Seats agree on their keys when every done document holds the same group key and the same
// public key package. Both apps publish the package as JSON text.
var agree = GroupState()
agree.g = ["n": 2]
let package = "{\"verifying_key\":\"gk\",\"verifying_shares\":{\"01\":\"a\"}}"
let reordered = "{\"verifying_shares\":{\"01\":\"a\"},\"verifying_key\":\"gk\"}"
func dones(_ a: String, _ b: String, _ key: String = "gk") -> [String: Doc] {
    ["1": ["groupKey": "gk", "publicKeyPackage": a], "2": ["groupKey": key, "publicKeyPackage": b]]
}
agree.done = dones(package, reordered)
check(agree.keysAgree, "equal packages agree, in any key order")
agree.done = dones(package, package.replacingOccurrences(of: "\"a\"", with: "\"b\""))
check(!agree.keysAgree, "another package")
agree.done = dones(package, package, "other")
check(!agree.keysAgree, "another group key")
agree.done = ["1": ["groupKey": "gk"], "2": ["groupKey": "gk"]]
check(!agree.keysAgree, "no package")

// A restore takes the allowed fields only, and no key pair, version or room at once. Claims of
// the file stay out.
let kept = Set(b.restoredFields.keys)
check(kept == ["keyPackage", "publicKeyPackage", "groupKey", "vaultSk"], "restored fields \(kept)")
check(Set(b.keys.keys) == ["boxSk", "boxPk", "signSk", "signPk"], "the key pairs of the file")
check(Set(b.lateFields(over: [:]).keys) == ["version", "room"], "the late fields of the file")
check(b.secret["checkedWallet"] != nil && b.secret["nonces"] != nil, "the file has claims")

// A file that copies the public values of a share cannot replace or add secret values on a device
// that holds a key share for the seat: the device keeps exactly what it holds.
let live: Doc = [
    "keyPackage": ["identifier": id, "verifying_share": "abc", "signing_share": "live"] as Doc,
    "vaultSk": "live-v", "checkedWallet": "live-check", "nonces": ["a": 1] as Doc,
    "boxSk": "live-box",
]
let merged = b.restoredSecret(over: live)
check(merged.doc("keyPackage")?.str("signing_share") == "live", "the device key share wins")
check(merged.str("vaultSk") == "live-v", "the device vaultSk wins")
check(merged["version"] == nil && merged["room"] == nil, "no version or room from the file")
check(merged.str("boxSk") == "live-box" && merged["signSk"] == nil, "no key pair from the file")
check(merged["checkedWallet"] == nil && merged["nonces"] == nil, "no claims, no nonces")
check(Set(merged.keys) == ["keyPackage", "vaultSk", "boxSk"], "only what the device holds")
check(b.lateFields(over: live).isEmpty, "a held share: no late field")
// A held share without a version, a setup secret or a room: nothing comes from the file.
let bare: Doc = ["keyPackage": live["keyPackage"] as Any, "publicKeyPackage": "live-pkp"]
check(Set(b.restoredSecret(over: bare).keys) == ["keyPackage", "publicKeyPackage"], "bare share")
check(b.lateFields(over: bare).isEmpty, "bare share: no late field")
check(b.restoredSecret(over: bare)["vaultSk"] == nil, "bare share: no vaultSk from the file")
// A device without a key share takes the allowed fields now, and holds back the late ones.
check(b.restoredSecret(over: [:]).str("vaultSk") == "vsk", "nothing held: the file")
check(b.restoredSecret(over: ["boxSk": "x"]).str("vaultSk") == "vsk", "no key share held: the file")
check(b.restoredSecret(over: [:])["boxSk"] == nil, "nothing held: still no key pair")
let fresh = b.restoredSecret(over: [:])
check(fresh["version"] == nil && fresh["room"] == nil, "nothing held: no version or room yet")
let noShare: Doc = ["keyPackage": ["identifier": id] as Doc]
check(Set(b.lateFields(over: noShare).keys) == ["version", "room"], "no full share: late fields")

// The late fields join the seat only when they equal the wallet's own values, and the stored
// values are the wallet's.
let room: Doc = ["id": "a", "key": "k", "extra": "wallet"]
let late: Doc = ["version": 2, "room": ["id": "a", "key": "k"] as Doc]
func settled(_ l: Doc = late, _ v: Int = 2, _ r: Doc? = room) -> Doc {
    BackupData.settled(l, version: v, room: r)
}
check(settled().int("version") == 2 && settled().doc("room")?.count == 2, "settled, both match")
check(settled().doc("room")?.str("id") == "a" && settled().doc("room")?["extra"] == nil, "room")
check(Set(settled(late, 1).keys) == ["room"], "another wallet version")
check(Set(settled(late, 2, ["id": "a", "key": "x"]).keys) == ["version"], "another room key")
check(Set(settled(late, 2, ["id": "b", "key": "k"]).keys) == ["version"], "another room id")
check(Set(settled(late, 2, nil).keys) == ["version"], "no wallet room")
check(settled(late, 0, nil).isEmpty, "a version this app lacks")
check(settled(["version": 3], 3, nil).int("version") == 3, "settled, version 3")
check(settled(["version": 3], 2, nil).int("version") == 3, "settled, version 3 stays")
check(settled(["version": 3], 1, nil).int("version") == 3, "settled, version 3 over version 1")
check(settled(["version": 3], 0, nil)["version"] == nil, "settled, a version this app lacks")
check(settled(["version": 2], 3, nil)["version"] == nil, "settled, a lower file")
check(settled(["version": "2", "room": "x"]).isEmpty, "not the same type")
check(settled(["version": true]).isEmpty && settled(["version": true], 1).isEmpty, "a JSON true")
check(settled(["room": ["id": 5, "key": 6] as Doc], 2, ["id": 5, "key": 6]).isEmpty, "numbers")
check(settled([:]).isEmpty, "no late fields")
check(RestoreWatch.key("g1", 2) == "g1:2", "watch key")
check(RestoreWatch.key("g1", 1) != RestoreWatch.key("g1", 2), "seats of one wallet differ")
check(RestoreWatch.key("g1", 1) != RestoreWatch.key("g2", 1), "wallets differ")
check(BackupData.sameShare(b.keyPackage, b.keyPackage), "same share")
let other: Doc = ["identifier": id, "verifying_share": "other"]
check(!BackupData.sameShare(b.keyPackage, other), "another verifying share")
check(!BackupData.sameShare(b.keyPackage, ["identifier": id]), "no verifying share")
check(!BackupData.sameShare(nil, b.keyPackage), "no key package")

// The key pairs of a web file: each secret key makes its public key (X25519 from the engine,
// Ed25519 from WebCrypto). A pair joins the seat only when the seat published that public key.
let pub: Doc = ["boxPk": b.keys["boxPk"] as Any, "signPk": b.keys["signPk"] as Any]
func taken(held: Doc = [:], published: Doc = pub, file: Doc = b.keys) -> Set<String> {
    Set(KeyPairs.taken(file: file, held: held, published: published).keys)
}
let boxFields: Set<String> = ["boxSk", "boxPk"], signFields: Set<String> = ["signSk", "signPk"]
check(taken() == boxFields.union(signFields), "both pairs of the web file")
check(taken(published: ["signPk": pub["signPk"] as Any]) == signFields, "no published box key")
check(taken(published: ["boxPk": pub["boxPk"] as Any]) == boxFields, "no published sign key")
check(taken(published: ["boxPk": "00", "signPk": "00"]).isEmpty, "other published keys")
var secretsOnly = b.keys
secretsOnly["boxPk"] = nil
secretsOnly["signPk"] = nil
let fromSecrets = KeyPairs.taken(file: secretsOnly, held: [:], published: pub)
check(Set(fromSecrets.keys) == boxFields.union(signFields), "a file with secret keys only")
check(fromSecrets.str("boxPk") == pub["boxPk"] as? String, "the published public key is stored")
check(taken(held: ["boxSk": "mine"]) == signFields, "the seat's own box key wins")
check(taken(held: ["signPk": "mine"]) == boxFields, "the seat's own sign key wins")
var swapped = b.keys
swapped["boxSk"] = Curve25519.KeyAgreement.PrivateKey().rawRepresentation.map {
    String(format: "%02x", $0) }.joined()
check(taken(file: swapped) == signFields, "a box secret of another pair")
swapped = b.keys
swapped["signSk"] = b.keys["signSk"].flatMap { ($0 as? String).map { String($0.reversed()) } }
check(taken(file: swapped) == boxFields, "a sign secret of another pair")
let seed = Curve25519.Signing.PrivateKey()
let der = Data([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22,
                0x04, 0x20]) + seed.rawRepresentation
let seedPk = KeyPairs.hex(seed.publicKey.rawRepresentation)
check(KeyPairs.signMatches(der.base64EncodedString(), seedPk), "a sign key made here")
check(!KeyPairs.signMatches(seed.rawRepresentation.base64EncodedString(), seedPk), "no PKCS 8 head")
check(!KeyPairs.signMatches(nil, seedPk), "no sign key")
check(!KeyPairs.signMatches("not base64!", seedPk), "bad sign key")
check(!KeyPairs.boxMatches(nil, "00") && !KeyPairs.boxMatches("zz", "00"), "bad box key")
check(!KeyPairs.boxMatches(String(repeating: "0", count: 62), "00"), "short box key")

// The undo of a restore removes a seat that held nothing and keeps a seat that held a key share.
// It never writes back an old copy with old nonces.
let held: Doc = ["keyPackage": b.keyPackage, "nonces": ["s1": "old"] as Doc]
if case .keep = UndoPlan(before: held) {} else { check(false, "keep a held share") }
if case .remove = UndoPlan(before: nil) {} else { check(false, "remove") }

// A restore is refused over a seat secret that holds no key share: the seat is in setup on this
// device. The test secrets hold only r1secret and boxSk, or no key package that has a share.
let setupSecrets: [Doc] = [
    ["r1secret": "r", "boxSk": "b"], ["skPart": "p", "boxSk": "b"], ["boxSk": "b"],
    ["r1secret": "r", "boxSk": "b", "uid": "me"], [:], ["keyPackage": ["identifier": id] as Doc],
    ["keyPackage": "text", "boxSk": "b"], ["r2secret": "r2", "keyPackage": NSNull()],
]
for secret in setupSecrets {
    let why = BackupData.heldRefusal(secret, file: b.keyPackage, seat: 2)
    check(why == BackupText.setupHeld, "a seat in setup takes no restore: \(secret)")
}
check(BackupText.setupHeld.contains("still being set up"), "setup text")
check(BackupData.heldRefusal(nil, file: b.keyPackage, seat: 2) == nil, "no secret")
check(BackupData.heldRefusal(held, file: b.keyPackage, seat: 2) == nil, "the same share")
let otherShare = BackupData.heldRefusal(held, file: other, seat: 2)
check(otherShare?.contains("another key share for seat 2") == true, "another share")

// A restored seat counts as a seat of this device only while it fits the wallet, whatever its
// identity says. Without the flag, the identity decides and the fit is not asked.
func asked() -> Bool? { check(false, "fit was asked"); return nil }
func owns(_ secret: Doc, me: String, fit: Bool?) -> Bool {
    SeatOwner.owns(uid: "u-seat", me: me, secret: secret, fit: fit)
}
let recorded: Doc = ["restored": true, "uid": "u-seat"]    // reactSeat records the identity
for secret in [["restored": true] as Doc, recorded] {
    for me in ["u-seat", "other"] {
        check(owns(secret, me: me, fit: true), "restored, fits: \(secret) \(me)")
        check(!owns(secret, me: me, fit: false), "restored, no fit: \(secret) \(me)")
        check(!owns(secret, me: me, fit: nil), "restored, fit unknown: \(secret) \(me)")
    }
}
check(owns(["restored": true], me: "other", fit: true), "restored, no identity, fits")
check(!owns(["restored": false], me: "other", fit: true), "the flag is false: the identity decides")
check(SeatOwner.owns(uid: "u-seat", me: "u-seat", secret: [:], fit: asked()), "taken here")
check(!SeatOwner.owns(uid: "u-seat", me: "other", secret: [:], fit: asked()), "another identity")
check(!SeatOwner.owns(uid: nil, me: "u-seat", secret: [:], fit: asked()), "no seat identity")

// A stale restore is a restored secret that does not fit and that no restore waits for.
let flagged: Doc = ["restored": true]
check(BackupData.staleRestore(flagged, waiting: false, fit: false), "stale")
check(!BackupData.staleRestore(flagged, waiting: true, fit: false), "a restore waits")
check(!BackupData.staleRestore(flagged, waiting: false, fit: nil), "fit not known yet")
check(!BackupData.staleRestore(flagged, waiting: false, fit: true), "fits")
check(!BackupData.staleRestore(held, waiting: false, fit: false), "a seat taken here")
check(!BackupData.staleRestore(nil, waiting: false, fit: false), "no secret")
check(!BackupData.staleRestore([:], waiting: false, fit: asked()), "no flag: fit not asked")

// Wrong and short passphrases give the messages of the engine.
let wrong = failure { try Engine.call("backupOpen", ["wrong wrong wrong wrong", sealed]) }
check(wrong == "Wrong passphrase, or the file is damaged.", "wrong")
let short = failure { try Engine.call("backupSeal", ["short", plain]) }
check(short == "The passphrase needs at least 16 characters.", "short")
let weak = failure { try Engine.call("backupSeal", [String(repeating: "a", count: 16), plain]) }
check(weak == "The passphrase needs at least 8 different characters.", "weak")

// Files that are not backups.
func refused(_ message: String, _ edit: (inout Doc) -> Void) -> Bool {
    var d = try! BackupData.parse(plain)
    edit(&d)
    return failure { try BackupData(d) } == message
}
func notBackup(_ edit: (inout Doc) -> Void) -> Bool { refused(BackupText.notABackup, edit) }
check(notBackup { $0["kind"] = "x" }, "kind")
check(notBackup { $0["group"] = "XYZ" }, "group")
check(notBackup { $0["seat"] = 0 } && notBackup { $0["seat"] = 8 }, "seat range")
check(notBackup { $0["seat"] = true } && notBackup { $0["seat"] = 1.5 }, "seat type")
check(notBackup { $0["key"] = "abc" } && notBackup { $0["key"] = NSNull() }, "key")
check(notBackup { $0["secret"] = "s" }, "secret")
check(!notBackup { $0["key"] = nil }, "a backup without a wallet secret is allowed")
check(refused(BackupText.noKeyShare) { $0["secret"] = ["vaultSk": "v"] as Doc }, "no key package")
check(refused(BackupText.noKeyShare) { $0["secret"] = ["keyPackage": ["identifier": id]] as Doc },
      "key package without a share")

// The passphrase rules match web/util.js (web/test/util.mjs holds the same vectors).
check(Passphrase.from(Array(0..<30)) == "01234-56789-abcde-fghjk-mnpqr-stvwx", "made passphrase")
let faces = String(repeating: "\u{1F600}", count: 16)
check(Passphrase.length("e\u{301}") == 2 && Passphrase.length(faces) == 16, "scalars")
let sixteen = "abcdefghijklmnop"
let fifteen = String(repeating: "a", count: 15)
check(Passphrase.issue(fifteen, "") == "Use at least 16 characters (15 so far).", "short issue")
check(Passphrase.issue(sixteen, "") == "Type or paste the passphrase again to confirm it.", "again")
check(Passphrase.issue(sixteen, sixteen + " ") == "The two passphrases are not the same.", "differ")
check(Passphrase.issue(sixteen, sixteen) == nil, "ok")
let few = "Use at least 8 different characters (1 so far), or choose Make a passphrase for me."
check(Passphrase.issue(String(repeating: "a", count: 16), "") == few, "weak issue")
let seven = String(repeating: "abcdefg", count: 3)
check(Passphrase.issue(seven, seven)?.contains("(7 so far)") == true, "seven different")
check(Passphrase.issue(String(repeating: "abcdefgh", count: 2), "") != nil, "eight different")
let composed = "caf\u{e9} cr\u{e8}me br\u{fb}l\u{e9}e"
let split = "cafe\u{301} cre\u{300}me bru\u{302}le\u{301}e"
check(!composed.unicodeScalars.elementsEqual(split.unicodeScalars), "the two spellings differ")
check(Passphrase.normalized(split).unicodeScalars.elementsEqual(composed.unicodeScalars), "NFC")
check(Passphrase.issue(composed, split) == nil, "NFC match")
check(Passphrase.issue(split, composed) == nil, "NFC match, the other way")
let made = try Passphrase.made()
let madeShape = made.wholeMatch(of: /([0-9a-hjkmnp-tv-z]{5}-){5}[0-9a-hjkmnp-tv-z]{5}/)
check(made.count == 35 && madeShape != nil, "made shape")
check(Passphrase.issue(made, made) == nil, "a made passphrase passes")
let named = backupFileName(wallet: "Team treasury", seat: 2)
check(named == "zigs-Team-treasury-seat-2.zigsbackup", "file name")
let noName = backupFileName(wallet: "\u{65e5}\u{672c}", seat: 3)
check(noName == "zigs-wallet-seat-3.zigsbackup", "file name, no letters")

// Signed writes of version 3 wallets. The engine builds the text, and Ed25519 signs it. A signature
// from the web app must verify here, and one made here must verify in the web app (web.mjs).
let wid = "0123456789abcdef0123"
let knownFields = #"{"number":"12345 67890 12345 67890 12345 67890","at":1760000000000}"#
let knownText = #"["zigs-doc-v1","0123456789abcdef0123","confirm/2",2,{"at":1760000000000,"#
    + #""number":"12345 67890 12345 67890 12345 67890"}]"#
let knownPk = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8"
let knownSig = "HfeBGagkHgfSW/dlhgyAuMGNEUigk6iD3xyUyS0FrO035rvYkbv+qEvQtn/KczG4cpUvbg2v"
    + "hBrKw2hQgWrfDw=="
check(try Engine.call("docPayload", [wid, "confirm/2", 2, knownFields]) == knownText, "known text")
check(Signed.verify(knownPk, knownSig, knownText), "the known web signature verifies here")
let movedText = knownText.replacingOccurrences(of: "confirm/2", with: "confirm/1")
check(!Signed.verify(knownPk, knownSig, movedText), "a signature does not move to another path")
check(!Signed.verify(knownPk, "AAAA", knownText), "a short signature")
check(!Signed.verify("zz", knownSig, knownText), "a bad public key")
check(!Signed.verify(knownPk, String(knownSig.reversed()), knownText), "another signature")
let seedKey = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(0..<32))
check(KeyPairs.hex(seedKey.publicKey.rawRepresentation) == knownPk, "the public key of the seed")
let seedSk = (KeyPairs.pkcs8Prefix + seedKey.rawRepresentation).base64EncodedString()
let seedSig = try Signed.sign(seedSk, knownText)
check(Signed.verify(knownPk, seedSig, knownText), "a signature made here")
let noKey = failure { try Signed.sign("not a key", knownText) }
check(noKey == Signed.noSeatKey, "no key, no signature")
let madeKey = Signed.newKey()
check(KeyPairs.signMatches(madeKey.signSk, madeKey.signPk), "a new key makes its public key")
check(Signed.validPk(madeKey.signPk), "a new public key is lowercase hex")
check(Data(base64Encoded: madeKey.signSk)?.count == 48, "a new key is PKCS 8")

// Which seat must have written a document (the same table as web/test/signed.mjs).
let writers: [String: Int] = [
    "confirm/3": 3, "abort/1": 1, "dkg1/2": 2, "dkg2/2-3": 2, "dkg2/10-1": 10, "done/4": 4,
    "verify/5": 5, "meta/wallet": 1, "sessions/ab12-cd/commits/2": 2, "sessions/ab12/shares/7": 7,
    "seats/2": 2,
]
for (rel, seat) in writers { check(Signed.writerOf(rel) == seat, "writer of \(rel)") }
let noWriter = [
    "confirm/0", "confirm/01", "confirm/x", "confirm/1/2", "dkg2/1", "dkg2/1-", "commits/1",
    "sessions/s1", "sessions/s1/commits/", "sessions//commits/1", "meta/other", "seats/0",
    "seats/x", "seats", "messages/1", "", "__proto__", "confirm/1\n", "sessions/a/b/commits/1",
    "confirm/\u{663}",
]
for rel in noWriter { check(Signed.writerOf(rel) == nil, "no writer of \(rel.debugDescription)") }
check(Signed.sessionOfPart("sessions/ab12/commits/2") == "ab12", "session of a commit")
check(Signed.sessionOfPart("sessions/ab12/shares/2") == "ab12", "session of a share")
check(Signed.sessionOfPart("sessions/ab12 proposal") == nil, "a session part is no commit")
check(Signed.sessionOfPart("confirm/1") == nil, "no session")

// The shape of a wallet: 2 to 7 signers, a rule of 2 up to all of them.
check(Signed.shape(["n": 3, "t": 2]) == "3/2", "a good shape")
check(Signed.parseShape("3/2")?.n == 3 && Signed.parseShape("7/7")?.t == 7, "a pinned shape")
let badShapes: [Doc] = [
    ["n": 1, "t": 1], ["n": 8, "t": 2], ["n": 3, "t": 4], ["n": 3, "t": 1], ["n": 3.5, "t": 2],
    ["n": "3", "t": 2], ["n": true, "t": 2], ["n": 65540, "t": 2],
]
for bad in badShapes {
    check(Signed.shape(bad) == nil, "a bad shape \(bad)")
}
for bad in ["", "3", "3/", "/2", "3/2/1", "1/1", "8/2", "3/4", "a/b"] {
    check(Signed.parseShape(bad) == nil, "a bad pin \(bad.debugDescription)")
}
check(Signed.seatRange(3) == [1, 2, 3] && Signed.seatRange(1).isEmpty
      && Signed.seatRange(65540).isEmpty && Signed.seatRange(0).isEmpty, "the seats of a wallet")

// The table of parts is the one of the web app (web.mjs writes PARTS into the file).
let webParts = try Engine.parse(String(contentsOfFile: dir + "/signed-parts.json", encoding: .utf8))
    as! Doc
check(Set(webParts.keys) == Set(Signed.Part.allCases.map { "\($0)" }), "the same parts")
for part in Signed.Part.allCases {
    let web = webParts["\(part)"] as! Doc
    check(web.str("by") == part.by && web.str("sig") == part.sig, "writer fields of \(part)")
    check(web["fields"] as? [String] == part.fields, "signed fields of \(part)")
    let fixed = web.doc("fixed") ?? [:]
    check(fixed.keys.sorted() == part.signedFields([:]).keys.sorted(), "fixed fields of \(part)")
    check(web.str("needs") == part.needs.map { "\($0)" }, "the base of \(part)")
}

// A wallet of documents in the JSON shape of web.mjs: the open payment `sid` has its commits and
// shares in `raw`. The reader pins the keys of the three seats.
func readWallet(_ file: String) throws -> (GroupState, SignedReader, String) {
    let f = try Engine.parse(String(contentsOfFile: file, encoding: .utf8)) as! Doc
    let raw = f.doc("raw")!, sid = f.str("sid")!
    func docs(_ k: String) -> [String: Doc] { raw[k] as? [String: Doc] ?? [:] }
    var st = GroupState()
    st.g = ["n": 3]
    st.seats = docs("seats")
    (st.dkg1, st.dkg2, st.confirm) = (docs("dkg1"), docs("dkg2"), docs("confirm"))
    (st.abort, st.done, st.verify) = (docs("abort"), docs("done"), docs("verify"))
    st.wallet = raw.doc("wallet")
    st.sessions = docs("sessions").map { Session(id: $0.key, doc: $0.value) }
    for ss in st.sessions {
        st.commits[ss.id] = ss.id == sid ? docs("commits") : [:]
        st.shares[ss.id] = ss.id == sid ? docs("shares") : [:]
    }
    var pins = [Int: String]()
    for (seat, pk) in f.doc("pins") ?? [:] { pins[Int(seat)!] = pk as? String }
    return (st, SignedReader(gid: f.str("gid")!, n: 3, pins: pins), sid)
}
func ids(_ docs: [String: Doc]) -> Set<String> { Set(docs.keys) }

// The web app made this wallet (web.mjs make): honest documents of seats 1 and 2, and false ones.
let webRead = try readWallet(dir + "/signed-web.json")
var webState = webRead.0
let (webReader, webSid) = (webRead.1, webRead.2)
let webBad = webState.keepSigned(webReader)
func webId(_ last: String) -> String { String(webSid.dropLast()) + last }
let webWanted: Set<String> = [
    "seats/3", "confirm/3", "done/3", "sessions/\(webId("5")) cancel",
    "sessions/\(webId("6")) proposal", "sessions/\(webId("8")) signed",
    "sessions/\(webId("8")) final", "sessions/\(webId("8")) sent",
    "sessions/\(webSid)/commits/1", "sessions/\(webSid)/shares/1",
]
check(Set(webBad) == webWanted, "ignored web documents \(webBad)")
check(webBad.count == webWanted.count, "each ignored once")
check(ids(webState.seats) == ["1", "2"], "web seat documents")
check(webState.seats["2"]?.str("name") == "Bob" && webState.seats["2"]?["sig"] == nil, "seat 2")
check(ids(webState.confirm) == ["1", "2"], "web confirm documents")
check(ids(webState.dkg2) == ["1-2"] && webState.done.isEmpty, "web round 2 and done documents")
check(ids(webState.verify) == ["1"], "web verify document")
check(webState.verify["1"]?["ok"] as? Bool == true, "a parsed boolean signs the same text")
check(webState.verify["1"]?["error"] is NSNull, "a parsed null signs the same text")
check(webState.confirm["1"]?["by"] == nil, "no writer field is kept")
check(webState.confirm["1"]?.str("number") == "1", "the fields are kept")
check(webState.wallet?.str("address") == "utest1x", "web wallet document")
check(webState.wallet?["sig"] == nil, "no signature in the wallet document")
check(ids(webState.commits[webSid] ?? [:]) == ["2"], "web commits")
check(ids(webState.shares[webSid] ?? [:]) == ["2"], "web shares")
let webSessions = Dictionary(uniqueKeysWithValues: webState.sessions.map { ($0.id, $0.doc) })
check(Set(webSessions.keys) == [webSid, webId("5"), webId("8")], "web sessions \(webSessions.keys)")
check(webSessions[webSid]?.str("status") == "broadcast", "the signed chain makes the status")
check(webSessions[webSid]?.str("package") == "PKG", "web package")
check(webSessions[webSid]?.doc("final")?.str("txid") == "T1", "web final")
check(webSessions[webSid]?.str("broadcastTxid") == "T1", "web sent mark")
check(webSessions[webSid]?.str("createdBy") == "u1", "the proposer comes from the signing seat")
check(webSessions[webId("5")]?.str("status") == "collecting", "a false cancel is no status")
check(webSessions[webId("5")]?["error"] == nil, "a false cancel has no error")
check(webSessions[webId("5")]?["cancelBy"] == nil, "a false cancel has no writer")
check(webSessions[webId("5")]?["cancelSig"] == nil, "a false cancel has no signature")
let madeUp = webSessions[webId("8")] ?? [:]
check(madeUp.str("status") == "collecting", "made-up results are no status")
check(madeUp["signed"] == nil && madeUp["final"] == nil && madeUp["broadcastTxid"] == nil,
      "made-up results are dropped")
// A key that the device did not pin turns every web document of that seat into an ignored one.
var otherState = try readWallet(dir + "/signed-web.json").0
var otherPins = webReader.pins
otherPins[1] = madeKey.signPk
let otherBad = otherState.keepSigned(SignedReader(gid: webReader.gid, n: 3, pins: otherPins))
check(otherState.confirm["1"] == nil && otherBad.contains("confirm/1"), "another pinned key")
check(otherState.seats["1"] == nil && otherBad.contains("seats/1"), "a seat needs its pinned key")
check(otherState.wallet == nil && otherBad.contains("meta/wallet"), "the wallet needs seat 1")
// A raised n does not make seat 4: the reader of 3 seats ignores it, with or without a pin.
let raisedKey = Signed.newKey()
var raisedState = try readWallet(dir + "/signed-web.json").0
let fake4 = Signed.Signer(seat: 4, signSk: raisedKey.signSk)
let fakeSeat: Doc = ["uid": "u4", "name": "Ana", "boxPk": "b4", "signPk": raisedKey.signPk, "at": 4]
raisedState.seats["4"] = try Signed.signDoc(webReader.gid, "seats/4", as: fake4, fakeSeat)
let firstProposal = raisedState.sessions.first!.doc
let raisedProposal = try Signed.signDoc(
    webReader.gid, "sessions/zz", as: fake4,
    firstProposal.filter { Signed.Part.proposal.fields.contains($0.key) })
raisedState.sessions.append(Session(id: "zz", doc: raisedProposal))
// Seat 4 also cancels the payment that the web app made. The cancel part is one more false one.
let cancelled4 = try Signed.signPart(webReader.gid, webSid, .cancel, as: fake4,
                                     ["status": "cancelled", "error": "Stop."])
raisedState.sessions = raisedState.sessions.map {
    $0.id == webSid ? Session(id: webSid, doc: $0.doc.merging(cancelled4) { $1 }) : $0
}
raisedState.commits[webSid]?["4"] = try Signed.signDoc(
    webReader.gid, "sessions/\(webSid)/commits/4", as: fake4,
    ["commitments": ["a": 1] as Doc, "at": 1])
var raisedPins = webReader.pins
raisedPins[4] = raisedKey.signPk
let raisedBad = raisedState.keepSigned(SignedReader(gid: webReader.gid, n: 3, pins: raisedPins))
check(raisedState.seats["4"] == nil && raisedBad.contains("seats/4"), "no seat 4")
check(!raisedState.sessions.contains { $0.id == "zz" }, "no proposal of seat 4")
check(raisedState.commits[webSid]?["4"] == nil, "no approval of seat 4")
check(raisedBad.contains("sessions/\(webSid) cancel"), "the cancel of seat 4 is ignored")
let stillSent = raisedState.sessions.first { $0.id == webSid }?.doc
check(stillSent?.str("status") == "broadcast" && stillSent?["cancelBy"] == nil, "and not a status")

// This code makes a wallet in the same shape. The web app must accept every document (web.mjs
// verify). All seats sign here, with keys in the format of the web app.
typealias Key = (signSk: String, signPk: String)
let seatKeys: [Int: Key] = [1: Signed.newKey(), 2: Signed.newKey(), 3: Signed.newKey()]
let stranger = Signed.newKey()
func signer(_ seat: Int, _ key: Key? = nil) -> Signed.Signer {
    Signed.Signer(seat: seat, signSk: (key ?? seatKeys[seat]!).signSk)
}
func put(_ rel: String, _ seat: Int, _ fields: Doc, key: Key? = nil) throws -> Doc {
    try Signed.signDoc(wid, rel, as: signer(seat, key), fields)
}
func part(_ sid: String, _ p: Signed.Part, _ seat: Int, _ fields: Doc) throws -> Doc {
    try Signed.signPart(wid, sid, p, as: signer(seat), fields)
}
let (sid1, sid2, sid3, sid4) = ("bb12cd34ef56bb12cd34", "bb12cd34ef56bb12cd35",
                                "bb12cd34ef56bb12cd36", "bb12cd34ef56bb12cd37")
func proposal(_ note: String) -> Doc {
    let payee: Doc = ["to": "utest1x", "amount": 5]
    return ["payees": [payee], "note": note, "pool": "ironwood", "amount": 5, "change": 1,
            "fee": 10000, "noteValue": 20, "pczt": "AAA", "move": NSNull(),
            "createdAt": 1760000000000]
}
var swiftSessions: Doc = [:]
for (n, sid) in [sid1, sid2, sid3].enumerated() {
    var doc = try part(sid, .proposal, n + 1, proposal("note \(n)"))
    doc["createdBy"] = "x"
    doc["status"] = "collecting"
    swiftSessions[sid] = doc
}
swiftSessions[sid4] = try Signed.signPart(wid, sid4, .proposal, as: signer(1, stranger),
                                          proposal("four"))
func extend(_ sid: String, _ p: Signed.Part, _ seat: Int, _ fields: Doc) throws {
    swiftSessions[sid] = (swiftSessions[sid] as! Doc).merging(try part(sid, p, seat, fields)) { $1 }
}
let withExtra = proposal("x").merging(["extra": 1]) { $1 }
let unsignedField = failure { try part(sid1, .proposal, 1, withExtra) }
check(unsignedField.contains("extra"), "a field that the part does not name is refused")
try extend(sid1, .package, 2, ["package": "PKG", "signers": [1, 2]])
try extend(sid1, .signed, 3, ["signed": "S", "signatures": [["action": 0, "rk": "r"] as Doc]])
try extend(sid1, .final, 1, ["final": ["txid": "T1", "tx_hex": "00", "size": 1, "ms": 5] as Doc])
try extend(sid1, .sent, 2, ["broadcastTxid": "T1", "broadcastAt": 7])
try extend(sid2, .cancel, 3, ["status": "cancelled", "error": "Cancelled by Cy (seat 3)."])
// The time of a cancel is not signed. Both apps keep it for the event in the message log.
let cancelTime = 1_760_000_000_500
swiftSessions[sid2] = (swiftSessions[sid2] as! Doc).merging(["cancelledAt": cancelTime]) { $1 }
try extend(sid3, .failure, 1, ["error": "Bad share."])
let walletFields: Doc = ["network": "testnet", "address": "utest1x", "birthday": 9, "at": 1]
let odd = "Seat 1 stopped. \u{e9} \"quoted\" \\ done."
func seatDoc(_ i: Int, _ key: Key) -> Doc {
    ["uid": "u\(i)", "name": "S\(i)", "boxPk": "b\(i)", "signPk": key.signPk, "at": i]
}
let swiftRaw: Doc = [
    "seats": [
        "1": try put("seats/1", 1, seatDoc(1, seatKeys[1]!)),
        "2": try put("seats/2", 2, seatDoc(2, seatKeys[2]!)),
        "3": try put("seats/3", 3, seatDoc(3, stranger), key: stranger),
    ] as Doc,
    "confirm": [
        "1": try put("confirm/1", 1, ["number": "1"]),
        "2": try put("confirm/2", 2, ["number": "1"]),
        "3": try put("confirm/3", 3, ["number": "2"], key: stranger),
    ] as Doc,
    "abort": ["1": try put("abort/1", 1, ["reason": odd])] as Doc,
    "dkg1": ["2": try put("dkg1/2", 2, ["package": "{\"a\":1}", "commit": "ab", "at": 3])] as Doc,
    "dkg2": ["3-1": try put("dkg2/3-1", 3, ["sealed": "s", "echo": "e", "at": 4])] as Doc,
    "done": ["1": try put("done/1", 1, ["groupKey": "g", "publicKeyPackage": "{}"])] as Doc,
    "verify": ["2": try put("verify/2", 2, ["ok": true, "error": NSNull(), "at": 2])] as Doc,
    "wallet": try put("meta/wallet", 1, walletFields),
    "sessions": swiftSessions,
    "commits": ["3": try put("sessions/\(sid1)/commits/3", 3,
                             ["commitments": ["a": [1, 2]] as Doc, "at": 4])] as Doc,
    "shares": ["2": try put("sessions/\(sid1)/shares/2", 2, ["shares": "SH", "at": 5])] as Doc,
]
var pinned = [String: String]()
for (seat, key) in seatKeys { pinned["\(seat)"] = key.signPk }
let firstKey: Doc = ["signSk": seatKeys[1]!.signSk, "signPk": seatKeys[1]!.signPk]
let swiftWallet: Doc = ["gid": wid, "n": 3, "sid": sid1, "pins": pinned, "raw": swiftRaw,
                        "key": firstKey]
let swiftFile = dir + "/signed-swift.json"
try Engine.json(swiftWallet).write(toFile: swiftFile, atomically: true, encoding: .utf8)
// The same reader that checked the web documents accepts these.
let ownRead = try readWallet(swiftFile)
var ownState = ownRead.0
let ownBad = ownState.keepSigned(ownRead.1)
check(Set(ownBad) == ["seats/3", "confirm/3", "sessions/\(sid4) proposal"],
      "ignored own documents \(ownBad)")
check(ids(ownState.seats) == ["1", "2"], "own seat documents")
check(ids(ownState.confirm) == ["1", "2"], "own confirm documents")
check(ids(ownState.verify) == ["2"] && ownState.wallet != nil, "own documents")
check(ownState.verify["2"]?["ok"] as? Bool == true, "a boolean")
check(ownState.verify["2"]?["error"] is NSNull, "a null")
let ownStatus = Dictionary(uniqueKeysWithValues: ownState.sessions.map {
    ($0.id, $0.doc.str("status"))
})
let wantStatus = [sid1: "broadcast", sid2: "cancelled", sid3: "failed"]
check(ownStatus == wantStatus, "own statuses \(ownStatus)")
let ownCancelled = ownState.sessions.first { $0.id == sid2 }?.doc ?? [:]
check(Chat.cancelledAt(ownCancelled, created: 7) == cancelTime, "the time of a cancel is kept")
check(ids(ownState.commits[sid1] ?? [:]) == ["3"], "own commits")
check(ids(ownState.shares[sid1] ?? [:]) == ["2"], "own shares")
// The memo answers for the same text only, so a changed field with the old signature fails.
let pinMap = pinned.reduce(into: [Int: String]()) { $0[Int($1.key)!] = $1.value }
let memoReader = SignedReader(gid: wid, n: 3, pins: pinMap)
let signedConfirm = try put("confirm/1", 1, ["number": "1"])
func confirmOk(_ number: String, sig: Any? = nil) -> Bool {
    memoReader.accepts("confirm/1", by: 1, sig: sig ?? signedConfirm["sig"],
                       fields: ["number": number], need: 1)
}
check(confirmOk("1"), "a signature is accepted")
check(confirmOk("1"), "and again, from the memo")
check(!confirmOk("2"), "the same length, another text")
check(!confirmOk("1", sig: String(repeating: "A", count: 400)), "a very long signature")
// The memo drops its oldest entries first, and a replaced entry keeps its place.
let memo = SignedMemo(maxEntries: 3, maxChars: 100)
var runs = 0
func memoAsk(_ key: String, _ text: String, _ pk: String = "k", ok: Bool = true) -> Bool {
    memo.verdict(key, text, pk) { runs += 1; return ok }
}
func filler(_ n: Int, _ c: Character = "x") -> String { String(repeating: c, count: n) }
check(memoAsk("a", filler(10)), "a first check")
check(memoAsk("a", filler(10), ok: false), "the same input is not checked again")
check(!memoAsk("a", filler(10, "y"), ok: false), "the same length, other text")
check(!memoAsk("a", filler(10, "y"), "other", ok: false), "another key")
check(runs == 3, "three checks so far")
for key in ["b", "c", "d"] { _ = memoAsk(key, filler(40, "z")) }
check(memo.count == 2, "the oldest entries are dropped: \(memo.count)")
let before = runs
_ = memoAsk("d", filler(40, "z"))
check(runs == before, "the newest entry stays")
_ = memoAsk("a", filler(10, "y"))
check(runs == before + 1, "the oldest entry is checked again")

// An infinite number would abort the app when written back, so parse refuses it.
check((try? Engine.parse("-1e999")) == nil, "a bare infinite number is refused")
check((try? Engine.parse("{\"a\":[1,-1e999]}")) == nil, "a nested infinite number is refused")
check((try? Engine.parse("{\"a\":[1,2.5]}")) != nil, "finite numbers parse")

// Messages of rooms and direct chats (PROTOCOL.md section 14, web/chat.js). The text that is signed
// must equal the web text, byte for byte.
let chatGid = String(repeating: "a", count: 20), chatRoom = String(repeating: "b", count: 20)
let fixedMsg = ChatMessage(id: String(repeating: "c", count: 20), thread: "wallet",
                           text: "Hi\nthere", at: 1_760_000_000_000, seat: 2)
let fixedText = #"["zigs-msg-v1","aaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbb","#
    + #""cccccccccccccccccccc",2,"wallet",1760000000000,"Hi\nthere"]"#
let fixedPk = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664"
let fixedSig = "P0GlJCn7yLzM8fGipMaSacCPlvVfBLO+aL5hPszFsVVQKfX/tOsLlG11DNuUnD0XytaZCtodaCPdXmc2"
    + "iSwvAg=="
check(Chat.signedText(chatGid, chatRoom, fixedMsg) == fixedText, "the web text of a room message")
check(Signed.verify(fixedPk, fixedSig, fixedText), "the fixed web signature of a room message")
check(!Signed.verify(fixedPk, fixedSig, fixedText.replacingOccurrences(of: "Hi", with: "Ho")),
      "a changed room message")
let fixedDm = ChatMessage(id: fixedMsg.id, thread: "dm", text: "Hi\nthere", at: fixedMsg.at,
                          from: String(repeating: "d", count: 20))
let dmFixedText = #"["zigs-dm-v1","aaaaaaaaaaaaaaaaaaaa","cccccccccccccccccccc","#
    + #""dddddddddddddddddddd",1760000000000,"Hi\nthere"]"#
let dmFixedPk = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"
let dmFixedSig = "IhrJPY9aKgcBD94Yl7F50opizISwAIZbtLzA/j3+uv0nOnXKE21dN8CVUOGBnztcDXQobrZoKTeMajHE"
    + "G67DDw=="
check(Chat.dmText(chatGid, fixedDm) == dmFixedText, "the web text of a direct message")
check(Signed.verify(dmFixedPk, dmFixedSig, dmFixedText), "the fixed web direct signature")
// A signature of one kind never verifies as the other kind: the tags differ.
check(!Signed.verify(fixedPk, fixedSig, dmFixedText), "a room signature is no direct signature")
check(!Signed.verify(dmFixedPk, dmFixedSig, fixedText), "a direct signature is no room signature")

// Text: the limit counts UTF-16 code units, and a message is trimmed.
func textError(_ s: String) -> String? {
    if case .failure(let e) = Chat.checkText(s) { return e.message }
    return nil
}
check(textError("") == "Write a message first." && textError(" \n\t ") == "Write a message first.",
      "an empty message")
check(textError(String(repeating: "x", count: 2000)) == nil, "2000 characters")
check(textError(String(repeating: "x", count: 2001))?.contains("at most 2000") == true, "2001")
check(textError(String(repeating: "x", count: 2000) + "   ") == nil, "spaces are trimmed first")
check(textError(String(repeating: "\u{1F600}", count: 1001)) != nil, "an emoji counts as 2 units")
check(textError(String(repeating: "\u{1F600}", count: 1000)) == nil, "1000 emoji are 2000 units")
if case .success(let trimmed) = Chat.checkText("  hi\nthere  ") {
    check(trimmed == "hi\nthere", "trim")
}

// Ids, rooms and the stored chats.
let roomA = try Chat.newRoom()
check(Chat.validRoom(roomA.id, roomA.key) && roomA.key.count == 43, "a new room is valid")
check(try Chat.newRoom().id != roomA.id, "new rooms differ")
let badRooms: [(String, String)] = [
    (roomA.id.uppercased(), roomA.key), (String(roomA.id.dropFirst()), roomA.key),
    (roomA.id, roomA.key + "a"), (roomA.id, String(repeating: "+", count: 43)),
    (roomA.id, String(roomA.key.dropLast()) + "\u{e9}"),
]
for (id, key) in badRooms { check(!Chat.validRoom(id, key), "a bad room \(id) \(key)") }
func roomDoc(_ id: String, _ key: String) -> Doc { ["id": id, "key": key] }
let isWallet: (String) -> Bool = { $0 == String(repeating: "9", count: 20) }
func pick(_ room: Doc?, _ pinned: String?) -> Chat.RoomPick {
    Chat.pickRoom(chatGid, room, pinned: pinned, isWallet: isWallet)
}
let theRoom = roomDoc(roomA.id, roomA.key)
check(pick(theRoom, nil) == .use && pick(theRoom, roomA.id) == .use, "use the room")
check(pick(theRoom, chatRoom) == .changed, "a room that differs from the pin")
check(pick(nil, nil) == .none && pick(nil, roomA.id) == .missing, "no room")
check(pick(roomDoc(roomA.id, "x"), roomA.id) == .missing, "a room with a bad key is missing")
check(pick(roomDoc(chatGid, roomA.key), roomA.id) == .missing, "a room with the id of the wallet")
check(pick(roomDoc(chatGid, roomA.key), nil) == .none, "a room with the id of the wallet, no pin")
check(pick(roomDoc(String(repeating: "9", count: 20), roomA.key), nil) == .none, "a wallet id")
check(pick(["id": [roomA.id], "key": roomA.key] as Doc, nil) == .none, "an id that is no text")

// Pins keep the first value. A chat pins its first two members, each with the first key.
var pins: [String: String] = [:]
check(Chat.pin(&pins, "g:1", "k1") == .new && Chat.pin(&pins, "g:1", "k1") == .same, "pin")
check(Chat.pin(&pins, "g:1", "k2") == .changed && pins["g:1"] == "k1", "a pin is kept")
var chatPins: [String: String] = [:]
let (m1, m2, m3) = (String(repeating: "1", count: 20), String(repeating: "2", count: 20),
                    String(repeating: "3", count: 20))
check(Chat.pinMember(&chatPins, chatGid, m1, "k1") == .new, "first member")
check(Chat.pinMember(&chatPins, chatGid, m1, "k1") == .same, "same member")
check(Chat.pinMember(&chatPins, chatGid, m1, "k2") == .changed, "key changed")
check(Chat.pinMember(&chatPins, chatGid, m2, "k2") == .new, "second member")
check(Chat.pinMember(&chatPins, chatGid, m3, "k3") == .unknown, "a third member is not pinned")
check(Chat.pinMember(&chatPins, chatGid, m2, "k2") == .same, "second member again")
check(Chat.pinMember(&chatPins, chatRoom, m3, "k3") == .new, "chats are counted apart")
check(chatPins[chatGid + ":" + m3] == nil, "no pin for the third member")
check(Set(Chat.pinnedMembers(chatPins, chatGid)) == [m1, m2], "the pinned members")
check(Chat.pinnedMembers(chatPins, String(repeating: "9", count: 20)).isEmpty, "no members")

// Who sent a message: a member with a pinned key and a good signature.
let senderKey = Signed.newKey(), otherKey = Signed.newKey()
let senderText = Chat.signedText(chatGid, chatRoom, fixedMsg)
let senderSig = try Signed.sign(senderKey.signSk, senderText)
func trustOf(member: Bool = true, _ memberPk: String?, _ pinned: String?) -> Chat.Trust {
    Chat.verdict(senderSig, senderText,
                 Chat.Standing(isMember: member, memberPk: memberPk, pinnedPk: pinned))
}
check(trustOf(senderKey.signPk, senderKey.signPk) == .yes, "a good signature")
check(trustOf(member: false, senderKey.signPk, senderKey.signPk) == .no, "not a member")
check(trustOf(senderKey.signPk, nil) == .no && trustOf(senderKey.signPk, "zz") == .no, "no pin")
check(trustOf(otherKey.signPk, senderKey.signPk) == .changed, "another key in the document")
check(trustOf(nil, senderKey.signPk) == .changed, "no key in the document")
check(trustOf(otherKey.signPk, otherKey.signPk) == .no, "another key signed")
check(Chat.dmVerdict(chatGid, fixedDm, Chat.Standing(isMember: true, memberPk: nil, pinnedPk: nil))
      == .unknown, "a direct message with no pin")

// Documents: what a room and a chat show, and what they drop.
let goodDoc: Doc = ["seat": 2, "thread": "wallet", "text": "Hi", "at": 7, "sig": "s"]
let parsed = Chat.parseMsg("m1", goodDoc)
let wantMsg = ChatMessage(id: "m1", thread: "wallet", text: "Hi", at: 7, seat: 2, sig: "s")
check(parsed == wantMsg, "parse")
check(Chat.parseMsg("m1", goodDoc.merging(["seat": "2"]) { $1 })?.seat == 0, "a seat as text is 0")
check(Chat.parseMsg("m1", goodDoc.merging(["seat": true]) { $1 })?.seat == 0, "a seat as true is 0")
check(Chat.parseMsg("m1", goodDoc.merging(["sig": 5]) { $1 })?.sig == "", "no signature text")
check(Chat.parseMsg("m1", goodDoc.merging(["thread": "pay:ab_-1"]) { $1 }) != nil, "a payment")
let badMsgs: [Doc] = [
    ["text": 5], ["text": String(repeating: "x", count: 2001)], ["thread": "other"],
    ["thread": "pay:"], ["thread": "pay:" + String(repeating: "a", count: 65)],
    ["thread": "pay:a b"], ["thread": "wallet\n"], ["at": "now"], ["at": true], ["at": 1.5],
    ["at": 1e30],
]
for edit in badMsgs {
    check(Chat.parseMsg("m1", goodDoc.merging(edit) { $1 }) == nil, "a dropped message \(edit)")
}
check(Chat.parseMsg("m1", nil) == nil, "no document")
let fromId = String(repeating: "d", count: 20)
let dmDoc: Doc = ["from": fromId, "text": "Hi", "at": 7, "sig": "s"]
let dmParsed = Chat.parseDm("m1", dmDoc)
check(dmParsed == ChatMessage(id: "m1", thread: "dm", text: "Hi", at: 7, from: fromId, sig: "s"),
      "parse direct")
check(dmParsed?.sender == fromId && parsed?.sender == "2", "the sender")
let badDms: [Doc] = [
    ["text": 5], ["text": String(repeating: "x", count: 2001)], ["at": "now"],
    ["from": "zz"], ["from": fromId.uppercased()], ["from": NSNull()],
]
for edit in badDms {
    check(Chat.parseDm("m1", dmDoc.merging(edit) { $1 }) == nil, "a dropped direct message \(edit)")
}
let order = [ChatMessage(id: "b", thread: "wallet", text: "", at: 2),
             ChatMessage(id: "a", thread: "wallet", text: "", at: 2),
             ChatMessage(id: "z", thread: "wallet", text: "", at: 1)]
check(order.sorted(by: Chat.byTime).map(\.id) == ["z", "a", "b"], "messages sort by time, then id")

// Unread: messages from other senders, newer than the mark of their thread.
func unreadMsg(_ id: String, _ seat: Int, _ thread: String, _ at: Int) -> ChatMessage {
    ChatMessage(id: id, thread: thread, text: "", at: at, seat: seat)
}
let inbox = [unreadMsg("1", 1, "wallet", 10), unreadMsg("2", 2, "wallet", 20),
             unreadMsg("3", 2, "pay:x", 30), unreadMsg("4", 3, "wallet", 40)]
func unread(_ mine: [String], _ marks: [String: Int] = [:], _ thread: String? = nil) -> Int {
    Chat.countUnread(inbox, mine: mine, marks: marks, roomId: chatRoom, thread: thread)
}
check(unread(["1"]) == 3 && unread(["1", "2"]) == 1, "unread, own seats do not count")
check(unread(["1"], [chatRoom + ":wallet": 20]) == 2, "unread after a mark")
check(unread(["1"], [chatRoom + ":wallet": 40], "wallet") == 0, "unread, all read")
check(unread(["1"], [:], "pay:x") == 1, "unread of one thread")
check(Chat.countUnread([], mine: ["1"], marks: [:], roomId: "r") == 0, "unread of nothing")

// Room adoption: a room is used while it fits the pin and the secrets this device holds.
func adopt(_ doc: Doc?, pinned: String? = nil, keys: [String: String] = [:])
    -> (pick: Chat.RoomPick, id: String?, warning: String?) {
    Chat.adoptRoom(chatGid, doc, pinned: pinned, keys: keys, isWallet: isWallet)
}
let adoptNew = adopt(theRoom)
check(adoptNew.pick == .use && adoptNew.id == roomA.id, "adopt a new room")
check(adoptNew.warning == nil, "adopt a new room: no warning")
let adoptPinned = adopt(theRoom, pinned: roomA.id, keys: [roomA.id: roomA.key])
check(adoptPinned.id == roomA.id && adoptPinned.warning == nil, "adopt the pinned room")
let adoptSecret = adopt(theRoom, keys: [roomA.id: "another-secret"])
check(adoptSecret.pick == .changed && adoptSecret.id == nil, "a known id with another secret")
check(adoptSecret.warning == Chat.roomChanged, "another secret: the changed warning")
let adoptMoved = adopt(theRoom, pinned: chatRoom, keys: [chatRoom: roomA.key])
check(adoptMoved.pick == .changed && adoptMoved.id == nil, "a new room id")
check(adoptMoved.warning == Chat.roomChanged, "a new room id: the changed warning")
let adoptKept = adopt(nil, pinned: roomA.id, keys: [roomA.id: roomA.key])
check(adoptKept.pick == .missing && adoptKept.id == roomA.id, "a lost field, secret held")
check(adoptKept.warning == nil, "a lost field, secret held: no warning")
let adoptLost = adopt(nil, pinned: roomA.id, keys: [:])
check(adoptLost.id == nil && adoptLost.warning == Chat.roomMissing, "a lost field, no secret")
let adoptNone = adopt(nil)
check(adoptNone.pick == .none && adoptNone.id == nil, "no room, no pin")
check(adoptNone.warning == nil, "no room, no pin: no warning")

// Read marks of a namespace that is new on this device.
let markId = String(repeating: "5", count: 20)
let history = [unreadMsg("1", 1, "wallet", 5), unreadMsg("2", 2, "pay:x", 9),
               unreadMsg("3", 2, "wallet", 3)]
let seedHistory = Chat.seededMarks([:], id: markId, main: "wallet", messages: history, now: 7)
check(seedHistory == [markId + ":wallet": 5, markId + ":pay:x": 7], "history counts as read")
let seedEmpty = Chat.seededMarks([:], id: markId, main: "dm", messages: [], now: 7)
check(seedEmpty == [markId + ":dm": 0], "an empty namespace leaves a zero mark")
let haveMark = Chat.seededMarks([markId + ":wallet": 2], id: markId, main: "wallet",
                                messages: history, now: 7)
check(haveMark == nil, "a namespace with marks is not seeded again")
let seedOthers = Chat.seededMarks(["other:wallet": 2], id: markId, main: "wallet", messages: [],
                                  now: 7)
check(seedOthers == ["other:wallet": 2, markId + ":wallet": 0], "the marks of others stay")
let prefixOnly = [String(markId.dropLast()) + ":wallet": 2]
check(Chat.seededMarks(prefixOnly, id: markId, main: "wallet", messages: [], now: 7) != nil,
      "a prefix of the id is another namespace")

// Links, joining and warnings.
let secret = roomA.key, hashId = roomA.id
check(Chat.parseHash("") == (false, "", "") && Chat.parseHash("#") == (false, "", ""), "no link")
check(Chat.parseHash("#" + hashId) == (false, hashId, ""), "a wallet link without secret")
check(Chat.parseHash("#\(hashId).\(secret)") == (false, hashId, secret), "a wallet link")
check(Chat.parseHash("#\(hashId).\(secret).") == (false, hashId, secret), "a full stop")
check(Chat.parseHash("#c.\(hashId)") == (true, hashId, ""), "a chat link without secret")
check(Chat.parseHash("#c.\(hashId).\(secret).x") == (true, hashId, secret), "parts after")
for bad in ["__proto__", "constructor", "toString", String(repeating: "A", count: 20)] {
    check(Chat.parseHash("#" + bad) == (false, "", ""), bad)
    check(Chat.parseHash("#c.\(bad).\(secret)") == (true, "", secret), bad)
}
check(Chat.parseHash("#c") == (true, "", ""), "only the chat mark")
check(Chat.chatId(ofRoute: Chat.route(hashId)) == hashId && Chat.chatId(ofRoute: hashId) == nil,
      "chat routes")
let full = "This chat already has two people. Ask for a new contact link."
check(Chat.joinBlock(count: 1, leased: true) == nil, "join an open chat")
check(Chat.joinBlock(count: 2, leased: true) == full, "a full chat")
check(Chat.joinBlock(count: 2, leased: false) == full, "a full chat wins over a lease")
check(Chat.joinBlock(count: 3, leased: true) == full, "more than two members")
check(Chat.joinBlock(count: 1, leased: false)?.contains("Someone else is joining") == true, "lease")
check(Chat.joinBlock(count: 0, leased: true)?.contains("does not open a chat") == true, "no member")
let mk: [String: String] = [chatGid + ":" + m1: "k1", chatGid + ":" + m2: "k2"]
func member(_ pk: String) -> Chat.Member { Chat.Member(name: "", signPk: pk) }
let both = [m1: member("k1"), m2: member("k2")]
func warn(_ members: [String: Chat.Member]?, _ senders: [String] = []) -> String? {
    Chat.chatWarning(mk, chatGid, members, senders.map { ChatMessage(id: $0, thread: "dm", text: "",
                                                                     at: 0, from: $0) })
}
check(warn(nil) == nil && warn(both) == nil && warn(both, [m1, m2]) == nil, "no warning")
check(warn(both.merging([m2: member("x")]) { $1 })?.contains("changed or is missing") == true,
      "a changed key")
check(warn([m1: both[m1]!])?.contains("changed or is missing") == true, "a missing member")
check(warn(both.merging([m3: member("k3")]) { $1 })?.contains("third person") == true,
      "a third member")
check(warn(both, [m3])?.contains("third person") == true, "a third sender")
check(Chat.chatWarning([:], chatGid, [:], []) == nil, "an empty chat")

// The saved chats: a damaged entry is dropped, the personal key is kept.
let savedChat: Doc = ["key": roomA.key, "member": m1, "at": 7]
let chatKey = Signed.newKey()
let book = ChatBook(["profile": ["signSk": chatKey.signSk, "signPk": chatKey.signPk] as Doc,
                     "list": [chatGid: savedChat.merging(["extra": 1]) { $1 }] as Doc])
check(book.profile == SignKey(signSk: chatKey.signSk, signPk: chatKey.signPk), "the personal key")
check(book.list == [chatGid: SavedChat(key: roomA.key, member: m1, at: 7)], "the saved chat")
check(ChatBook(book.doc) == book, "a saved record reads back")
let badTime = ChatBook(["list": [chatGid: savedChat.merging(["at": "x"]) { $1 }] as Doc])
check(badTime.list[chatGid]?.at == 0, "a chat with a bad time")
let emptyBooks: [Doc?] = [
    nil, [:], ["list": "abc"], ["list": ["short": savedChat] as Doc],
    ["list": [chatGid: savedChat.merging(["key": "k"]) { $1 }] as Doc],
    ["list": [chatGid: savedChat.merging(["member": "m"]) { $1 }] as Doc],
    ["list": [chatGid: NSNull()] as Doc],
    ["profile": ["signSk": 1, "signPk": chatKey.signPk] as Doc],
    ["profile": ["signSk": "s", "signPk": "zz"] as Doc],
]
for bad in emptyBooks {
    let got = ChatBook(bad)
    check(got.profile == nil && got.list.isEmpty, "a damaged record \(String(describing: bad))")
}

// JSON.stringify and the Swift escapes write the same text (the cases below sign it).
func textOf(_ file: String) throws -> Doc {
    try Engine.parse(String(contentsOfFile: file, encoding: .utf8)) as! Doc
}
func verdictName(_ c: Doc) -> String {
    let who = Chat.Standing(isMember: has(c["isMember"]), memberPk: c.str("memberPk"),
                            pinnedPk: c.str("pinnedPk"))
    let id = c.str("id") ?? "", ns = c.str("ns") ?? ""
    if c.str("kind") == "room" {
        return Chat.parseMsg(id, c.doc("doc")).map {
            "\(Chat.roomVerdict(ns, c.str("room") ?? "", $0, who))"
        } ?? "drop"
    }
    return Chat.parseDm(id, c.doc("doc")).map { "\(Chat.dmVerdict(ns, $0, who))" } ?? "drop"
}
func misses(_ cases: [Doc]) -> [String] {
    cases.filter { verdictName($0) != $0.str("expect") }.map { $0.str("name") ?? "?" }
}
let hard = "quote \" backslash \\ slash / tab \t cr \r nl \n bell \u{07} bs \u{08} ff \u{0C} "
    + "del \u{7F} ls \u{2028} ps \u{2029} emoji \u{1F600} cjk \u{65E5}\u{672C}\u{8A9E} e \u{E9} "
    + "low \u{01}\u{1F}"
let webChat = try textOf(dir + "/chat-web.json")
check(webChat.str("hard") == hard, "the hard text reads back")
check(webChat.str("hardJson") == Chat.jsString(hard), "the Swift escapes equal JSON.stringify")
let webCases = webChat["cases"] as! [Doc]
check(webCases.count == 23, "the web cases")
check(misses(webCases).isEmpty, "the Swift code agrees with the web cases \(misses(webCases))")

// Cases signed here. The web code reads them (web.mjs verify) and must reach the same verdicts.
let (cK1, cK2, cOther) = (Signed.newKey(), Signed.newKey(), Signed.newKey())
let (cSid, cMemA, cMemB) = ("ab12cd34ef56ab12cd34", "1111aaaa1111aaaa1111", "2222bbbb2222bbbb2222")
let cCid = "aabbccddeeff00112233", cRid = "fedcba9876543210fedc", cGid = "0123456789abcdef0123"
let cAt = 1_760_000_000_000
let roomBase = ChatMessage(id: String(repeating: "c", count: 20), thread: "wallet", text: hard,
                           at: cAt, seat: 2)
let dmBase = ChatMessage(id: String(repeating: "d", count: 20), thread: "dm", text: hard, at: cAt,
                         from: cMemA)

struct Sender {
    var key = cK2
    var member = true
    var memberPk: String?
    var pinnedPk: String?
    init(_ k: (signSk: String, signPk: String), member: Bool = true, memberPk: String? = "same",
         pinned: String? = "same") {
        key = k
        self.member = member
        self.memberPk = memberPk == "same" ? k.signPk : memberPk
        pinnedPk = pinned == "same" ? k.signPk : pinned
    }
}

/// One case. `msg` is the message as the document shows it, `text` is what the signature covers.
func chatCase(_ name: String, _ expect: String, room: Bool, msg: ChatMessage, text: String? = nil,
              by sender: Sender, doc edit: Doc = [:]) throws -> Doc {
    let signed = text ?? (room ? Chat.signedText(cGid, cRid, msg) : Chat.dmText(cCid, msg))
    let sig = try Signed.sign(sender.key.signSk, signed)
    var doc: Doc = room
        ? ["seat": msg.seat, "thread": msg.thread, "text": msg.text, "at": msg.at, "sig": sig]
        : ["from": msg.from, "text": msg.text, "at": msg.at, "sig": sig]
    doc.merge(edit) { $1 }
    var out: Doc = ["name": name, "kind": room ? "room" : "dm", "ns": room ? cGid : cCid,
                    "room": cRid, "id": msg.id, "expect": expect, "doc": doc,
                    "isMember": sender.member]
    out["memberPk"] = sender.memberPk
    out["pinnedPk"] = sender.pinnedPk
    return out
}
let payBase = ChatMessage(id: roomBase.id, thread: "pay:" + cSid, text: hard, at: cAt, seat: 2)
let keyMoved = Sender(cK2, memberPk: cOther.signPk, pinned: "same")
let dmRoomText = Chat.dmText(cGid, ChatMessage(id: roomBase.id, thread: "dm", text: hard, at: cAt,
                                               from: cMemA))
let roomOfDm = ChatMessage(id: dmBase.id, thread: "wallet", text: hard, at: cAt, seat: 2)
let roomDmText = Chat.signedText(cCid, cCid, roomOfDm)
let swiftCases: [Doc] = [
    try chatCase("room: honest", "yes", room: true, msg: roomBase, by: Sender(cK2)),
    try chatCase("room: payment thread", "yes", room: true, msg: payBase, by: Sender(cK2)),
    try chatCase("room: wrong key", "no", room: true, msg: roomBase,
                 by: Sender(cOther, memberPk: cK2.signPk, pinned: cK2.signPk)),
    try chatCase("room: wrong seat", "no", room: true, msg: roomBase,
                 by: Sender(cK2, memberPk: cK1.signPk, pinned: cK1.signPk), doc: ["seat": 1]),
    try chatCase("room: changed text", "no", room: true, msg: roomBase, by: Sender(cK2),
                 doc: ["text": hard + "!"]),
    try chatCase("room: changed thread", "no", room: true, msg: roomBase, by: Sender(cK2),
                 doc: ["thread": "pay:" + cSid]),
    try chatCase("room: changed time", "no", room: true, msg: roomBase, by: Sender(cK2),
                 doc: ["at": cAt + 1]),
    try chatCase("room: key changed", "changed", room: true, msg: roomBase, by: keyMoved),
    try chatCase("room: not a seat", "no", room: true, msg: roomBase,
                 by: Sender(cK2, member: false)),
    try chatCase("room: no pinned key", "no", room: true, msg: roomBase,
                 by: Sender(cK2, pinned: nil)),
    try chatCase("room: direct signature", "no", room: true, msg: roomBase, text: dmRoomText,
                 by: Sender(cK2)),
    try chatCase("room: text too long", "drop", room: true, msg: roomBase, by: Sender(cK2),
                 doc: ["text": String(repeating: "x", count: 2001)]),
    try chatCase("room: bad thread", "drop", room: true, msg: roomBase, by: Sender(cK2),
                 doc: ["thread": "other"]),
    try chatCase("room: time as text", "drop", room: true, msg: roomBase, by: Sender(cK2),
                 doc: ["at": "now"]),
    try chatCase("dm: honest", "yes", room: false, msg: dmBase, by: Sender(cK1)),
    try chatCase("dm: wrong key", "no", room: false, msg: dmBase,
                 by: Sender(cOther, memberPk: cK1.signPk, pinned: cK1.signPk)),
    try chatCase("dm: other member", "no", room: false, msg: dmBase,
                 by: Sender(cK1, memberPk: cK2.signPk, pinned: cK2.signPk), doc: ["from": cMemB]),
    try chatCase("dm: changed text", "no", room: false, msg: dmBase, by: Sender(cK1),
                 doc: ["text": hard + "!"]),
    try chatCase("dm: key changed", "changed", room: false, msg: dmBase,
                 by: Sender(cK1, memberPk: cOther.signPk, pinned: "same")),
    try chatCase("dm: unknown sender", "unknown", room: false, msg: dmBase,
                 by: Sender(cK1, pinned: nil)),
    try chatCase("dm: room signature", "no", room: false, msg: dmBase, text: roomDmText,
                 by: Sender(cK1)),
    try chatCase("dm: bad member id", "drop", room: false, msg: dmBase, by: Sender(cK1),
                 doc: ["from": cMemA.uppercased()]),
    try chatCase("dm: text as number", "drop", room: false, msg: dmBase, by: Sender(cK1),
                 doc: ["text": 5]),
]
check(swiftCases.count == 23, "the Swift cases")
check(misses(swiftCases).isEmpty, "the Swift code agrees with its own cases \(misses(swiftCases))")
let chatFile: Doc = ["hard": hard, "hardJson": Chat.jsString(hard), "cases": swiftCases]
try Engine.json(chatFile).write(toFile: dir + "/chat-swift.json", atomically: true, encoding: .utf8)


// The recipient check with memos. The web code made the cases and their verdicts (web.mjs make).
let payeeWeb = try textOf(dir + "/payees-web.json")
let payeeCases = payeeWeb["cases"] as! [Doc]
check(payeeCases.count == 39, "the payee cases \(payeeCases.count)")
func lowered(_ address: String) -> String? { address.lowercased() }
for c in payeeCases {
    let name = c.str("name") ?? "?", want = c.doc("expect")!
    let paid = RecipientCheck.outputs(of: ["lines": c["outputs"] as! [Doc]])
    let rc = RecipientCheck(payees: c["payees"] as! [Doc], paid: paid, total: c.int("total"),
                            norm: lowered)
    let rows = want["rows"] as! [Doc]
    check(rc.rows.count == rows.count, "payee rows: \(name)")
    for (got, w) in zip(rc.rows, rows) {
        check(got.ok == has(w["ok"]) && got.other == has(w["other"]), "payee verdict: \(name)")
        check(got.got == w.str("got"), "the memo on chain: \(name)")
    }
    check(rc.extra.count == want.int("extra"), "left outputs: \(name)")
    check((rc.match == true) == has(want["paid"]), "the whole payment: \(name)")
}
for c in payeeWeb["shown"] as! [Doc] {
    check(memoShown(c.str("text")!) == c.str("shown"), "memo shown: \(c.str("shown") ?? "?")")
}
// What the iPhone adds to the cases: lines of this wallet are no payment, and the words.
let ownLines: Doc = ["lines": [
    ["kind": "output", "who": "change (back to this wallet)", "value": 1,
     "memo_status": "empty"] as Doc,
    ["kind": "output", "who": "this wallet", "value": 2, "memo_status": "text", "memo": "x"] as Doc,
    ["kind": "spend", "who": "utest1a", "value": 3] as Doc,
    ["kind": "output", "who": "utest1a", "value": 5, "memo_status": "text", "memo": "rent"] as Doc,
]]
check(RecipientCheck.outputs(of: ownLines) == [PaidOutput(who: "utest1a", value: 5, memo: "rent")],
      "only the payments to others are checked")
let memoOnly = RecipientCheck(payees: [["to": "utest1a", "amount": 5, "memo": "rent"] as Doc],
                              paid: [PaidOutput(who: "utest1a", value: 5, memo: "Rent")],
                              total: 5, norm: lowered)
check(memoOnly.match == false && memoOnly.rows[0].other, "a payee paid with another memo")
check(memoOnly.warnings.count == 1 && memoOnly.warnings[0].contains("not the memo"), "memo warning")
let unreadable = RecipientCheck(payees: [["to": "utest1a", "amount": 5] as Doc],
                                paid: [PaidOutput(who: "utest1a", value: 5, memo: nil)],
                                total: 5, norm: lowered)
check(unreadable.match == false && unreadable.rows[0].got == nil && unreadable.rows[0].other,
      "an unreadable memo never matches")
let undecoded = RecipientCheck(payees: [], paid: nil, total: nil, norm: lowered)
check(undecoded.match == nil, "no outputs yet")
check(memoWords(nil) == "Memo is not text" && memoWords("") == "No memo", "words for no text")
check(memoWords("a\u{202E}b") == "a\u{FFFD}b", "a hiding character is not shown")

// Members of a chat: the own member, and one other member when only one new member is present.
func chatMember(_ pk: String?) -> Chat.Member { Chat.Member(name: "", signPk: pk) }
let key1 = Signed.newKey().signPk, key2 = Signed.newKey().signPk, key3 = Signed.newKey().signPk
func toPin(_ members: [String: Chat.Member], _ pinned: [String] = [], mine: String? = nil)
    -> [String] { Chat.membersToPin(members, pinned: pinned, mine: mine).sorted() }
check(toPin([m1: chatMember(key1)]) == [m1], "a joiner pins the first member")
check(toPin([m1: chatMember(key1), m2: chatMember(key2)], mine: m1) == [m1, m2],
      "the own member and one other")
check(toPin([m1: chatMember(key1), m2: chatMember(key2)], mine: m3) == [],
      "two new members and none of mine: none is pinned")
check(toPin([m1: chatMember(key1), m2: chatMember(key2), m3: chatMember(key3)], mine: m1) == [m1],
      "two other new members arrive together: only the own member is pinned")
check(toPin([m2: chatMember(key2), m3: chatMember(key3)], [m1], mine: m1) == [],
      "two new members next to a pinned one: none is pinned")
check(toPin([m1: chatMember(key1), m2: chatMember(key2)], [m1], mine: m1) == [m2],
      "one new member next to the pinned own member")
check(toPin([m1: chatMember(key1), m2: chatMember(key2)], [m1, m2], mine: m1) == [],
      "nothing new, nothing to pin")
check(toPin([m1: chatMember(key1), m2: chatMember("zz"), m3: chatMember(nil)], mine: m1) == [m1],
      "a member without a valid key does not count")
check(toPin([m1: chatMember(key1), "zz": chatMember(key2)], mine: m1) == [m1],
      "a member id that is not valid does not count")
check(toPin([m2: chatMember(key2)], mine: m1) == [m2], "the own member may still be missing")
// A link holder wrote a document with the earliest `at`, and the contact joined in the same
// message of the server: neither is pinned, and the chat shows its warning.
var raced: [String: String] = [:]
let racedMembers = [m1: chatMember(key1), m2: chatMember(key2), m3: chatMember(key3)]
for id in Chat.membersToPin(racedMembers, pinned: [], mine: m1) {
    _ = Chat.pinMember(&raced, chatGid, id, racedMembers[id]!.signPk!)
}
check(Set(Chat.pinnedMembers(raced, chatGid)) == [m1], "only the own member is pinned")
check(Chat.chatWarning(raced, chatGid, racedMembers, [])?.contains("third person") == true,
      "the chat shows its warning")

// A message document is opened once. A flood of documents costs one opening each, and a document
// that changes is opened again.
let floodKey = try Chat.newRoom().key
let floodPath = "groups/" + chatRoom + "/messages"
func sealedDoc(_ id: String, _ text: String, at: Int = 7) throws -> Chat.Sealed {
    let doc: Doc = ["seat": 1, "thread": "wallet", "text": text, "at": at, "sig": "s"]
    var out: Chat.Sealed = [:]
    for (field, value) in doc {
        out[field] = try Engine.call("secretSeal", [floodKey, floodPath + "/" + id + "\n" + field,
                                                     Engine.json(value)])
    }
    return out
}
var store: [String: Chat.Sealed] = [:]
for n in 0..<50 {
    let id = String(format: "%020d", n)
    store[id] = try sealedDoc(id, "m\(n)")
}
let firstPlan = Chat.plan(cache: [:], store: store)
check(firstPlan.keep.isEmpty && firstPlan.read.count == 50, "every new document is read")
let todo = firstPlan.read.map { (id: $0, sealed: store[$0]!) }
let opened = Chat.openAll(.room, floodPath, floodKey, todo)
check(opened.values.compactMap(\.message).count == 50, "every document opens")
check(opened["00000000000000000007"]?.message?.text == "m7", "the text of a document")
let secondPlan = Chat.plan(cache: opened, store: store)
check(secondPlan.keep.count == 50 && secondPlan.read.isEmpty,
      "an opened document is not read again")
store["00000000000000000010"] = try sealedDoc("00000000000000000010", "changed")
store["00000000000000000099"] = try sealedDoc("00000000000000000099", "new")
store["00000000000000000011"] = nil
let thirdPlan = Chat.plan(cache: opened, store: store)
check(Set(thirdPlan.read) == ["00000000000000000010", "00000000000000000099"],
      "a changed and a new document are read")
check(thirdPlan.keep.count == 48 && thirdPlan.keep["00000000000000000011"] == nil,
      "a removed one goes")
check(Chat.openMessage(.room, "x", floodPath + "/x", floodKey, try sealedDoc("y", "moved")) == nil,
      "a document moved to another path does not open")
check(Chat.openMessage(.room, "x", floodPath + "/x", floodKey, [:]) == nil, "an empty document")
check(Chat.maxDocs >= 10_000 && Chat.maxDocs <= 20_000, "the cap is below a flood of 20,000")

// A reorganisation that is deeper than the wallet can undo drops the saved state of the wallet.
let deepReorg = "the chain reorganised by more than 100 blocks. "
    + "Scan the wallet again from its birthday."
check(Chain.isDeepReorg(deepReorg), "the engine knows its words")
check(!Chain.isDeepReorg("lightwalletd: unavailable") && !Chain.isDeepReorg(""), "other errors")
let stateDir = FileManager.default.temporaryDirectory
    .appendingPathComponent("zigs-check-" + chatGid)
try MainActor.assumeIsolated {
    let chain = Chain(gid: chatGid, ufvk: "u", birthday: 5, groupKey: floodKey, net: .testnet)
    chain.directory = stateDir
    try "sealed state".write(to: chain.file, atomically: true, encoding: .utf8)
    check(FileManager.default.fileExists(atPath: chain.file.path), "a saved state")
    chain.dropSavedState()
    check(!FileManager.default.fileExists(atPath: chain.file.path), "the saved state is gone")
    check(chain.balance == nil && chain.received.isEmpty && chain.sent.isEmpty, "nothing is shown")
}
try? FileManager.default.removeItem(at: stateDir)

// The time of a cancel: the written time, else the time of the proposal.
check(Chat.cancelledAt(["cancelledAt": 9], created: 5) == 9, "a written time")
check(Chat.cancelledAt([:], created: 5) == 5, "no time")
check(Chat.cancelledAt(["cancelledAt": "x"], created: 5) == 5, "a bad time")
check(Chat.cancelledAt(["cancelledAt": 1e30], created: 5) == 5, "a time beyond any clock")
check(Chat.cancelledAt(["cancelledAt": true], created: 5) == 5, "true is no time")

// A file made here opens in the web app (web.mjs verify), with the same bytes.
var d = try BackupData.parse(plain)
d["groupName"] = "From iPhone"
let text = Engine.json(d)
let file = try Engine.call("backupSeal", [pass, text])
check(try Engine.call("backupOpen", [pass, file]).utf8.elementsEqual(text.utf8), "round trip")
try file.write(toFile: dir + "/swift-made.zigsbackup", atomically: true, encoding: .utf8)
check(initials("Mix (seat 1)") == "M" && initials("Ana Bo") == "AB" && initials("") == "?",
      "a seat label shows the initials of the name only")

print("swift backup checks ok")
