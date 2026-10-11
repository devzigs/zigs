import CryptoKit
import Foundation
import LocalAuthentication
import Security

struct VaultError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

/// Device-only secrets: key shares, DKG secrets, signing nonces, and group keys.
/// They live in the Keychain and never leave this device. With the lock on, they are stored
/// sealed with a vault key, and the Keychain gives that key out only after Face ID or the passcode.
@MainActor
final class Vault {
    private(set) var secrets: [String: Doc] = [:]
    private(set) var keys: [String: String] = [:]
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
            secrets = Self.parse(s) as? [String: Doc] ?? [:]
            keys = Self.parse(k) as? [String: String] ?? [:]
            return true
        } catch {
            return false
        }
    }

    func sec(_ gid: String, _ seat: Int) -> Doc { secrets["\(gid):\(seat)"] ?? [:] }

    /// Merges `patch` into the seat's secrets, like Object.assign in the web app.
    func putSec(_ gid: String, _ seat: Int, _ patch: Doc) {
        var cur = sec(gid, seat)
        for (k, v) in patch { cur[k] = v }
        secrets["\(gid):\(seat)"] = cur
        persist()
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

    /// Seals the secrets with a new vault key that only Face ID or the passcode releases.
    func turnOn() throws {
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
        guard let box = try? Self.read("zf-vault"), (try? Self.open(box, key)) != nil else {
            vaultKey = nil
            Self.delete("zf-vault")
            Self.delete("zf-vault-key")
            throw VaultError("The locked copy was not saved. The keys stay unlocked.")
        }
        Self.delete("zf-secrets")
        Self.delete("zf-keys")
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
        vaultKey = key
        locked = false
    }

    /// Deletes the sealed secrets that this device can no longer open.
    func forget() {
        // Only a sealed record is deleted: plain secrets that could not be read must stay.
        guard (try? Self.exists("zf-vault")) == true else { return }
        Self.delete("zf-vault")
        Self.delete("zf-vault-key")
        secrets = [:]
        locked = false
        persist()
    }

    private func persist() {
        if locked { return }
        guard let vaultKey else {
            Self.write("zf-secrets", Data(Engine.json(secrets).utf8))
            Self.write("zf-keys", Data(Engine.json(keys).utf8))
            return
        }
        let plain = Data(Engine.json(["secrets": secrets, "keys": keys] as Doc).utf8)
        if let box = try? AES.GCM.seal(plain, using: vaultKey, authenticating: Self.aad).combined {
            Self.write("zf-vault", box)
        }
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

    private static func write(_ account: String, _ data: Data) {
        let q = query(account)
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil)
        }
    }

    private static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
