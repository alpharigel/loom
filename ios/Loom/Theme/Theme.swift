import SwiftUI

enum Theme {
    static let accent       = Color(hex: 0xE8A838)
    static let accentDim    = Color(hex: 0xB07F22)

    static let bg           = Color(hex: 0x0E0F11)
    static let surface      = Color(hex: 0x16181C)
    static let surfaceHi    = Color(hex: 0x1E2126)
    static let surfaceLo    = Color(hex: 0x0A0B0D)
    static let border       = Color(hex: 0x2A2E35)
    static let borderHi     = Color(hex: 0x3A3F47)

    static let text         = Color(hex: 0xE8E9EC)
    static let textMuted    = Color(hex: 0x8B9099)
    static let textDim      = Color(hex: 0x5A6068)

    static let success      = Color(hex: 0x6CC36C)
    static let warning      = Color(hex: 0xE8A838)
    static let danger       = Color(hex: 0xE26A6A)
    static let info         = Color(hex: 0x6BA6E0)
}

enum Fonts {
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >>  8) & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

struct PanelStyle: ViewModifier {
    var padded: Bool = true
    func body(content: Content) -> some View {
        content
            .padding(padded ? 12 : 0)
            .background(Theme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Theme.border, lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

extension View {
    func panel(padded: Bool = true) -> some View { modifier(PanelStyle(padded: padded)) }
}
