import Foundation

/// Payment destinations belong to this device, rather than to a wallet or a chat contact.
/// Stored in the existing Vault; intentionally excluded from key-share recovery files.
struct PaymentRecipient: Codable, Equatable, Identifiable {
    let id: String
    var name: String
    let asset: String
    var network: String
    let type: String
    var address: String

    static func make(id: String = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(), label: String, network: String,
                     address: String, normalize: (String) -> String?) throws -> Self {
        let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let literal = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 80 else {
            throw RecipientBookError("Enter a recipient name of 1 to 80 characters.")
        }
        guard ["mainnet", "testnet"].contains(network),
              !literal.contains(where: { $0.isWhitespace }),
              let canonical = normalize(literal),
              canonical.hasPrefix(network == "mainnet" ? "u1" : "utest1") else {
            throw RecipientBookError("Enter a shielded Zcash address for the selected network. Names and payment links cannot be saved here.")
        }
        return Self(id: id, name: name, asset: "ZEC", network: network,
                    type: "shielded", address: canonical)
    }

    static func decode(_ record: Any?) throws -> [Self] {
        guard let record else { return [] }
        guard let dictionary = record as? [String: Any], Set(dictionary.keys) == ["version", "entries"],
              let entries = dictionary["entries"] as? [[String: Any]],
              entries.allSatisfy({ Set($0.keys) == ["id", "name", "asset", "network", "type", "address"] }),
              JSONSerialization.isValidJSONObject(record),
              let data = try? JSONSerialization.data(withJSONObject: record),
              let envelope = try? JSONDecoder().decode(RecipientEnvelope.self, from: data),
              envelope.version == 1 else { throw RecipientBookError.damaged }
        let rows = envelope.entries
        guard rows.count <= 500, Set(rows.map(\.id)).count == rows.count,
              Set(rows.map { $0.network + ":" + $0.address }).count == rows.count,
              rows.allSatisfy({ $0.id.count == 32 && $0.id.allSatisfy({ "0123456789abcdef".contains($0) })
                  && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.name.count <= 80
                  && $0.asset == "ZEC" && $0.type == "shielded"
                  && ["mainnet", "testnet"].contains($0.network)
                  && !$0.address.contains(where: { $0.isWhitespace })
                  && $0.address.hasPrefix($0.network == "mainnet" ? "u1" : "utest1") }) else {
            throw RecipientBookError.damaged
        }
        return rows
    }

    static func record(_ rows: [Self]) throws -> Any {
        let data = try JSONEncoder().encode(RecipientEnvelope(version: 1, entries: rows))
        return try JSONSerialization.jsonObject(with: data)
    }

    static func matching(_ rows: [Self], query: String, network: String? = nil) -> [Self] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return rows.filter { (network == nil || $0.network == network)
            && (q.isEmpty || $0.name.localizedCaseInsensitiveContains(q)
                || $0.address.localizedCaseInsensitiveContains(q)) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

private struct RecipientEnvelope: Codable {
    let version: Int
    let entries: [PaymentRecipient]
}

struct RecipientBookError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
    static let damaged = RecipientBookError("The saved address book could not be read. It has been preserved; no changes can be saved.")
}
