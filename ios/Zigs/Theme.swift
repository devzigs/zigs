import CoreImage.CIFilterBuiltins
import SwiftUI
import TipKit
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

private func palette(_ dark:UInt32,_ light:UInt32) -> Color {
    #if os(iOS)
    func color(_ hex:UInt32)->UIColor {UIColor(red:CGFloat((hex>>16)&255)/255,green:CGFloat((hex>>8)&255)/255,blue:CGFloat(hex&255)/255,alpha:1)}
    return Color(UIColor {trait in color(trait.userInterfaceStyle == .dark ? dark:light)})
    #else
    func color(_ hex:UInt32)->NSColor {NSColor(srgbRed:CGFloat((hex>>16)&255)/255,green:CGFloat((hex>>8)&255)/255,blue:CGFloat(hex&255)/255,alpha:1)}
    return Color(NSColor(name:nil){appearance in color(appearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua ? dark:light)})
    #endif
}
extension Color {
    static let night=palette(0x0d1014,0xf6f7f8)
    static let room=palette(0x191e25,0xffffff)
    static let raised=palette(0x272e38,0xffffff)
    static let inset=palette(0x202630,0xf0f2f5)
    static let smoke=palette(0x12161b,0xeceef1)
    static let heroSurface=palette(0x1c2128,0xf7f8fa)
    static let line=palette(0x303845,0xe2e5ea)
    static let controlBoundary=palette(0x788697,0x606e80)
    static let buttonBoundary=palette(0x8a96a8,0x606e80)
    static let signal=palette(0xf3b186,0x9f481d)
    static let actionOrange=Color(red:233.0/255,green:165.0/255,blue:111.0/255)
    static let onAction=Color(red:36.0/255,green:23.0/255,blue:14.0/255)
    static let information=palette(0xa8c7ef,0x305a8a)
    static let mist=palette(0xb3bdca,0x5b6573)
    static let controlTop=palette(0x343b45,0xffffff)
    static let controlBottom=palette(0x242a32,0xe4e8ed)
    static let metal=palette(0xd8dde5,0x455365)
    static let good=palette(0x8bd5b5,0x176549)
    static let bad=palette(0xf5a1a9,0xa52d37)
}

func zec(_ zat: Int?) -> String {
    let v = Double(zat ?? 0) / 100_000_000
    return v.formatted(.number.precision(.fractionLength(2...8))) + " ZEC"
}

#if os(macOS)
let deviceName = "Mac"
#else
let deviceName = "iPhone"
#endif

/// An address in groups of five characters, for reading by eye. Copy the plain address, not this.
func grouped(_ s: String) -> String {
    stride(from: 0, to: s.count, by: 5).map { i in
        let a = s.index(s.startIndex, offsetBy: i), b = s.index(a, offsetBy: 5, limitedBy: s.endIndex) ?? s.endIndex
        return String(s[a..<b])
    }.joined(separator: " ")
}

func short(_ s: String, _ n: Int = 12) -> String {
    s.count > n * 2 ? "\(s.prefix(n))…\(s.suffix(n / 2))" : s
}

func initials(_ name: String) -> String {
    // A label such as "Ana (seat 2)" shows the initials of the name only.
    let base = name.split(separator: "(", maxSplits: 1, omittingEmptySubsequences: false)
        .first ?? ""
    let i = base.split(separator: " ").compactMap(\.first).prefix(2)
    return i.isEmpty ? "?" : String(i).uppercased()
}

func when(_ ms: Int?) -> String {
    guard let ms else { return "" }
    return Date(timeIntervalSince1970: Double(ms) / 1000).formatted(.dateTime.month().day().hour().minute())
}

/// Shared proportions and motion. Custody and payment state never depend on these values.
enum Instrument {
    static let cardRadius: CGFloat = 20
    static let controlRadius: CGFloat = 12
    static let sheetRadius: CGFloat = 28
    static let motion = Animation.spring(response: 0.26, dampingFraction: 0.94)
}

