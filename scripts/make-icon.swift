// AppKit iconset renderer, following the Flow Translate build pipeline.
import AppKit
let destination = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: destination, withIntermediateDirectories: true)
let sizes = [("16x16",16),("16x16@2x",32),("32x32",32),("32x32@2x",64),("128x128",128),("128x128@2x",256),("256x256",256),("256x256@2x",512),("512x512",512),("512x512@2x",1024)]
for (name, size) in sizes {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)!
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.scaleBy(x: CGFloat(size)/1024, y: CGFloat(size)/1024)
    NSColor(red: 0.17, green: 0.36, blue: 0.59, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 56, y: 56, width: 912, height: 912), xRadius: 206, yRadius: 206).fill()
    NSColor.white.setFill()
    NSBezierPath(roundedRect: NSRect(x: 244, y: 190, width: 536, height: 644), xRadius: 46, yRadius: 46).fill()
    NSColor(red: 0.17, green: 0.36, blue: 0.59, alpha: 1).setFill()
    for (y, w) in [(656, 344), (554, 344), (452, 238)] {
        NSBezierPath(roundedRect: NSRect(x: 334, y: y, width: w, height: 30), xRadius: 15, yRadius: 15).fill()
    }
    NSColor(red: 0.61, green: 0.80, blue: 0.86, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 565, y: 161, width: 276, height: 195), xRadius: 58, yRadius: 58).fill()
    let tail = NSBezierPath(); tail.move(to: NSPoint(x: 614, y: 189)); tail.line(to: NSPoint(x: 614, y: 114)); tail.line(to: NSPoint(x: 697, y: 174)); tail.close(); tail.fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: destination).appendingPathComponent("icon_\(name).png"))
}
