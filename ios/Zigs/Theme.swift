import CoreImage.CIFilterBuiltins
import SwiftUI
import TipKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

extension Color {
    static let night = Color(red: 0.05, green: 0.047, blue: 0.078)
    static let room = Color(red: 0.086, green: 0.082, blue: 0.122)
    static let line = Color.white.opacity(0.08)
    static let signal = Color(red: 0.957, green: 0.718, blue: 0.157)
    static let mist = Color(red: 0.62, green: 0.6, blue: 0.68)
    static let good = Color(red: 0.36, green: 0.82, blue: 0.56)
    static let bad = Color(red: 0.98, green: 0.42, blue: 0.42)
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
    let i = name.split(separator: " ").compactMap(\.first).prefix(2)
    return i.isEmpty ? "?" : String(i).uppercased()
}

func when(_ ms: Int?) -> String {
    guard let ms else { return "" }
    return Date(timeIntervalSince1970: Double(ms) / 1000).formatted(.dateTime.month().day().hour().minute())
}

/// A raised surface for one group of content.
struct Card<Content: View>: View {
    var highlight = false
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.room, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(highlight ? Color.signal.opacity(0.6) : Color.line))
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
        case .info: Color(red: 0.54, green: 0.71, blue: 1.0)
        case .bad: .bad
        }
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16), in: Capsule())
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
            .background(mine ? Color.signal.opacity(0.25) : Color.white.opacity(0.08), in: Circle())
            .foregroundStyle(mine ? Color.signal : .white)
    }
}

/// An amount with ZEC as a smaller unit. `sign` is "out" or "in" for money leaving or entering.
struct Money: View {
    let zat: Int
    var size: CGFloat = 17
    var sign = ""

    var body: some View {
        let pre = sign == "out" ? "−" : sign == "in" ? "+" : ""
        let v = (Double(zat) / 100_000_000).formatted(.number.precision(.fractionLength(2...8)))
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(pre + v).font(.system(size: size, weight: .semibold).monospacedDigit())
            Text("ZEC").font(.system(size: size * 0.55, weight: .semibold)).foregroundStyle(Color.mist)
        }
        .foregroundStyle(sign == "in" ? Color.good : .white)
        .accessibilityElement(children: .combine)
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.caption2.weight(.semibold)).kerning(0.8).foregroundStyle(Color.mist)
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

/// Copies `text` and says so for a moment.
struct CopyButton: View {
    let text: String
    var label = "Copy"
    @State private var copied = false

    var body: some View {
        Button(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc") {
            copyToClipboard(text)
            copied = true
            Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
        }
    }
}

func copyToClipboard(_ text: String) {
    #if os(iOS)
    UIPasteboard.general.string = text
    #else
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #endif
}

/// macOS greys out prominent buttons in inactive windows; the main action keeps its colour.
struct MacPrimaryStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { PrimaryLabel(configuration: configuration) }

    private struct PrimaryLabel: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            configuration.label
                .font(.body.weight(.semibold))
                .padding(.horizontal, 18).padding(.vertical, 9)
                .background(Color.signal.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.35), in: Capsule())
                .foregroundStyle(Color.night.opacity(enabled ? 1 : 0.6))
        }
    }
}

/// Dark text on the yellow fill; readable grey text when the button is disabled.
private struct ProminentText: ViewModifier {
    @Environment(\.isEnabled) private var enabled
    func body(content: Content) -> some View { content.foregroundStyle(enabled ? Color.night : Color.mist) }
}

extension View {
    func primaryButton() -> some View {
        #if os(macOS)
        buttonStyle(MacPrimaryStyle())
        #else
        buttonStyle(.borderedProminent).modifier(ProminentText()).controlSize(.large)
        #endif
    }

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
