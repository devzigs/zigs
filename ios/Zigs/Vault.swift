import CryptoKit
import Foundation
import LocalAuthentication
import Security

struct VaultError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

/// Device-only secrets: key shares, DKG secrets, signing nonces, group keys, and the direct chats
/// (their secrets and the personal signing key). They live in the Keychain and never leave this
/// device. With the lock on, they are stored sealed with a vault key, and the Keychain gives that
/// key out only after Face ID or the passcode.
@MainActor
final class Vault {
    private(set) var secrets: [String: Doc] = [:]
    private(set) var keys: [String: String] = [:]
    /// The direct chats, in the shape of ChatBook.doc.
    private(set) var chats: Doc = [:]
    private(set) var recipients: [PaymentRecipient] = []
    private(set) var recipientsUnavailable = false
    private var recipientReadFailed = false
    /// Preserve an unreadable sealed value while other wallet records continue to save.
    private var recipientRecord: Any?
    /// The secrets are not loaded: the lock is on, or the Keychain could not answer yet.
    /// Nothing is written while locked, so a failed read cannot overwrite saved secrets.
    private(set) var locked = true
    private var vaultKey: SymmetricKey?
    var lockOn: Bool { vaultKey != nil }

    private static let aad = Data("zigs vault v1".utf8)

    init() {
        if (try? Self.exists("zf-vault")) == false { locked = !loadPlain() }
    }

    private func loadPlain() -> Bool {
        do {
            let s = try Self.read("zf-secrets"), k = try Self.read("zf-keys")
            let c = try Self.read("zf-chats")
            let r: Data?
            var bookReadFailed = false
            do { r = try Self.read("zf-recipients") }
            catch { r = nil; bookReadFailed = true }
            secrets = Self.parse(s) as? [String: Doc] ?? [:]
            keys = Self.parse(k) as? [String: String] ?? [:]
            chats = Self.parse(c) as? Doc ?? [:]
            // A readable but damaged optional book must not prevent access to wallet keys.
            // Keep its exact bytes if it needs to move into the sealed Vault later.
            loadRecipients(r.map {
                if let value = Self.parse($0), JSONSerialization.isValidJSONObject(value) { return value }
                return ["unreadableData": $0.base64EncodedString()]
            })
            recipientReadFailed = bookReadFailed
            if bookReadFailed { recipientsUnavailable = true }
            return true
        } catch {
            return false
        }
    }

    func sec(_ gid: String, _ seat: Int) -> Doc { secrets["\(gid):\(seat)"] ?? [:] }

    /// Merges `patch` into the seat's secrets, like Object.assign in the web app.
    /// Returns false if the Keychain did not save it.
    @discardableResult
    func putSec(_ gid: String, _ seat: Int, _ patch: Doc) -> Bool {
        var cur = sec(gid, seat)
        for (k, v) in patch { cur[k] = v }
        cur["backedUp"] = nil   // the flag of an older version, see BackupData.backedUp
        secrets["\(gid):\(seat)"] = cur
        return persist()
    }

    /// Puts the seat's secrets back as they were: `nil` removes them. Used to undo a restore.
    @discardableResult
    func setSec(_ gid: String, _ seat: Int, _ doc: Doc?) -> Bool {
        secrets["\(gid):\(seat)"] = doc
        return persist()
    }

    /// Saves the direct chats. Returns false, and keeps the old ones, if the Keychain did not
    /// save them.
    func putChats(_ doc: Doc) -> Bool {
        let old = chats
        chats = doc
        if persist() { return true }
        chats = old
        return false
    }

    private func loadRecipients(_ record: Any?) {
        recipientRecord = record
        recipientReadFailed = false
        do {
            recipients = try PaymentRecipient.decode(record)
            guard recipients.allSatisfy({ (try? Engine.call("normalizeAddress", [$0.address])) == $0.address }) else {
                throw RecipientBookError.damaged
            }
            recipientsUnavailable = false
        } catch {
            recipients = []
            recipientsUnavailable = true
        }
    }

    /// An atomic record update. On failure the UI continues to show the last saved book.
    func putRecipients(_ rows: [PaymentRecipient]) throws {
        guard !locked else { throw RecipientBookError("Unlock this device before changing the address book.") }
        guard !recipientsUnavailable else { throw RecipientBookError.damaged }
        guard rows.count <= 500 else { throw RecipientBookError("The address book can hold up to 500 recipients.") }
        let destinations = rows.map { $0.network + ":" + $0.address }
        guard Set(destinations).count == destinations.count else {
            throw RecipientBookError("This address is already saved for this network. Edit its existing entry instead.")
        }
        let next = try PaymentRecipient.record(rows)
        _ = try PaymentRecipient.decode(next)
        let old = recipientRecord, oldRows = recipients
        recipientRecord = next
        recipients = rows
        // Plain Keychain records are independent: saving a recipient must not partly succeed
        // because an unrelated wallet-record write failed. A sealed Vault is one atomic item.
        let saved = vaultKey == nil
            ? Self.write("zf-recipients", Data(Engine.json(next).utf8)) : persist()
        guard saved else {
            recipientRecord = old
            recipients = oldRows
            throw RecipientBookError("The address book was not saved. Your previous recipients are unchanged. Try again after unlocking the device.")
        }
    }

    /// Seats this device holds secrets for in group `gid`.
    func seats(in gid: String) -> [Int] {
        secrets.keys.compactMap { k in
            let parts = k.split(separator: ":")
            return parts.count == 2 && parts[0] == gid ? Int(parts[1]) : nil
        }.sorted()
    }

    func putKey(_ gid: String, _ key: String) {
        keys[gid] = key
        persist()
    }

