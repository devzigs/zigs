import AppKit
import SwiftUI

@MainActor enum PreviewDefaults {
    static let value = UserDefaults(suiteName: "app.zigs.isolated-native-layout")!
}

// A static adapter keeps link labels enabled without executing or claiming navigation tests.
@MainActor enum PreviewBrand { static var image = NSImage(size: .zero) }

struct PreviewNavigationLink<Label: View, Destination: View>: View {
    let label: Label
    init(@ViewBuilder destination: () -> Destination, @ViewBuilder label: () -> Label) { self.label = label() }
    init<Value: Hashable>(value: Value, @ViewBuilder label: () -> Label) where Destination == EmptyView { self.label = label() }
    var body: some View { Button {} label: { label } }
}

struct NativeCaptureScene: View {
    let scene: String
    let width: CGFloat
    let model: GroupModel
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if width >= 900 {
                VStack(alignment: .leading, spacing: 20) {
                    HStack { ZebraEmblem(size: 36); Text("Zigs").font(.title2.weight(.semibold)) }.padding(12)
                    NativeNavigation(selected: workspace, approvals: 1, choose: { _ in })
                }.padding(12).frame(width: 220).frame(maxHeight: .infinity, alignment: .top).modifier(GlassChrome())
            }
            VStack(alignment: .leading, spacing: 0) {
                if scene != "welcome" {
                    NativeWalletHeader(name: model.state.name, network: "Testnet", rule: "2 of 3 approvals",
                        seed: "synthetic-public-address", home: {})
                }
                content.padding(width <= 390 ? 16 : 24).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.environment(model).background(AppBackdrop())
    }
    private var workspace: NativeWorkspace {
        switch scene {
        case "security": .security
        case "activity": .activity
        case "approvals", "empty": .approvals
        case "recipients": .addressBook
        case "chats": .chats
        case "help": .help
        case "settings": .settings
        case "swap": .swap
        default: .overview
        }
    }
    @ViewBuilder private var content: some View {
        switch scene {
        case "welcome":
            NativeWelcome(create: {}, join: {}, restore: {}, learn: {})
            NativeSavedWalletSummary(name: "Studio treasury", network: "Testnet", rule: "2 of 3 approvals", amount: 265000001, pending: 1)
                .modifier(SatinSurface())
        case "overview", "long-name": OverviewTab(showSigners: {}, showActivity: {}, showApprovals: {}, deposit: {}, send: {})
        case "approvals", "empty": NativeApprovalsView()
        case "activity": ActivityList(limit: nil)
        case "security": NativeSecurityView(change: {})
        case "recipients": RecipientBookView()
        case "chats": ChatsWorkspace()
        case "help": NativeHelpView()
        case "settings": NativeSettingsView(openSettings: {}, recover: {})
        case "swap": UnavailableSwap()
        case "setup": SetupView()
        case "create-name", "rule", "create-network", "create-review":
            let step = scene == "create-name" ? 0 : scene == "rule" ? 1 : scene == "create-network" ? 2 : 3
            let titles = ["Name your wallet", "Choose shared control", "Choose the network", "Review your wallet"]
            NativeCreationProgress(step: step, titles: titles)
            InstrumentHeading(title: titles[step], detail: "Each signer keeps a separate share.")
            NativeCreationStepContent(step: step, from: nil, nickname: .constant("Test signer"), walletName: .constant("Studio treasury"),
                n: .constant(3), t: .constant(2), mainnet: .constant(false), understood: .constant(false))
        case "review":
            let ss = Session(id: "synthetic-review", doc: ["status": "collecting", "amount": 12345678,
                "payees": [["to": "utest1syntheticdestination", "amount": 12345678]], "createdAt": 1792742400000])
            let ins: Doc = ["lines": [["kind": "spend", "value": 12355678], ["kind": "output", "who": "utest1syntheticdestination", "value": 12345678, "memo_status": "empty"]]]
            BalancePanel {
                SectionLabel(text: "Leaves the wallet")
                Money(zat: ss.amount + 10000, size: 34, sign: "out")
                Text("Includes the 0.0001 ZEC network fee").font(.nativeCaption).foregroundStyle(Color.mist)
            }
            RecipientBox(ss: ss, rc: RecipientCheck(model: model, ss: ss, ins: ins))
            Breakdown(ss: ss, ins: ins)
            Timeline(ss: ss)
        case "large-amount":
            Card { NativeTransactionSummary(title: "A long payment title for independent design and research", detail: "Synthetic display input", amount: 2100000000000000, status: "Your approval", kind: .warn) }
            RecipientSummary(recipient: PaymentRecipient(id: String(repeating: "a", count: 32), name: "Studio operations and independent research treasury", asset: "ZEC", network: "testnet", type: "shielded", address: "utest1" + String(repeating: "synthetic", count: 25)))
        default: EmptyView()
        }
    }
}

