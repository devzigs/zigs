import SwiftUI
import CryptoKit

/// Presentation destinations. Selecting one never changes a wallet's permission gates.
enum NativeWorkspace: String, CaseIterable, Identifiable {
    case overview = "Overview", approvals = "Approvals", activity = "Activity"
    case addressBook = "Address book", swap = "Swap", chats = "Chats"
    case security = "Security", settings = "Settings", help = "How Zigs works"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .approvals: "checkmark.seal"
        case .activity: "clock.arrow.circlepath"
        case .addressBook: "person.crop.rectangle.stack"
        case .swap: "arrow.triangle.swap"
        case .chats: "bubble.left.and.bubble.right"
        case .security: "shield.lefthalf.filled"
        case .settings: "slider.horizontal.3"
        case .help: "questionmark.circle"
        }
    }
    var needsWallet: Bool { [.overview, .approvals, .activity, .security].contains(self) }
}

struct NativeNavigation: View {
    let selected: NativeWorkspace
    var approvals = 0
    let choose: (NativeWorkspace) -> Void
    var body: some View {
        VStack(spacing: 4) {
            ForEach(NativeWorkspace.allCases) { item in
                Button { choose(item) } label: {
                    WalletNavigationItem(title: item.rawValue, symbol: item.symbol,
                        selected: selected == item, count: item == .approvals ? approvals : 0)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected == item ? .isSelected : [])
            }
        }
    }
}

/// Decorative artwork derived only from accepted public wallet metadata. No keys or network I/O.
struct WalletIdentity: View {
    var seed: String?
    var size: CGFloat = 52
    var body: some View {
        let digest = seed.map { Array(SHA256.hash(data: Data($0.utf8))) } ?? [UInt8](repeating: 128, count: 32)
        Canvas { context, canvas in
            let rect = CGRect(origin: .zero, size: canvas).insetBy(dx: 2, dy: 2)
            context.clip(to: Path(ellipseIn: rect))
            context.fill(Path(ellipseIn: rect), with: .linearGradient(
                Gradient(colors: [Color(white: 0.86), Color(white: 0.39), Color(white: 0.11)]),
                startPoint: .zero, endPoint: CGPoint(x: canvas.width, y: canvas.height)))
            for i in 0..<17 {
                let y = CGFloat(i) / 16 * canvas.height
                let offset = (CGFloat(digest[i]) / 255 - 0.5) * canvas.width * 0.6
                var path = Path()
                path.move(to: CGPoint(x: -8, y: y))
                path.addCurve(to: CGPoint(x: canvas.width + 8, y: y + offset),
                    control1: CGPoint(x: canvas.width * 0.28, y: y - canvas.height * 0.3),
                    control2: CGPoint(x: canvas.width * 0.65, y: y + canvas.height * 0.35 + offset))
                context.stroke(path, with: .color(Color.black.opacity(0.65)), lineWidth: max(1, canvas.width / 23))
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(Color.metal.opacity(0.5)))
        .shadow(color: .black.opacity(0.18), radius: 5, y: 3)
        .accessibilityHidden(true)
    }
}

struct NativeWalletHeader: View {
    let name: String
    let network: String
    let rule: String
    var seed: String?
    let home: () -> Void
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            WalletIdentity(seed: seed)
            VStack(alignment: .leading, spacing: 5) {
                Text(name).font(.nativeHeadline).fixedSize(horizontal: false, vertical: true)
                Text(network + " · " + rule).font(.nativeCaption).foregroundStyle(Color.mist)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button(action: home) { Image(systemName: "house").frame(width: 44, height: 44) }
                .buttonStyle(.plain).accessibilityLabel("Return to wallets")
                .help("Return to wallets")
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.room)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.line).frame(height: 1) }
    }
}

struct ZebraEmblem: View {
    var size: CGFloat = 112
    var body: some View {
        Image("Logo").resizable().scaledToFit().padding(size * 0.12)
            .frame(width: size, height: size)
            .background(LinearGradient(colors: [Color(white: 0.2), Color(white: 0.07)],
                startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
            .overlay(Circle().strokeBorder(LinearGradient(colors: [Color(white: 0.85), Color(white: 0.3), Color(white: 0.6)],
                startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 3))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 8)
            .accessibilityHidden(true)
    }
}

struct NativeWelcome: View {
    let create: () -> Void
    let join: () -> Void
    let restore: () -> Void
    let learn: () -> Void
    var returning = false
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 40) { introduction; ZebraEmblem(size: 160) }
                VStack(alignment: .leading, spacing: 24) { ZebraEmblem(); introduction }
            }
            AdaptiveRow {
                Button("Create wallet", systemImage: "plus", action: create).primaryButton()
                Button("Join wallet", systemImage: "link", action: join)
                Button("Recover", systemImage: "arrow.down.doc", action: restore)
            }
            Button("How Zigs works", systemImage: "arrow.up.right", action: learn)
                .buttonStyle(.plain).foregroundStyle(Color.signal).frame(minHeight: 44)
        }.padding(.vertical, 16)
    }
    private var introduction: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Private. Shared. Yours.")
            Text(returning ? "Your wallets.\nShared control." : "Your money.\nYour people.")
                .font(.system(.largeTitle, design: .default).weight(.semibold)).tracking(-1)
                .fixedSize(horizontal: false, vertical: true)
            Text("A private wallet, controlled together. Each device keeps a key share. Every payment needs your agreed approvals.")
                .font(.nativeBody).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: 520, alignment: .leading)
    }
}

