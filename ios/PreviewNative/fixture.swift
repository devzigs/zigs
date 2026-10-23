
// Compiled only into the isolated capture copy, never into the app target.
@MainActor extension GroupModel {
    func previewInstall(empty: Bool = false, setup: Bool = false, longName: Bool = false) {
        let id = String(repeating: "a", count: 20)
        gid = id
        let label = longName ? "Studio treasury for independent design and research across our team" : "Studio treasury"
        state.g = ["name": label, "n": 3, "t": 2, "network": "testnet", "version": 3]
        state.seats = ["1": ["uid": me, "name": "Test signer"], "2": ["uid": "synthetic-other", "name": "Test partner"]]
        if !setup {
            state.seats["3"] = ["uid": "synthetic-third", "name": "Test teammate"]
            state.verify = ["1": ["ok": true], "2": ["ok": true], "3": ["ok": true]]
            state.wallet = ["birthday": 3100000, "address": "utest1syntheticpreviewaddress", "ufvk": "synthetic viewing key"]
            let c = Chain(gid: id, ufvk: "synthetic", birthday: 3100000, groupKey: "synthetic", net: .testnet)
            c.previewBalance()
            chain = c
            vault.previewSeat(id)
            if !empty {
                state.sessions = [
                    Session(id: "synthetic-pending", doc: ["status": "collecting", "amount": 12345678, "note": "Studio operations", "createdAt": 1792742400000]),
                    Session(id: "synthetic-complete", doc: ["status": "broadcast", "amount": 10000000, "note": "Research contribution", "createdAt": 1792656000000])
                ]
            }
        }
        groups = [GroupInfo(id: id, doc: state.g!)]
        wallets = state.wallet.map { [id: $0] } ?? [:]
        balances = [id: 265000001]
        toApprove = [id: empty || setup ? 0 : 1]
    }
}