@main struct NativeCapture {
    static func withoutMetadata(_ data: Data) throws -> Data {
        var result = Data(data.prefix(8)), offset = 8
        while offset + 12 <= data.count {
            let length = (0..<4).reduce(0) { ($0 << 8) | Int(data[offset + $1]) }
            guard length <= data.count - offset - 12 else { throw CocoaError(.fileWriteUnknown) }
            let kind = String(data: data.subdata(in: offset + 4 ..< offset + 8), encoding: .ascii) ?? ""
            if !["eXIf", "tEXt", "zTXt", "iTXt"].contains(kind) { result.append(data.subdata(in: offset ..< offset + length + 12)) }
            offset += length + 12
        }
        guard offset == data.count else { throw CocoaError(.fileWriteUnknown) }
        return result
    }

    @MainActor static func render<V: View>(_ content: V) throws -> Data {
        let host = NSHostingView(rootView: content.defaultAppStorage(PreviewDefaults.value))
        host.frame.size = host.fittingSize
        host.layoutSubtreeIfNeeded()
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw CocoaError(.fileWriteUnknown) }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        return try withoutMetadata(png)
    }

    @MainActor static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        PreviewDefaults.value.removePersistentDomain(forName: "app.zigs.isolated-native-layout")
        defer { PreviewDefaults.value.removePersistentDomain(forName: "app.zigs.isolated-native-layout") }
        if let logo = NSImage(contentsOfFile: CommandLine.arguments[2]) { PreviewBrand.image = logo }
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        var count = 0
        for (theme, scheme) in [("dark", ColorScheme.dark), ("light", ColorScheme.light)] {
            NSApplication.shared.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            for width in [320, 390, 768, 1200] {
                for scene in ["welcome", "overview", "approvals", "empty", "activity", "security", "recipients", "chats", "help", "settings", "swap", "setup", "create-name", "rule", "create-network", "create-review", "review", "long-name", "large-amount"] {
                    let model = GroupModel()
                    model.previewInstall(empty: scene == "empty", setup: scene == "setup", longName: scene == "long-name")
                    let png = try render( NativeCaptureScene(scene: scene, width: CGFloat(width), model: model)
                        .environment(\.colorScheme, scheme).buttonStyle(InstrumentButtonStyle())
                        .textFieldStyle(InstrumentFieldStyle()).frame(width: CGFloat(width))
                        .fixedSize(horizontal: false, vertical: true))
                    try png.write(to: output.appendingPathComponent("\(scene)-\(theme)-\(width).png"))
                    count += 1
                }
            }
        }
        // Enlarged text is rendered with the native Dynamic Type environment.
        for scene in ["overview", "security", "large-amount"] {
            let model = GroupModel(); model.previewInstall()
            let png = try render( NativeCaptureScene(scene: scene, width: 390, model: model)
                .environment(\.colorScheme, .dark).environment(\.dynamicTypeSize, .accessibility3)
                .buttonStyle(InstrumentButtonStyle()).textFieldStyle(InstrumentFieldStyle())
                .frame(width: 390).fixedSize(horizontal: false, vertical: true))
            try png.write(to: output.appendingPathComponent("\(scene)-accessibility-390.png"))
            count += 1
        }
        print("Rendered \(count) isolated native SwiftUI layout captures. Narrow widths use Mac controls, not an iOS simulator.")
    }
}