/// Opaque satin content avoids the changing contrast of glass behind financial information.
struct SatinSurface: ViewModifier {
    var radius: CGFloat = Instrument.cardRadius
    var highlight = false
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color.room)
                    .overlay {
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(LinearGradient(colors: [.white.opacity(scheme == .dark ? 0.045 : 0.6), .clear, .black.opacity(scheme == .dark ? 0.035 : 0.015)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [highlight ? Color.controlBoundary : Color.metal.opacity(scheme == .dark ? 0.3 : 0.22), Color.line, Color.line.opacity(0.65)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .shadow(color: .black.opacity(scheme == .dark ? 0.16 : 0.045), radius: 16, x: 0, y: 8)
    }
}

/// The balance is the focal surface: opaque satin with a restrained titanium edge.
struct BalancePanel<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        VStack(alignment: .leading, spacing: 20) { content }
            .padding(24).frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: Instrument.cardRadius, style: .continuous)
                    .fill(Color(red: 0.094, green: 0.11, blue: 0.137))
                    .overlay {
                        RoundedRectangle(cornerRadius: Instrument.cardRadius, style: .continuous)
                            .fill(LinearGradient(stops: [.init(color: Color.metal.opacity(scheme == .dark ? 0.1 : 0.14), location: 0), .init(color: .clear, location: 0.5), .init(color: .black.opacity(scheme == .dark ? 0.08 : 0.025), location: 1)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: Instrument.cardRadius, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [Color.metal.opacity(0.7), Color.line, Color.metal.opacity(0.22)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .allowsHitTesting(false)
            }
            .shadow(color: .black.opacity(scheme == .dark ? 0.2 : 0.065), radius: 24, x: 0, y: 12)
            .foregroundStyle(Color.white)
            .environment(\.colorScheme, .dark)
    }
}

/// Recessed information and message wells stay opaque and visually distinct from controls.
struct InsetSurface: ViewModifier {
    var radius: CGFloat = Instrument.controlRadius
    func body(content: Content) -> some View {
        content.background(Color.inset, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.line.opacity(0.8)).allowsHitTesting(false))
    }
}

struct InstrumentHeading: View {
    let title: String
    let detail: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.largeTitle.weight(.semibold)).tracking(-0.9)
                .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            Text(detail).font(.nativeBody).foregroundStyle(Color.mist)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct InstrumentEmptyState: View {
    let symbol: String
    let title: String
    var detail: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: symbol).font(.title2.weight(.light)).foregroundStyle(Color.metal)
                .frame(width: 48, height: 48).modifier(InsetSurface()).accessibilityHidden(true)
            Text(title).font(.nativeSubheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            if let detail { Text(detail).font(.nativeFootnote).foregroundStyle(Color.mist).fixedSize(horizontal: false, vertical: true) }
        }.padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AppBackdrop: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Color.night.overlay(alignment: .top) {
            LinearGradient(stops: [.init(color: Color.metal.opacity(scheme == .dark ? 0.055 : 0.035), location: 0), .init(color: .clear, location: 0.45)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }.ignoresSafeArea()
    }
}

struct GlassChrome: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content.background {
            if reduceTransparency { Color.smoke }
            else { Rectangle().fill(.ultraThinMaterial).overlay(Color.smoke.opacity(scheme == .dark ? 0.72 : 0.65)) }
        }.overlay(alignment: .top) {
            Rectangle().fill(LinearGradient(colors: [Color.metal.opacity(0.35), Color.line, Color.line.opacity(0.2)], startPoint: .leading, endPoint: .trailing)).frame(height: 1)
        }
    }
}

struct InstrumentScreen: ViewModifier {
    func body(content: Content) -> some View {
        content.scrollContentBackground(.hidden).background(AppBackdrop())
            .environment(\.defaultMinListRowHeight,48)
            .presentationBackground(Color.room)
            .presentationCornerRadius(Instrument.sheetRadius)
    }
}

struct InstrumentFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.textFieldStyle(.plain).font(.nativeBody).padding(.horizontal, 14).padding(.vertical, 12)
            .frame(minHeight: 48)
            .background(Color.inset, in: RoundedRectangle(cornerRadius: Instrument.controlRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Instrument.controlRadius, style: .continuous).strokeBorder(Color.controlBoundary))
    }
}

/// Reflows the same controls and labels without changing their actions or state.
struct AdaptiveRow<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder let content: Content
    @Environment(\.dynamicTypeSize) private var textSize
    var body: some View {
        if textSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: spacing) { content }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: spacing) { content }
                    .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: spacing) { content }
            }
        }
    }
}

struct WalletNavigationItem: View {
    let title: String
    let symbol: String
    var selected = false
    var count = 0
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(.body, design: .default).weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? Color.metal : Color.mist).frame(width: 24).accessibilityHidden(true)
            Text(title).font(.nativeSubheadline.weight(selected ? .semibold : .medium))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            if count > 0 {
                Text(String(count)).font(.nativeCaption.weight(.semibold)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.metal.opacity(0.12), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.line))
            }
        }
        .foregroundStyle(selected ? Color.primary : Color.mist)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .background {
            if selected {
                RoundedRectangle(cornerRadius: Instrument.controlRadius, style: .continuous)
                    .fill(LinearGradient(colors: [.controlTop, .controlBottom], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Instrument.controlRadius)
            .strokeBorder(selected ? Color.controlBoundary : Color.clear))
        .contentShape(RoundedRectangle(cornerRadius: Instrument.controlRadius))
    }
}

