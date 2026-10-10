import Foundation
import Security

/// Device-only secrets: key shares, DKG secrets, signing nonces, and group keys.
/// They live in the Keychain and never leave this device.
@MainActor
final class Vault {
    private(set) var secrets: [String: Doc]
    private(set) var keys: [String: String]

    init() {
        secrets = Self.load("zf-secrets") as? [String: Doc] ?? [:]
        keys = Self.load("zf-keys") as? [String: String] ?? [:]
    }

    func sec(_ gid: String, _ seat: Int) -> Doc { secrets["\(gid):\(seat)"] ?? [:] }

    /// Merges `patch` into the seat's secrets, like Object.assign in the web app.
    func putSec(_ gid: String, _ seat: Int, _ patch: Doc) {
        var cur = sec(gid, seat)
        for (k, v) in patch { cur[k] = v }
        secrets["\(gid):\(seat)"] = cur
        Self.save("zf-secrets", secrets)
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
        Self.save("zf-keys", keys)
    }

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "app.zigs.vault",
         kSecAttrAccount as String: account]
    }

    private static func load(_ account: String) -> Any? {
        var q = query(account)
        q[kSecReturnData as String] = true
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else {
            return nil
        }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private static func save(_ account: String, _ value: Any) {
        let data = Data(Engine.json(value).utf8)
        let q = query(account)
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil)
        }
    }
}