/// The web's unknown valuation convention, kept entirely outside calculations and storage.
struct NativePortfolioSummary: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Total balance · USD")
            AdaptiveRow {
                Text("$0.00").font(.system(size: 40, weight: .semibold)).monospacedDigit()
                Badge(text: "Placeholder")
            }
            Text("USD pricing is unavailable. This placeholder is not a valuation; use the exact ZEC balance below.")
                .font(.nativeCaption).foregroundStyle(Color.mist)
        }.accessibilityElement(children: .combine)
    }
}

struct NativeUnavailableAsset: View {
    let symbol: String
    let name: String
    let detail: String
    @State private var expanded = false
    var body: some View {
        Card {
            DisclosureGroup(isExpanded: $expanded) {
                Text(detail).font(.nativeSubheadline).foregroundStyle(Color.mist).padding(.top, 8)
                Text("Do not deposit this asset into a Zcash address.")
                    .font(.nativeCaption.weight(.medium)).foregroundStyle(Color.bad)
            } label: {
                HStack(spacing: 12) {
                    Text(symbol).font(.nativeHeadline).frame(width: 40, height: 40).modifier(InsetSurface())
                    VStack(alignment: .leading, spacing: 3) {
                        Text(name).font(.nativeSubheadline.weight(.semibold))
                        Text("Unavailable · do not deposit").font(.nativeCaption).foregroundStyle(Color.mist)
                    }
                }.frame(minHeight: 48)
            }.tint(.mist)
        }
    }
}

private struct NativeHomeKey: EnvironmentKey {
    static let defaultValue: @MainActor @Sendable () -> Void = {}
}
extension EnvironmentValues {
    var nativeHome: @MainActor @Sendable () -> Void {
        get { self[NativeHomeKey.self] }
        set { self[NativeHomeKey.self] = newValue }
    }
}

struct NativeCreationProgress: View {
    let step: Int
    let titles: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                ForEach(titles.indices, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2).fill(i <= step ? Color.signal : Color.line).frame(height: 3)
                }
            }.accessibilityHidden(true)
            Text("Step \(step + 1) of \(titles.count)").font(.nativeCaption).foregroundStyle(Color.mist)
        }.accessibilityLabel("Step \(step + 1) of \(titles.count): " + titles[step])
    }
}

struct NativeRuleDiagram: View {
    let required: Int
    let total: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))], alignment: .leading, spacing: 10) {
                ForEach(0..<max(0, min(total, 7)), id: \.self) { i in
                    Image(systemName: i < required ? "person.fill.checkmark" : "person")
                        .font(.title3).foregroundStyle(i < required ? Color.signal : Color.mist)
                        .frame(width: 44, height: 44).modifier(InsetSurface())
                }
            }
            Text("Any \(required) of \(total). Every payment.").font(.nativeSubheadline.weight(.semibold))
        }.padding(.vertical, 8).accessibilityElement(children: .ignore)
            .accessibilityLabel("Illustration: any \(required) of \(total) signers approve. This is not a live approval status.")
    }
}

struct NativeTransactionSummary: View {
    let title: String
    let detail: String
    let amount: Int
    var incoming = false
    let status: String
    var kind: BadgeKind = .plain
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: incoming ? "arrow.down.left" : "arrow.up.right")
                    .foregroundStyle(incoming ? Color.good : Color.mist)
                    .frame(width: 36, height: 36).modifier(InsetSurface()).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.nativeSubheadline.weight(.medium)).foregroundStyle(Color.primary)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                    Text(detail).font(.nativeCaption).foregroundStyle(Color.mist)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.nativeCaption).foregroundStyle(Color.mist).accessibilityHidden(true)
            }
            AdaptiveRow {
                Money(zat: amount, size: 17, sign: incoming ? "in" : "out")
                Badge(text: status, kind: kind)
            }
        }.padding(.vertical, 12).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .contentShape(Rectangle())
    }
}

struct NativeSavedWalletSummary: View {
    let name: String
    let network: String
    let rule: String
    var viewOnly = false
    var amount: Int?
    var status: String?
    var pending = 0
    var unread = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Avatar(text: initials(name), size: 40)
                VStack(alignment: .leading, spacing: 5) {
                    Text(name).font(.nativeHeadline).foregroundStyle(Color.primary)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                    Text(network + " · " + rule).font(.nativeCaption).foregroundStyle(Color.mist)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.nativeCaption).foregroundStyle(Color.mist)
            }
            AdaptiveRow(spacing: 8) {
                if let amount { Money(zat: amount, size: 15) }
                if let status { Badge(text: status) }
                if viewOnly { Badge(text: "View only") }
                if pending > 0 { Badge(text: "\(pending) to approve", kind: .warn) }
                if unread > 0 { Badge(text: "\(unread) new", kind: .info) }
            }
        }.padding(16).frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
            .contentShape(Rectangle())
    }
}
