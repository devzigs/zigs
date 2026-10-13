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

// A file made here opens in the web app (web.mjs verify), with the same bytes.
var d = try BackupData.parse(plain)
d["groupName"] = "From iPhone"
let text = Engine.json(d)
let file = try Engine.call("backupSeal", [pass, text])
check(try Engine.call("backupOpen", [pass, file]).utf8.elementsEqual(text.utf8), "round trip")
try file.write(toFile: dir + "/swift-made.zigsbackup", atomically: true, encoding: .utf8)
print("swift backup checks ok")
