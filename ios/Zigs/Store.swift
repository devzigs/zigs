import Foundation

/// Client for the shared document store (cf/src/index.js). The server pushes every document over
/// one WebSocket, so reads use a local mirror. Values stay sealed here; GroupModel opens them.
@MainActor
final class Store {
    private(set) var docs: [String: Doc] = [:]
    private(set) var connected = false
    var onChange: (() -> Void)?

    private var task: URLSessionWebSocketTask?
    private var rid = 0
    private var waiting: [Int: CheckedContinuation<String, Error>] = [:]
    private var server: URL?

    func connect(server: URL) {
        self.server = server
        task?.cancel(with: .goingAway, reason: nil)
        open()
    }

    private func open() {
        guard let server, var parts = URLComponents(url: server, resolvingAgainstBaseURL: false) else {
            return
        }
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        parts.path = "/ws"
        guard let url = parts.url else { return }
        let t = URLSession.shared.webSocketTask(with: URLRequest(url: url))
        task = t
        t.resume()
        receive(t)
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            Task { @MainActor in self?.handle(result, on: t) }
        }
    }

    private func handle(_ result: Result<URLSessionWebSocketTask.Message, Error>, on t: URLSessionWebSocketTask) {
        guard t === task else { return }
        switch result {
        case .failure:
            dropped()
        case .success(.string(let text)):
            if let m = try? Engine.parse(text) as? Doc { apply(m) }
            receive(t)
        case .success:
            receive(t)
        }
    }

    private func apply(_ m: Doc) {
        switch m.str("type") {
        case "init":
            docs = [:]
            for d in m["docs"] as? [Doc] ?? [] {
                if let p = d.str("path"), let data = d.doc("data") { docs[p] = data }
            }
            connected = true
            onChange?()
        case "put":
            guard let p = m.str("path") else { return }
            docs[p] = m.doc("data")
            onChange?()
        case "reply":
            guard let id = m.int("rid"), let w = waiting.removeValue(forKey: id) else { return }
            if has(m["ok"]) {
                w.resume(returning: Engine.json(m["result"] ?? NSNull()))
            } else {
                w.resume(throwing: ZigsError(m.str("message") ?? "store error"))
            }
        default:
            break
        }
    }

    private func dropped() {
        connected = false
        for w in waiting.values { w.resume(throwing: ZigsError("connection lost")) }
        waiting = [:]
        onChange?()
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            self.open()
        }
    }

    /// Sends one operation and returns the server's result as JSON text.
    @discardableResult
    func send(_ msg: Doc) async throws -> String {
        guard connected, let t = task else { throw ZigsError("Not connected to the group server.") }
        rid += 1
        let id = rid
        var m = msg
        m["rid"] = id
        let text = Engine.json(m)
        return try await withCheckedThrowingContinuation { cont in
            waiting[id] = cont
            t.send(.string(text)) { [weak self] err in
                guard let err else { return }
                Task { @MainActor in self?.waiting.removeValue(forKey: id)?.resume(throwing: err) }
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
