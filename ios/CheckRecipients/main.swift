import CryptoKit
import Foundation

typealias Doc = [String: Any]
@MainActor enum TestIO {
    static var items: [String: Data] = [:]
    static var key: Data?
    static var readFailure = false
    static var bookReadFailure = false
    static var writeFailure = false
    static func reset() { items = [:]; key = nil; readFailure = false; bookReadFailure = false; writeFailure = false }
}
// External engine adapter accepts only these literal synthetic fixture destinations. These
// tests verify normalization is requested; production uses unchanged ZigsCore.normalizeAddress.
enum Engine {
    static func json(_ value: Any) -> String {
        let opts: JSONSerialization.WritingOptions = [.fragmentsAllowed, .withoutEscapingSlashes]
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: opts) else { return "null" }
        return String(decoding: data, as: UTF8.self)
    }
    static func call(_ method: String, _ args: [Any]) throws -> String {
        let address = args.first as? String ?? ""
        guard method == "normalizeAddress", ["utest1fixturea", "utest1fixtureb", "u1fixturea"].contains(address.lowercased()) else {
            throw RecipientBookError("Synthetic invalid address")
        }
        return address.lowercased()
    }
}

@main struct CheckRecipients {
    @MainActor static func main() async throws {
        var checks = 0
        func check(_ okay: Bool, _ text: String) {
            guard okay else { fatalError("FAIL: " + text) }
            checks += 1
        }
        func rejected(_ run: () throws -> Void) -> Bool {
            do { try run(); return false } catch { return true }
        }
        func recipient(_ address: String = "utest1fixturea", network: String = "testnet", name: String = "Studio") throws -> PaymentRecipient {
            try PaymentRecipient.make(label: name, network: network, address: address,
                                      normalize: { try? Engine.call("normalizeAddress", [$0]) })
        }
        let a = try recipient(" UTEST1FIXTUREA ", name: " Studio ")
        let b = try recipient("utest1fixtureb", name: "Research team")
        let main = try recipient("u1fixturea", network: "mainnet", name: "Studio mainnet")
        check(a.name == "Studio" && a.address == "utest1fixturea", "trims and canonicalizes literal addresses")
        check(rejected { _ = try recipient(network: "devnet") }, "does not invent native Solana support")
        check(rejected { _ = try recipient("u1fixturea") }, "rejects wrong network")
        check(rejected { _ = try recipient("studio.zec") }, "rejects names")
        check(rejected { _ = try recipient("https://example.invalid/pay") }, "rejects payment links")
        check(rejected { _ = try recipient(name: " ") }, "rejects empty label")
        check(rejected { _ = try recipient(name: String(repeating: "x", count: 81)) }, "label length bound")
        check(try PaymentRecipient.decode(nil).isEmpty, "old vault has an empty book")
        check(try PaymentRecipient.decode(PaymentRecipient.record([a, b, main])) == [a, b, main], "typed round trip")
        check(PaymentRecipient.matching([a, b, main], query: "STUDIO", network: "testnet") == [a], "search remains network filtered")
        check(PaymentRecipient.matching([a, b, main], query: "fixtureb") == [b], "search full address")
        check(rejected { _ = try PaymentRecipient.decode(["version": 99, "entries": []]) }, "unknown version preserved as unreadable")
        check(rejected { _ = try PaymentRecipient.decode(PaymentRecipient.record([a, a])) }, "duplicate record ids rejected")
        var unknown = try PaymentRecipient.record([a]) as! Doc
        unknown["futureField"] = "preserve"
        check(rejected { _ = try PaymentRecipient.decode(unknown) }, "unknown envelope field cannot be discarded on edit")
        var entry = (unknown["entries"] as! [Doc])[0]
        entry["memo"] = "unsupported"
        check(rejected { _ = try PaymentRecipient.decode(["version": 1, "entries": [entry]]) }, "unknown recipient field is preserved as unreadable")
        TestIO.reset()
        let vault = Vault()
        check(!vault.locked && vault.recipients.isEmpty, "new unlocked device")
        try vault.putRecipients([a, b])
        check(Vault().recipients == [a, b], "survives relaunch on same device")
        let old = TestIO.items["zf-recipients"]
        TestIO.writeFailure = true
        check(rejected { try vault.putRecipients([a]) }, "save error surfaced")
        check(vault.recipients == [a, b] && TestIO.items["zf-recipients"] == old, "failed save rolls back model and storage")
        TestIO.writeFailure = false
        try vault.putRecipients([a])
        check(Vault().recipients == [a], "delete persists")
        let renamed = try recipient(name: "Studio renamed")
        let sameDestination = PaymentRecipient(id: a.id, name: renamed.name, asset: "ZEC", network: "testnet", type: "shielded", address: a.address)
        try vault.putRecipients([sameDestination])
        check(Vault().recipients.first?.name == "Studio renamed", "edit persists")
        TestIO.writeFailure = true
        check(rejected { try vault.turnOn() }, "failed sealed migration is reported")
        check(!vault.lockOn && TestIO.items["zf-recipients"] != nil && TestIO.items["zf-vault"] == nil,
              "failed migration preserves plain book and existing unlocked state")
        TestIO.writeFailure = false
        try vault.turnOn()
        check(TestIO.items["zf-recipients"] == nil && TestIO.items["zf-vault"] != nil, "lock migration leaves no plain recipient record")
        let locked = Vault()
        check(locked.locked && locked.recipients.isEmpty, "sealed book not loaded before unlock")
        check(rejected { try locked.putRecipients([a]) }, "locked mutation rejected")
        try await locked.unlock()
        check(locked.recipients == [sameDestination], "sealed book reopens with wallet lock")
        let sealedBefore = TestIO.items["zf-vault"]
        TestIO.writeFailure = true
        check(rejected { try locked.putRecipients([a, b]) }, "sealed write error surfaced")
        check(locked.recipients == [sameDestination] && TestIO.items["zf-vault"] == sealedBefore, "sealed save rolls back")
        TestIO.writeFailure = false
        try locked.putRecipients([a, b])
        let reopened = Vault()
        try await reopened.unlock()
        check(reopened.recipients == [a, b], "sealed updated book survives relaunch")
        let savedKey = TestIO.key
        TestIO.key = nil
        let missingKey = Vault()
        do { try await missingKey.unlock(); check(false, "missing lock key must fail") }
        catch { check(missingKey.locked && missingKey.recipients.isEmpty, "missing key cannot reveal sealed recipients") }
        TestIO.key = savedKey
        TestIO.reset()
        TestIO.items["zf-recipients"] = Data("damaged json".utf8)
        let damaged = Vault()
        check(damaged.recipientsUnavailable && !damaged.locked, "damaged book does not hide wallet keys")
        check(rejected { try damaged.putRecipients([a]) }, "damaged book is not overwritten")
        damaged.putKey("synthetic-wallet", "synthetic-key")
        check(TestIO.items["zf-recipients"] == Data("damaged json".utf8), "wallet save preserves unreadable book bytes")
        try damaged.turnOn()
        check(TestIO.items["zf-recipients"] == nil, "unreadable plain book is removed only after sealing")
        let opaque = Vault()
        try await opaque.unlock()
        check(opaque.recipientsUnavailable, "unreadable book remains unavailable after sealed unlock")
        opaque.putKey("synthetic-wallet", "synthetic-key")
        let box = try AES.GCM.SealedBox(combined: TestIO.items["zf-vault"]!)
        let plain = try AES.GCM.open(box, using: SymmetricKey(data: TestIO.key!), authenticating: Data("zigs vault v1".utf8))
        let payload = try JSONSerialization.jsonObject(with: plain) as! Doc
        let unreadableData = (payload["recipients"] as? Doc)?["unreadableData"] as? String
        check(unreadableData.flatMap { Data(base64Encoded: $0) } == Data("damaged json".utf8), "malformed book bytes survive migration and later wallet saves exactly")
        TestIO.reset()
        let nonfinite = Data("{\"version\":1,\"entries\":[],\"number\":1e999}".utf8)
        TestIO.items["zf-recipients"] = nonfinite
        let numericDamage = Vault()
        check(numericDamage.recipientsUnavailable, "invalid JSON numbers do not become editable entries")
        try numericDamage.turnOn()
        let numericBox = try AES.GCM.SealedBox(combined: TestIO.items["zf-vault"]!)
        let numericPlain = try AES.GCM.open(numericBox, using: SymmetricKey(data: TestIO.key!), authenticating: Data("zigs vault v1".utf8))
        let numericPayload = try JSONSerialization.jsonObject(with: numericPlain) as! Doc
        let numericBytes = (numericPayload["recipients"] as? Doc)?["unreadableData"] as? String
        check(numericBytes.flatMap { Data(base64Encoded: $0) } == nonfinite, "invalid-number bytes migrate without serialization loss")
        TestIO.reset()
        TestIO.bookReadFailure = true
        let optionalReadFailure = Vault()
        check(!optionalReadFailure.locked && optionalReadFailure.recipientsUnavailable, "optional book read failure does not block wallet keys")
        check(rejected { try optionalReadFailure.turnOn() }, "actual unreadable Keychain record prevents destructive migration")
        TestIO.reset()
        let futureRecord: Doc = ["version": 99, "entries": [], "future": ["kept": "exact"]]
        TestIO.items["zf-recipients"] = Data(Engine.json(futureRecord).utf8)
        let futureVault = Vault()
        check(futureVault.recipientsUnavailable, "unknown schema is not editable")
        try futureVault.turnOn()
        let futureUnlocked = Vault()
        try await futureUnlocked.unlock()
        futureUnlocked.putKey("synthetic-wallet", "synthetic-key")
        let futureBox = try AES.GCM.SealedBox(combined: TestIO.items["zf-vault"]!)
        let futurePlain = try AES.GCM.open(futureBox, using: SymmetricKey(data: TestIO.key!), authenticating: Data("zigs vault v1".utf8))
        let futurePayload = try JSONSerialization.jsonObject(with: futurePlain) as! Doc
        check((futurePayload["recipients"] as? NSDictionary)?.isEqual(to: futureRecord) == true,
              "unknown-schema fields survive sealing and wallet saves")
        TestIO.reset()
        TestIO.readFailure = true
        let unreadable = Vault()
        check(unreadable.locked, "Keychain read failure remains locked")
        check(rejected { try unreadable.putRecipients([a]) }, "read failure cannot overwrite saved recipients")
        print("Native recipient/Vault logic: \(checks) checks passed with isolated Keychain and normalization adapters. Physical Keychain and biometrics not tested.")
    }
}
