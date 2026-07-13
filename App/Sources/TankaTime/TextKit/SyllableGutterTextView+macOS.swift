#if os(macOS)
import SwiftUI
import AppKit
import TankaTimeCore

/// Draws one syllable count per visual line, aligned to that line's
/// TextKit line-fragment rect and kept in sync with the paired text
/// view's scroll offset. Mirrors the iOS `GutterView` geometry exactly.
final class GutterView: NSView {
    var scrollOffsetY: CGFloat = 0 {
        didSet { needsDisplay = true }
    }
    weak var layoutManager: NSLayoutManager?
    weak var textContainer: NSTextContainer?
    weak var textStorage: NSTextStorage?
    var font: NSFont = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
    var textColor: NSColor = .secondaryLabelColor
    var topInset: CGFloat = 0

    // Top-down coordinates match the iOS implementation's math exactly.
    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let layoutManager, let textContainer, let textStorage else { return }
        let fullString = textStorage.string as NSString
        let glyphRange = layoutManager.glyphRange(for: textContainer)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: textColor]

        layoutManager.enumerateLineFragments(forGlyphRange: glyphRange) { [self] _, usedRect, _, glyphRangeForLine, _ in
            let charRange = layoutManager.characterRange(forGlyphRange: glyphRangeForLine, actualGlyphRange: nil)
            let line = fullString.substring(with: charRange).trimmingCharacters(in: .newlines)
            guard !line.isEmpty else { return }
            let count = SyllableCounter.syllables(inLine: line)
            guard count > 0 else { return }

            let label = "\(count)" as NSString
            let size = label.size(withAttributes: attributes)
            let y = topInset + usedRect.minY - scrollOffsetY + (usedRect.height - size.height) / 2
            let x = bounds.width - size.width - 6
            label.draw(at: NSPoint(x: x, y: y), withAttributes: attributes)
        }
    }
}

extension EditorFontFamily {
    func nsFont(size: CGFloat) -> NSFont {
        switch self {
        case .mono:
            return .monospacedSystemFont(ofSize: size, weight: .regular)
        case .serif:
            return NSFont(descriptor: NSFontDescriptor.preferredFontDescriptor(forTextStyle: .body)
                .withDesign(.serif) ?? NSFontDescriptor(name: "Georgia", size: size), size: size)
                ?? .systemFont(ofSize: size)
        case .sans:
            return .systemFont(ofSize: size, weight: .regular)
        }
    }
}

/// SwiftUI wrapper pairing an `NSTextView` with a synchronized syllable-count
/// gutter, built directly on TextKit so the gutter and the text it
/// describes never drift out of alignment.
struct SyllableGutterTextView: NSViewRepresentable {
    @Binding var text: String
    var settings: EditorSettings

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeNSView(context: Context) -> ContainerView {
        let container = ContainerView()
        container.textView.delegate = context.coordinator
        container.textView.string = text
        context.coordinator.container = container

        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.boundsDidChange(_:)),
            name: NSView.boundsDidChangeNotification,
            object: container.scrollView.contentView
        )

        applySettings(to: container)
        return container
    }

    func updateNSView(_ container: ContainerView, context: Context) {
        if container.textView.string != text {
            container.textView.string = text
        }
        applySettings(to: container)
        container.gutterView.needsDisplay = true
    }

    private func applySettings(to container: ContainerView) {
        let font = settings.fontFamily.nsFont(size: CGFloat(settings.fontSize))
        container.textView.font = font
        container.textView.backgroundColor = NSColor(settings.theme.background)
        container.textView.textColor = NSColor(settings.theme.text)
        container.textView.insertionPointColor = NSColor(settings.theme.text)
        container.scrollView.backgroundColor = NSColor(settings.theme.background)

        container.gutterView.textColor = NSColor(settings.theme.secondaryText)
        container.gutterView.font = .monospacedDigitSystemFont(ofSize: CGFloat(settings.fontSize) * 0.6, weight: .regular)
        container.gutterView.topInset = container.textView.textContainerInset.height
        container.gutterView.layer?.backgroundColor = NSColor(settings.theme.background).cgColor
        container.gutterView.isHidden = !settings.showSyllableCounts
        container.gutterWidthConstraint.constant = settings.showSyllableCounts ? 32 : 0
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        weak var container: ContainerView?

        init(text: Binding<String>) {
            self.text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text.wrappedValue = textView.string
            container?.gutterView.needsDisplay = true
        }

        @objc func boundsDidChange(_ notification: Notification) {
            guard let clipView = container?.scrollView.contentView else { return }
            container?.gutterView.scrollOffsetY = clipView.bounds.origin.y
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }
    }

    final class ContainerView: NSView {
        let textView = NSTextView()
        let scrollView = NSScrollView()
        let gutterView = GutterView()
        var gutterWidthConstraint: NSLayoutConstraint!

        override init(frame frameRect: NSRect) {
            super.init(frame: frameRect)

            scrollView.translatesAutoresizingMaskIntoConstraints = false
            gutterView.translatesAutoresizingMaskIntoConstraints = false
            gutterView.wantsLayer = true

            gutterView.layoutManager = textView.layoutManager
            gutterView.textContainer = textView.textContainer
            gutterView.textStorage = textView.textStorage

            textView.isRichText = false
            textView.isVerticallyResizable = true
            textView.isHorizontallyResizable = false
            textView.autoresizingMask = [.width]
            textView.textContainer?.widthTracksTextView = true
            textView.isAutomaticQuoteSubstitutionEnabled = false
            textView.isAutomaticDashSubstitutionEnabled = false
            textView.isAutomaticSpellingCorrectionEnabled = false

            scrollView.documentView = textView
            scrollView.hasVerticalScroller = true
            scrollView.drawsBackground = false
            scrollView.contentView.postsBoundsChangedNotifications = true

            addSubview(gutterView)
            addSubview(scrollView)

            gutterWidthConstraint = gutterView.widthAnchor.constraint(equalToConstant: 32)
            NSLayoutConstraint.activate([
                gutterView.leadingAnchor.constraint(equalTo: leadingAnchor),
                gutterView.topAnchor.constraint(equalTo: topAnchor),
                gutterView.bottomAnchor.constraint(equalTo: bottomAnchor),
                gutterWidthConstraint,

                scrollView.leadingAnchor.constraint(equalTo: gutterView.trailingAnchor),
                scrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
                scrollView.topAnchor.constraint(equalTo: topAnchor),
                scrollView.bottomAnchor.constraint(equalTo: bottomAnchor)
            ])
        }

        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }
    }
}
#endif
