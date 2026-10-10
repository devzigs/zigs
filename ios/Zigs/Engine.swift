import Foundation
import ZigsCore

typealias Doc = [String: Any]

struct ZigsError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// The Rust engine. Same method names and JSON shapes as the WASM build in the web app.
enum Engine {
    static func call(_ method: String, _ args: [Any]) throws -> String {
        let argJSON = json(args)
        guard let raw = zf_call(method, argJSON) else { throw ZigsError("engine returned nothing") }
        defer { zf_free(raw) }
        let out = try parse(String(cString: raw)) as? Doc
        if let ok = out?["ok"] as? String { return ok }
        throw ZigsError(out?["err"] as? String ?? "engine error in \(method)")
    }

    /// Calls a method whose result is a JSON object.
    static func object(_ method: String, _ args: [Any]) throws -> Doc {
        guard let d = try parse(call(method, args)) as? Doc else {
            throw ZigsError("\(method) did not return an object")
        }
        return d
    }

    /// Same output role as JavaScript's JSON.stringify.
    static func json(_ value: Any) -> String {
        let opts: JSONSerialization.WritingOptions = [.fragmentsAllowed, .withoutEscapingSlashes]
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: opts) else {
            return "null"
        }
        return String(decoding: data, as: UTF8.self)
    }

    static func parse(_ text: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
    }
}

/// JavaScript-style truthiness for values that came out of JSON.
func has(_ v: Any?) -> Bool {
    switch v {
    case nil, is NSNull: return false
    case let s as String: return !s.isEmpty
    case let b as Bool: return b
    default: return true
    }
}

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String? { self[k] as? String }
    func int(_ k: String) -> Int? { (self[k] as? NSNumber)?.intValue }
    func doc(_ k: String) -> Doc? { self[k] as? Doc }
}