    /// Removes a wallet secret. Used to undo a restore that added it.
    func removeKey(_ gid: String) {
        keys[gid] = nil
        persist()
    }

    /// Seals the secrets with a new vault key that only Face ID or the passcode releases.
    func turnOn() throws {
        guard !recipientReadFailed else {
            throw VaultError("The Keychain could not read the address book. Its data has been preserved. Unlock the device, then try turning on the lock again.")
        }
        var cfError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &cfError) else {
            throw VaultError("This device cannot protect a key with Face ID.")
        }
        let key = SymmetricKey(size: .bits256)
        SecItemDelete(Self.query("zf-vault-key") as CFDictionary)
        var add = Self.query("zf-vault-key")
        add[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        add[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw VaultError("The lock was not turned on (Keychain error \(status)). "
                + "Set a device passcode, then try again.")
        }
        vaultKey = key
        persist()
        // The sealed copy must open before the plain copy goes.
        guard let box = try? Self.read("zf-vault"), let sealed = try? Self.open(box, key),
              Self.recipientData(sealed["recipients"]) == Self.recipientData(recipientRecord) else {
            vaultKey = nil
            Self.delete("zf-vault")
            Self.delete("zf-vault-key")
            throw VaultError("The locked copy was not saved. The keys stay unlocked.")
        }
        Self.delete("zf-secrets")
        Self.delete("zf-keys")
        Self.delete("zf-chats")
        Self.delete("zf-recipients")
    }

    /// Asks for Face ID or the passcode, then opens the sealed secrets.
    func unlock() async throws {
        guard let box = try Self.read("zf-vault") else {
            guard loadPlain() else {
                throw VaultError("The Keychain is not ready. Unlock the device, then try again.")
            }
            locked = false
            return
        }
        let key = SymmetricKey(data: try await Self.readVaultKey())
        guard let doc = try? Self.open(box, key) else {
            throw VaultError("The saved keys do not open with this device's lock key.")
        }
        secrets = doc["secrets"] as? [String: Doc] ?? [:]
        keys = doc["keys"] as? [String: String] ?? [:]
        chats = doc["chats"] as? Doc ?? [:]
        loadRecipients(doc["recipients"])
        vaultKey = key
        locked = false
    }

    /// Deletes the sealed secrets that this device can no longer open.
    func forget() {
        // Only a sealed record is deleted: plain secrets that could not be read must stay.
        guard (try? Self.exists("zf-vault")) == true else { return }
        Self.delete("zf-vault")
        Self.delete("zf-vault-key")
        Self.delete("zf-recipients")
        secrets = [:]
        recipients = []
        recipientRecord = nil
        recipientsUnavailable = false
        recipientReadFailed = false
        locked = false
        persist()
    }

    @discardableResult
    private func persist() -> Bool {
        if locked { return false }
        guard let vaultKey else {
            let secretsSaved = Self.write("zf-secrets", Data(Engine.json(secrets).utf8))
            let chatsSaved = Self.write("zf-chats", Data(Engine.json(chats).utf8))
            let keysSaved = Self.write("zf-keys", Data(Engine.json(keys).utf8))
            return keysSaved && secretsSaved && chatsSaved
        }
        var all: Doc = ["secrets": secrets, "keys": keys, "chats": chats]
        all["recipients"] = recipientRecord
        let plain = Data(Engine.json(all).utf8)
        guard let box = try? AES.GCM.seal(plain, using: vaultKey, authenticating: Self.aad).combined else {
            return false
        }
        return Self.write("zf-vault", box)
    }

    private static func open(_ box: Data, _ key: SymmetricKey) throws -> Doc {
        let sealed = try AES.GCM.SealedBox(combined: box)
        let plain = try AES.GCM.open(sealed, using: key, authenticating: aad)
        guard let doc = parse(plain) as? Doc else {
            throw VaultError("The saved keys are damaged.")
        }
        return doc
    }

    /// Reads the vault key off the main thread: the Keychain shows the Face ID prompt and waits.
    private nonisolated static func readVaultKey() async throws -> Data {
        try await Task.detached {
            let context = LAContext()
            context.localizedReason = "Unlock your key shares"
            var q = query("zf-vault-key")
            q[kSecReturnData as String] = true
            q[kSecUseAuthenticationContext as String] = context
            var out: CFTypeRef?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            if let data = out as? Data, status == errSecSuccess { return data }
            throw VaultError(unlockFailure(status))
        }.value
    }

    private nonisolated static func unlockFailure(_ status: OSStatus) -> String {
        switch status {
        case errSecUserCanceled: return "Unlock was cancelled."
        case errSecItemNotFound:
            return "The lock key is gone. iOS deletes it when the device passcode is turned off, "
                + "so the key shares on this device cannot be opened."
        default: return "Zigs could not unlock (Keychain error \(status))."
        }
    }

    private nonisolated static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "app.zigs.vault",
         kSecAttrAccount as String: account]
    }

    private static func parse(_ data: Data?) -> Any? {
        data.flatMap { try? JSONSerialization.jsonObject(with: $0) }
    }

    private static func recipientData(_ record: Any?) -> Data? {
        record.flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys, .fragmentsAllowed]) }
    }

    private static func exists(_ account: String) throws -> Bool { try read(account) != nil }

    /// Returns nil if the item does not exist, and throws on any other Keychain failure.
    private static func read(_ account: String) throws -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = out as? Data else {
            throw VaultError("Zigs could not read its keys (Keychain error \(status)).")
        }
        return data
    }

    @discardableResult
    private static func write(_ account: String, _ data: Data) -> Bool {
        let q = query(account)
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            return SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }

    private static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
