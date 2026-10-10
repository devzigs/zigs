import Foundation

/// Minimal grpc-web client for lightwalletd: only SendTransaction, which is one unary call.
enum Lightwalletd {
    static func send(hex: String, to server: URL) async throws {
        guard let tx = Data(hex: hex) else { throw ZigsError("The transaction hex is not valid.") }
        // RawTransaction { bytes data = 1; uint64 height = 2; } with height left at 0.
        var msg = Data([0x0a])
        msg.append(varint(UInt64(tx.count)))
        msg.append(tx)
        var body = Data([0x00])
        body.append(contentsOf: withUnsafeBytes(of: UInt32(msg.count).bigEndian, Array.init))
        body.append(msg)

        var req = URLRequest(url: server.appendingPathComponent("cash.z.wallet.sdk.rpc.CompactTxStreamer/SendTransaction"))
        req.httpMethod = "POST"
        req.setValue("application/grpc-web+proto", forHTTPHeaderField: "Content-Type")
        req.setValue("1", forHTTPHeaderField: "X-Grpc-Web")
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let headers = (resp as? HTTPURLResponse)?.allHeaderFields ?? [:]
        if let status = headers["grpc-status"] as? String, status != "0" {
            throw ZigsError("lightwalletd: \(headers["grpc-message"] as? String ?? "status \(status)")")
        }
        try check(sendResponse: data)
    }

    /// Reads SendResponse { int32 errorCode = 1; string errorMessage = 2; } from the first frame.
    private static func check(sendResponse data: Data) throws {
        let bytes = [UInt8](data)
        guard bytes.count >= 5, bytes[0] == 0 else { return }
        let len = Int(bytes[1]) << 24 | Int(bytes[2]) << 16 | Int(bytes[3]) << 8 | Int(bytes[4])
        guard bytes.count >= 5 + len else { throw ZigsError("lightwalletd sent a short reply.") }
        var p = 5, code = 0, message = ""
        while p < 5 + len {
            let tag = bytes[p]; p += 1
            let v = readVarint(bytes, &p)
            if tag == 0x08 { code = Int(Int32(truncatingIfNeeded: v)) }
            if tag == 0x12 {
                message = String(decoding: bytes[p..<min(p + Int(v), bytes.count)], as: UTF8.self)
                p += Int(v)
            }
        }
        if code != 0 { throw ZigsError("The network rejected the transaction: \(message)") }
    }

    private static func varint(_ v: UInt64) -> Data {
        var v = v, out = Data()
        while v >= 0x80 { out.append(UInt8(v & 0x7f) | 0x80); v >>= 7 }
        out.append(UInt8(v))
        return out
    }

    private static func readVarint(_ b: [UInt8], _ p: inout Int) -> UInt64 {
        var v: UInt64 = 0, shift: UInt64 = 0
        while p < b.count {
            let byte = b[p]; p += 1
            v |= UInt64(byte & 0x7f) << shift
            if byte < 0x80 { break }
            shift += 7
        }
        return v
    }
}

extension Data {
    init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var out = Data(capacity: hex.count / 2)
        var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
            out.append(b)
            i = j
        }
        self = out
    }
}
