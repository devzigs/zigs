import Foundation

/// Minimal grpc-web client for lightwalletd. Replies come back as raw protobuf messages; the
/// engine decodes blocks and tree states itself, so this file only frames bytes.
enum Lightwalletd {
    private static let service = "cash.z.wallet.sdk.rpc.CompactTxStreamer/"

    /// Height of the chain tip (GetLatestBlock). A short timeout picks a live server quickly.
    static func latestHeight(_ server: URL, timeout: TimeInterval = 8) async throws -> Int {
        let reply = try await call(server, "GetLatestBlock", Data(), timeout: timeout)
        // BlockID { uint64 height = 1; bytes hash = 2; }
        guard let msg = reply.first, let h = field1Varint(msg) else { throw ZigsError("lightwalletd sent no height.") }
        return h
    }

    /// The TreeState message at `height` (GetTreeState), as protobuf bytes for the engine.
    static func treeState(_ server: URL, _ height: Int) async throws -> Data {
        let reply = try await call(server, "GetTreeState", blockID(height))
        guard let msg = reply.first else { throw ZigsError("lightwalletd sent no tree state.") }
        return msg
    }

    /// CompactBlock messages from `start` to `end`, both included (GetBlockRange).
    static func blocks(_ server: URL, _ start: Int, _ end: Int) async throws -> [Data] {
        var range = field(1, blockID(start))
        range.append(field(2, blockID(end)))
        return try await call(server, "GetBlockRange", range, timeout: 60)
    }

    /// Tries each server in order and stops at the first one that accepts the transaction.
    static func send(hex: String, toFirstOf servers: [URL]) async throws {
        var errors: [String] = []
        for server in servers {
            do { return try await send(hex: hex, to: server) } catch {
                errors.append("\(server.host ?? server.absoluteString): \(error.localizedDescription)")
            }
        }
        throw ZigsError(errors.joined(separator: "; "))
    }

    static func send(hex: String, to server: URL) async throws {
        guard let tx = Data(hex: hex) else { throw ZigsError("The transaction hex is not valid.") }
        // RawTransaction { bytes data = 1; uint64 height = 2; } with height left at 0.
        let reply = try await call(server, "SendTransaction", field(1, tx))
        // SendResponse { int32 errorCode = 1; string errorMessage = 2; }
        guard let msg = reply.first else { return }
        let bytes = [UInt8](msg)
        var p = 0, code = 0, message = ""
        while p < bytes.count {
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

    // MARK: grpc-web framing

    /// Posts one request frame and returns the data frames of the reply.
    private static func call(_ server: URL, _ method: String, _ message: Data,
                             timeout: TimeInterval = 20) async throws -> [Data] {
        var body = Data([0x00])
        body.append(contentsOf: withUnsafeBytes(of: UInt32(message.count).bigEndian, Array.init))
        body.append(message)
        var req = URLRequest(url: server.appendingPathComponent(service + method))
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        req.setValue("application/grpc-web+proto", forHTTPHeaderField: "Content-Type")
        req.setValue("1", forHTTPHeaderField: "X-Grpc-Web")
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let http = resp as? HTTPURLResponse
        if let code = http?.statusCode, code != 200 { throw ZigsError("lightwalletd answered HTTP \(code).") }
        var status = http?.value(forHTTPHeaderField: "grpc-status")
        var message = http?.value(forHTTPHeaderField: "grpc-message")
        var frames: [Data] = []
        let bytes = [UInt8](data)
        var p = 0
        while p + 5 <= bytes.count {
            let flag = bytes[p]
            let len = Int(bytes[p + 1]) << 24 | Int(bytes[p + 2]) << 16 | Int(bytes[p + 3]) << 8 | Int(bytes[p + 4])
            p += 5
            guard p + len <= bytes.count else { throw ZigsError("lightwalletd sent a short reply.") }
            let chunk = Data(bytes[p..<(p + len)])
            p += len
            if flag & 0x80 == 0 { frames.append(chunk); continue }
            // Trailer frame: "grpc-status: 0\r\ngrpc-message: …"
            for line in String(decoding: chunk, as: UTF8.self).split(whereSeparator: \.isNewline) {
                let kv = line.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                guard kv.count == 2 else { continue }
                if kv[0].lowercased() == "grpc-status" { status = kv[1] }
                if kv[0].lowercased() == "grpc-message" { message = kv[1].removingPercentEncoding ?? kv[1] }
            }
        }
        if let status, status != "0" { throw ZigsError("lightwalletd: \(message ?? "status \(status)")") }
        return frames
    }

    // MARK: Protobuf helpers

    private static func blockID(_ height: Int) -> Data {
        var d = Data([0x08])
        d.append(varint(UInt64(height)))
        return d
    }

    /// A length-delimited field (wire type 2).
    private static func field(_ number: UInt8, _ value: Data) -> Data {
        var d = Data([number << 3 | 2])
        d.append(varint(UInt64(value.count)))
        d.append(value)
        return d
    }

    private static func field1Varint(_ msg: Data) -> Int? {
        let b = [UInt8](msg)
        var p = 0
        while p < b.count {
            let tag = b[p]; p += 1
            if tag == 0x08 { return Int(readVarint(b, &p)) }
            guard tag & 7 == 2 else { return nil }
            p += Int(readVarint(b, &p))
        }
        return nil
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
