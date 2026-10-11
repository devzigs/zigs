import Foundation

/// Client for the shared document store (cf/src/index.js). The server keeps each group in its own
/// store, so the app opens one WebSocket per group it holds a key for and merges them into one
/// local mirror. Values stay sealed here; GroupModel opens them.
@MainActor
final class Store {
    private(set) var docs: [String: Doc] = [:]
    var onChange: (() -> Void)?

    @MainActor private final class Socket {
        var task: URLSessionWebSocketTask?
        var loaded = false
        var delay: Double = 1
        var waiting: [Int: CheckedContinuation<String, Error>] = [:]
    }

    private var sockets: [String: Socket] = [:]
    private var rid = 0
    private var server: URL?

    /// True once every joined group has sent its documents.
    var connected: Bool { sockets.values.allSatisfy(\.loaded) }

    func connect(server: URL) {
        self.server = server
        let gids = Array(sockets.keys)
        for s in sockets.values { s.task?.cancel(with: .goingAway, reason: nil) }
        sockets = [:]
        docs = [:]
        for gid in gids { join(gid) }
    }

    /// Opens the socket for one group; does nothing if it is already open.
    func join(_ gid: String) {
        guard sockets[gid] == nil, gid.range(of: "^[0-9a-f]{20}$", options: .regularExpression) != nil else { return }
        let s = Socket()
        sockets[gid] = s
        open(gid, s)
    }

    private func open(_ gid: String, _ s: Socket) {
        guard let server, var parts = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return }
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        parts.path = "/ws"
        parts.queryItems = [URLQueryItem(name: "g", value: gid)]
        guard let url = parts.url else { return }
        let t = URLSession.shared.webSocketTask(with: URLRequest(url: url))
        s.task = t
        t.resume()
        receive(gid, s, t)
    }

    private func receive(_ gid: String, _ s: Socket, _ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            Task { @MainActor in self?.handle(result, gid, s, t) }
        }
    }

    private func handle(_ result: Result<URLSessionWebSocketTask.Message, Error>, _ gid: String, _ s: Socket,
                        _ t: URLSessionWebSocketTask) {
        guard sockets[gid] === s, s.task === t else { return }
        switch result {
        case .failure:
            dropped(gid, s)
        case .success(.string(let text)):
            if let m = try? Engine.parse(text) as? Doc { apply(m, gid, s) }
            receive(gid, s, t)
        case .success:
            receive(gid, s, t)
        }
    }

    private func apply(_ m: Doc, _ gid: String, _ s: Socket) {
        switch m.str("type") {
        case "init":
            let prefix = "groups/" + gid
            docs = docs.filter { $0.key != prefix && !$0.key.hasPrefix(prefix + "/") }
            for d in m["docs"] as? [Doc] ?? [] {
                if let p = d.str("path"), let data = d.doc("data") { docs[p] = data }
            }
            s.loaded = true
            s.delay = 1
            onChange?()
        case "put":
            guard let p = m.str("path") else { return }
            docs[p] = m.doc("data")
            onChange?()
        case "reply":
            guard let id = m.int("rid"), let w = s.waiting.removeValue(forKey: id) else { return }
            if has(m["ok"]) {
                w.resume(returning: Engine.json(m["result"] ?? NSNull()))
            } else {
                w.resume(throwing: ZigsError(m.str("message") ?? "store error"))
            }
        default:
            break
        }
    }

    /// A refused or dropped socket retries with a growing delay, so a busy server is not hammered.
    private func dropped(_ gid: String, _ s: Socket) {
        s.loaded = false
        for w in s.waiting.values { w.resume(throwing: ZigsError("connection lost")) }
        s.waiting = [:]
        onChange?()
        let wait = s.delay
        s.delay = min(s.delay * 2, 30)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(wait))
            if self.sockets[gid] === s { self.open(gid, s) }
        }
    }

    /// Sends one operation to the group that owns `msg["path"]` and returns the result as JSON text.
    @discardableResult
    func send(_ msg: Doc) async throws -> String {
        let parts = (msg.str("path") ?? "").split(separator: "/")
        guard parts.count >= 2, parts[0] == "groups", let s = sockets[String(parts[1])] else {
            throw ZigsError("Not connected to this group.")
        }
        guard s.loaded, let t = s.task else { throw ZigsError("Not connected to the group server.") }
        rid += 1
        let id = rid
        var m = msg
        m["rid"] = id
        let text = Engine.json(m)
        return try await withCheckedThrowingContinuation { cont in
            s.waiting[id] = cont
            t.send(.string(text)) { err in
                guard let err else { return }
                Task { @MainActor in s.waiting.removeValue(forKey: id)?.resume(throwing: err) }
            }
        }
    }

    func set(_ path: String, _ data: Doc) async throws {
        try await send(["op": "set", "path": path, "data": data])
    }

    func update(_ path: String, _ data: Doc) async throws {
        try await send(["op": "update", "path": path, "data": data])
    }

    func acquire(_ path: String, holder: String, ttlMs: Int) async throws -> Bool {
        let r = try await send(["op": "acquire", "path": path, "holder": holder, "ttlMs": ttlMs])
        return has((try? Engine.parse(r) as? Doc)?["acquired"])
    }

    /// Direct children of a collection path, keyed by document id.
    func children(_ path: String) -> [String: Doc] {
        var out: [String: Doc] = [:]
        let prefix = path + "/"
        for (p, d) in docs where p.hasPrefix(prefix) && !p.dropFirst(prefix.count).contains("/") {
            out[String(p.dropFirst(prefix.count))] = d
        }
        return out
    }
}
