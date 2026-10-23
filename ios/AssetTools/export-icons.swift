// Deterministic native asset export. The canonical zebra is drawn without redrawing its artwork.
import AppKit

func withoutMetadata(_ data: Data) throws -> Data {
    var result = Data(data.prefix(8)), offset = 8
    while offset + 12 <= data.count {
        let length = (0..<4).reduce(0) { ($0 << 8) | Int(data[offset + $1]) }
        guard length <= data.count - offset - 12 else { throw CocoaError(.fileWriteUnknown) }
        let kind = String(data: data.subdata(in: offset + 4 ..< offset + 8), encoding: .ascii) ?? ""
        if !["eXIf", "tEXt", "zTXt", "iTXt"].contains(kind) {
            result.append(data.subdata(in: offset ..< offset + length + 12))
        }
        offset += length + 12
    }
    guard offset == data.count else { throw CocoaError(.fileWriteUnknown) }
    return result
}

guard CommandLine.arguments.count == 3,
      let artwork = NSImage(contentsOfFile: CommandLine.arguments[1]) else {
    fatalError("Usage: export-icons canonical-logo.png AppIcon.appiconset")
}
let destination = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
for (platform, sizes) in [("mac", [16, 32, 64, 128, 256, 512, 1024]), ("ios", [1024])] {
    for size in sizes {
        let side = CGFloat(size)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw CocoaError(.fileWriteUnknown) }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        let full = CGRect(x: 0, y: 0, width: side, height: side)
        NSColor.clear.setFill(); full.fill()
        let inset = platform == "mac" ? side * 0.065 : 0
        let face = full.insetBy(dx: inset, dy: inset)
        let shape = NSBezierPath(roundedRect: face, xRadius: platform == "mac" ? side * 0.2 : 0,
            yRadius: platform == "mac" ? side * 0.2 : 0)
        NSColor(srgbRed: 0.075, green: 0.086, blue: 0.102, alpha: 1).setFill()
        shape.fill()
        NSColor(white: 0.75, alpha: 0.22).setStroke()
        shape.lineWidth = max(0.5, side / 512); shape.stroke()
        let available = side * 0.78
        let scale = min(available / artwork.size.width, available / artwork.size.height)
        let width = artwork.size.width * scale, height = artwork.size.height * scale
        artwork.draw(in: CGRect(x: (side - width) / 2, y: (side - height) / 2, width: width, height: height),
            from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        var output = bitmap
        if platform == "ios" {
            guard let image = bitmap.cgImage,
                  let opaque = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                    bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw CocoaError(.fileWriteUnknown) }
            opaque.draw(image, in: full)
            guard let image = opaque.makeImage() else { throw CocoaError(.fileWriteUnknown) }
            output = NSBitmapImageRep(cgImage: image)
        }
        guard let data = output.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        try withoutMetadata(data).write(to: destination.appendingPathComponent("\(platform)-\(size).png"))
    }
}
print("Exported the existing canonical artwork into 8 native app-icon assets.")