/// Keeps every digit together; very large text can scroll instead of splitting an amount.
struct ExactValueText: View {
    let value: String
    var font: Font = .title2.weight(.medium)
    var body: some View {
        ViewThatFits(in: .horizontal) {
            Text(value).font(font.monospacedDigit()).fixedSize()
            Text(value).font(.nativeBody.weight(.semibold).monospacedDigit()).fixedSize()
            VStack(alignment: .leading, spacing: 6) {
                ScrollView(.horizontal) {
                    Text(value).font(.nativeBody.weight(.semibold).monospacedDigit()).fixedSize()
                }.scrollIndicators(.visible)
                Label("Scroll to read the full amount",systemImage:"arrow.left.and.right")
                    .font(.nativeCaption).foregroundStyle(Color.mist)
            }
        }.textSelection(.enabled)
    }
}

struct Card<Content: View>: View {
    var highlight = false
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 18) { content }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .modifier(SatinSurface(highlight: highlight))
    }
}

enum BadgeKind { case plain, ok, warn, info, bad }

struct Badge: View {
    let text: String
    var kind: BadgeKind = .plain

    var body: some View {
        let color: Color = switch kind {
        case .plain: .mist
        case .ok: .good
        case .warn: .signal
        case .info: .information
        case .bad: .bad
        }
        Text(text)
            .font(.nativeCaption.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(color.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.25)).allowsHitTesting(false))
            .foregroundStyle(color)
    }
}

struct Avatar: View {
    let text: String
    var mine = false
    var size: CGFloat = 32

    var body: some View {
        Text(text)
            .font(.system(size: size * 0.38, weight: .semibold))
            .frame(width: size, height: size)
            .background {
                Circle().fill(LinearGradient(colors: mine ? [Color.signal.opacity(0.18), Color.signal.opacity(0.08)] : [Color.controlTop, Color.controlBottom], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            .overlay(Circle().strokeBorder(mine ? Color.signal.opacity(0.3) : Color.controlBoundary.opacity(0.6)))
            .foregroundStyle(mine ? Color.signal : Color.primary)
    }
}

/// An amount with ZEC as a smaller unit. `sign` is "out" or "in" for money leaving or entering.
struct Money: View {
    let zat: Int
    var size: CGFloat = 17
    var sign = ""
    /// Follows the user's text size setting (Dynamic Type).
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let pre = sign == "out" ? "−" : sign == "in" ? "+" : ""
        let v = (Double(zat) / 100_000_000).formatted(.number.precision(.fractionLength(2...8)))
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(pre + v).font(.system(size: size * scale, weight: .semibold).monospacedDigit()).fixedSize()
                Text("ZEC").font(.system(size: max(12, size * scale * 0.55), weight: .semibold)).foregroundStyle(Color.mist)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(pre + v).font(.system(size: size * scale, weight: .semibold).monospacedDigit())
                    .fixedSize()
                Text("ZEC").font(.nativeBody.weight(.medium)).foregroundStyle(Color.mist)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(pre + v).font(.nativeBody.weight(.semibold).monospacedDigit()).fixedSize()
                Text("ZEC").font(.nativeBody.weight(.medium)).foregroundStyle(Color.mist)
            }
            VStack(alignment: .leading, spacing: 6) {
                ScrollView(.horizontal) {
                    Text(pre + v).font(.nativeBody.weight(.semibold).monospacedDigit()).fixedSize()
                }.scrollIndicators(.visible)
                Text("ZEC").font(.nativeBody.weight(.medium)).foregroundStyle(Color.mist)
                Label("Scroll to read the full amount",systemImage:"arrow.left.and.right")
                    .font(.nativeCaption).foregroundStyle(Color.mist)
            }
        }
        .foregroundStyle(sign == "in" ? Color.good : Color.primary)
        .accessibilityElement(children: .ignore).accessibilityLabel(pre + v + " ZEC")
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.caption2.weight(.semibold)).kerning(1.4).foregroundStyle(Color.mist)
    }
}

/// A QR code drawn by Core Image; no third-party code.
struct QRCode: View {
    let text: String

    var body: some View {
        if let image = Self.image(text) {
            Image(decorative: image, scale: 1).interpolation(.none).resizable().scaledToFit()
                .padding(12).background(.white, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("QR code")
        }
    }

    static func image(_ text: String) -> CGImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return cg
    }
}

/// Copies `text` and says so for a moment. A `sensitive` text, such as a passphrase, stays on this
/// device and leaves the clipboard after 2 minutes.
struct CopyButton: View {
    let text: String
    var label = "Copy"
    var sensitive = false
    @State private var copied = false

    var body: some View {
        Button(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc") {
            copyToClipboard(text, sensitive: sensitive)
            copied = true
            Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
        }
    }
}

