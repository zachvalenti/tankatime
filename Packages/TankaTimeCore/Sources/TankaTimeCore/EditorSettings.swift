import SwiftUI

/// Color/background pairing for the editor chrome. Kept intentionally to
/// three options — the same restraint iA Writer and WriteRoom apply to
/// their own theme pickers.
public enum EditorTheme: String, CaseIterable, Codable, Identifiable {
    case light
    case dark
    case sepia

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .light: return "Light"
        case .dark: return "Dark"
        case .sepia: return "Sepia"
        }
    }

    public var background: Color {
        switch self {
        case .light: return Color(white: 1.0)
        case .dark: return Color(white: 0.11)
        case .sepia: return Color(red: 0.96, green: 0.93, blue: 0.85)
        }
    }

    public var text: Color {
        switch self {
        case .light: return Color(white: 0.12)
        case .dark: return Color(white: 0.92)
        case .sepia: return Color(red: 0.25, green: 0.20, blue: 0.13)
        }
    }

    /// The dimmed color used for text outside the focused sentence/paragraph
    /// when Focus Mode is on, and for the syllable-count gutter at rest.
    public var secondaryText: Color {
        switch self {
        case .light: return Color(white: 0.68)
        case .dark: return Color(white: 0.45)
        case .sepia: return Color(red: 0.62, green: 0.56, blue: 0.44)
        }
    }
}

/// Typeface family for the editor. TankaTime ships three, matching the
/// well-worn writing-app conventions: an even-width mono (WriteRoom,
/// Highland), a humanist serif (Ulysses), and a clean sans (iA Writer).
public enum EditorFontFamily: String, CaseIterable, Codable, Identifiable {
    case mono
    case serif
    case sans

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .mono: return "Mono"
        case .serif: return "Serif"
        case .sans: return "Sans"
        }
    }

    public func font(size: Double) -> Font {
        switch self {
        case .mono: return .system(size: size, weight: .regular, design: .monospaced)
        case .serif: return .system(size: size, weight: .regular, design: .serif)
        case .sans: return .system(size: size, weight: .regular, design: .default)
        }
    }
}

/// User-configurable editor preferences, persisted via `AppStorage` in the
/// app layer. Grouped here so both the app and (eventually) any extension
/// or widget can share the same option set.
public struct EditorSettings: Codable, Equatable {
    public var theme: EditorTheme
    public var fontFamily: EditorFontFamily
    public var fontSize: Double
    public var columnWidth: Double
    public var showSyllableCounts: Bool
    public var focusMode: Bool
    public var typewriterScrolling: Bool

    public init(
        theme: EditorTheme = .light,
        fontFamily: EditorFontFamily = .serif,
        fontSize: Double = 18,
        columnWidth: Double = 640,
        showSyllableCounts: Bool = true,
        focusMode: Bool = false,
        typewriterScrolling: Bool = true
    ) {
        self.theme = theme
        self.fontFamily = fontFamily
        self.fontSize = fontSize
        self.columnWidth = columnWidth
        self.showSyllableCounts = showSyllableCounts
        self.focusMode = focusMode
        self.typewriterScrolling = typewriterScrolling
    }

    public static let `default` = EditorSettings()
}
