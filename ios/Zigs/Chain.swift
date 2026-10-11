import Foundation
import Observation

/// Per-network servers and limits. Mainnet uses a third-party light-wallet server, so the group
/// server and the chain server have different operators (see PRIVACY.md).
struct ZcashNetwork: Sendable {
    let label: String
    let servers: [URL]
    let explorer: String
    let prefix: String
    /// Unaudited code holds real money only up to this many zatoshis.
    let cap: Int?
    let faucet: URL?

    static let testnet = ZcashNetwork(
        label: "Testnet",
        servers: [URL(string: "https://lwd.zigs.app")!, URL(string: "https://zcash-testnet.chainsafe.dev")!],
        explorer: "https://testnet.zecblock.com/tx/", prefix: "utest1", cap: nil,
        faucet: URL(string: "https://zcashfaucet.jinolabs.xyz/"))
    static let mainnet = ZcashNetwork(
        label: "Mainnet", servers: [URL(string: "https://zcash-mainnet.chainsafe.dev")!],
        explorer: "https://zecblock.com/tx/", prefix: "u1", cap: 50_000_000, faucet: nil)

    static func of(_ id: String?) -> ZcashNetwork { id == "mainnet" ? .mainnet : .testnet }
}

func capText(_ zat: Int) -> String { "\(Double(zat) / 1e8) ZEC" }

/// Sync state of one group wallet on this iPhone. The engine keeps the notes and the commitment
/// tree; this class downloads blocks for it and saves its state, sealed with the group key, so
/// the next launch continues from the last synced block.
@MainActor
@Observable
final class Chain {
    let gid: String
    private(set) var balance: Doc?
    private(set) var received: [Doc] = []
    private(set) var sent: Set<String> = []
    private(set) var progress: (height: Int, tip: Int)?
    private(set) var syncing = false
    private(set) var error: String?
    private(set) var server: URL?

    @ObservationIgnored private let ufvk: String
    @ObservationIgnored private let net: ZcashNetwork
    @ObservationIgnored let birthday: Int
    @ObservationIgnored private let groupKey: String
    @ObservationIgnored private var opened = false
    @ObservationIgnored var onSynced: ((Doc) -> Void)?

    private static let batch = 1000

    init(gid: String, ufvk: String, birthday: Int, groupKey: String, net: ZcashNetwork) {
        self.gid = gid
        self.net = net
        self.ufvk = ufvk
        self.birthday = birthday
        self.groupKey = groupKey
    }

    /// Frees the engine's copy of this wallet.
    func close() { _ = try? Engine.call("walletClose", [gid]) }

    func sync() async {
        guard !syncing else { return }
        syncing = true
        error = nil
        defer { syncing = false }
        do {
            try openIfNeeded()
            let server = try await pickServer()
            let tip = try await Lightwalletd.latestHeight(server)
            try await catchUp(server, tip)
            progress = nil
            publish()
            save()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Builds an unsigned payment (a PCZT) from this wallet's confirmed notes.
    func spend(to: String, amount: Int) async throws -> Doc {
        try openIfNeeded()
        let tip = try await Lightwalletd.latestHeight(try await pickServer())
        return try Engine.object("walletSpend", [gid, to, amount, tip])
    }

    private func openIfNeeded() throws {
        guard !opened else { return }
        let r = try Engine.object("walletOpen", [gid, ufvk, birthday, loadSnapshot() ?? NSNull()])
        opened = true
        if has(r["restored"]) { publish() }
    }

    private func catchUp(_ server: URL, _ tip: Int) async throws {
        while true {
            let needs = try Engine.object("walletNeeds", [gid])
            if let h = needs.int("treeState") {
                let ts = try await Lightwalletd.treeState(server, h)
                _ = try Engine.call("walletStart", [gid, ts.base64EncodedString()])
                continue
            }
            let from = needs.int("from") ?? tip + 1
            if from > tip { return }
            let end = min(tip, from + Self.batch - 1)
            let blocks = try await Lightwalletd.blocks(server, from, end).map { $0.base64EncodedString() }
            if blocks.isEmpty { throw ZigsError("The server sent no blocks for \(from) to \(end).") }
            let gid = self.gid
            // Scanning a batch takes a moment; keep it off the main thread.
            let text = try await Task.detached { try Engine.call("walletBlocks", [gid, blocks, tip]) }.value
            balance = try Engine.parse(text) as? Doc
            progress = (end, tip)
        }
    }

    private func publish() {
        balance = try? Engine.object("walletBalance", [gid])
        received = (try? Engine.parse(Engine.call("walletReceived", [gid]))) as? [Doc] ?? []
        sent = Set((try? Engine.parse(Engine.call("walletSent", [gid]))) as? [String] ?? [])
        if let balance { onSynced?(balance) }
    }

    /// Returns the first light-wallet server of this network that answers, in order.
    private func pickServer() async throws -> URL {
        if let server { return server }
        for url in net.servers {
            if (try? await Lightwalletd.latestHeight(url)) != nil {
                server = url
                return url
            }
        }
        throw ZigsError("No light-wallet server answers. Check your connection, then pull to refresh.")
    }

    // MARK: Saved state

    private var file: URL {
        let dir = URL.applicationSupportDirectory.appendingPathComponent("chain", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(gid)
    }

    private func loadSnapshot() -> String? {
        guard let sealed = try? String(contentsOf: file, encoding: .utf8) else { return nil }
        return try? Engine.call("secretOpen", [groupKey, "chain\n" + gid, sealed])
    }

    private func save() {
        do {
            let snap = try Engine.call("walletSnapshot", [gid])
            let sealed = try Engine.call("secretSeal", [groupKey, "chain\n" + gid, snap])
            try sealed.write(to: file, atomically: true, encoding: .utf8)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
            #endif
        } catch {
            self.error = "Could not save the wallet state: \(error.localizedDescription)"
        }
    }
}