func copyToClipboard(_ text: String, sensitive: Bool = false) {
    let lifetime: TimeInterval = 120
    #if os(iOS)
    if sensitive {
        // Local only: Universal Clipboard does not send it to the person's other devices.
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: text]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(lifetime)])
    } else {
        UIPasteboard.general.string = text
    }
    #else
    let board = NSPasteboard.general
    board.clearContents()
    board.setString(text, forType: .string)
    guard sensitive else { return }
    // Clipboard managers skip an item with this type. The text goes after 2 minutes, unless the
    // person has copied something else since.
    board.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
    let count = board.changeCount
    DispatchQueue.main.asyncAfter(deadline: .now() + lifetime) {
        let current = NSPasteboard.general
        if current.changeCount == count { current.clearContents() }
    }
    #endif
}

/// The same tactile control on iPhone and Mac; never animate a live financial value.
struct InstrumentButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    func makeBody(configuration: Configuration) -> some View {
        let destructive = configuration.role == .destructive
        return configuration.label
            .font(.nativeBody.weight(.semibold))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(minWidth: 44, minHeight: 48)
            .foregroundStyle(enabled ? (prominent ? Color.onAction : destructive ? Color.bad : Color.primary) : Color.mist)
            .background {
                RoundedRectangle(cornerRadius: Instrument.controlRadius, style: .continuous)
                    .fill(LinearGradient(colors: prominent ? [Color(red: 0.96, green: 0.73, blue: 0.55), .actionOrange] : [.controlTop, .controlBottom], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .opacity(enabled ? 1 : 0.22)
            }
            .overlay {
                RoundedRectangle(cornerRadius: Instrument.controlRadius, style: .continuous)
                    .strokeBorder(prominent && enabled ? (scheme == .dark ? Color.actionOrange : Color.signal) : Color.buttonBoundary.opacity(enabled ? 1 : 0.45))
            }
            .shadow(color: .black.opacity(enabled ? (scheme == .dark ? 0.16 : 0.06) : 0), radius: 4, x: 0, y: configuration.isPressed ? 1 : 3)
            .contentShape(RoundedRectangle(cornerRadius: Instrument.controlRadius))
            .brightness(configuration.isPressed && enabled ? -0.035 : 0)
            .scaleEffect(configuration.isPressed && enabled ? 0.988 : 1)
            .animation(reduceMotion ? nil : Instrument.motion, value: configuration.isPressed)
    }
}

extension View {
    func primaryButton() -> some View { buttonStyle(InstrumentButtonStyle(prominent: true)) }
    func instrumentScreen() -> some View { modifier(InstrumentScreen()) }

    // iPhone-only modifiers; the Mac has no title modes, keyboards or auto-capitalisation.
    func inlineTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    func codeEntry() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        autocorrectionDisabled()
        #endif
    }

    func decimalEntry() -> some View {
        #if os(iOS)
        keyboardType(.decimalPad)
        #else
        self
        #endif
    }
}

// MARK: Tips for the points first testers found unclear

struct RuleTip: Tip {
    var title: Text { Text("What the approval rule means") }
    var message: Text? { Text("A payment needs that many signers to approve it. One signer alone can never move the money.") }
    var image: Image? { Image(systemName: "person.2.badge.key") }
}

struct SignersTip: Tip {
    var title: Text { Text("These are the signers") }
    var message: Text? { Text("Each one holds a piece of the wallet key on their own device. Nobody holds the whole key.") }
    var image: Image? { Image(systemName: "person.3") }
}

struct ChangeSignersTip: Tip {
    var title: Text { Text("Add or remove signers") }
    var message: Text? { Text("Signers are part of the wallet key. To change them, create a new wallet and move the funds to it.") }
    var image: Image? { Image(systemName: "arrow.triangle.swap") }
}

/// Keep the existing spelling while letting SwiftUI install this style's environment values.
typealias ConsumerButtonStyle = InstrumentButtonStyle

extension View {
    @ViewBuilder func nativeSheetSizing() -> some View {
        #if os(macOS)
        self.frame(minWidth: 480, minHeight: 560)
        #else
        self
        #endif
    }
}

/// Match the web's readable desktop scale while retaining native Dynamic Type on iPhone/iPad.
extension Font {
    static var nativeBody: Font {
        #if os(macOS)
        .system(size: 14)
        #else
        .body
        #endif
    }
    static var nativeSubheadline: Font {
        #if os(macOS)
        .system(size: 14)
        #else
        .subheadline
        #endif
    }
    static var nativeHeadline: Font {
        #if os(macOS)
        .system(size: 16, weight: .semibold)
        #else
        .headline
        #endif
    }
    static var nativeCaption: Font {
        #if os(macOS)
        .system(size: 12)
        #else
        .caption
        #endif
    }
    static var nativeFootnote: Font {
        #if os(macOS)
        .system(size: 12)
        #else
        .footnote
        #endif
    }
}
