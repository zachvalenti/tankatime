#if os(iOS)
import SwiftUI
import UIKit
import TankaTimeCore

/// Draws one syllable count per visual line, aligned to that line's
/// TextKit line-fragment rect and kept in sync with the paired text
/// view's scroll offset.
final class GutterView: UIView {
    var scrollOffsetY: CGFloat = 0 {
        didSet { setNeedsDisplay() }
    }
    weak var layoutManager: NSLayoutManager?
    weak var textContainer: NSTextContainer?
    weak var textStorage: NSTextStorage?
    var font: UIFont = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
    var textColor: UIColor = .secondaryLabel
    var topInset: CGFloat = 0

    override func draw(_ rect: CGRect) {
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
            label.draw(at: CGPoint(x: x, y: y), withAttributes: attributes)
        }
    }
}

extension EditorFontFamily {
    func uiFont(size: CGFloat) -> UIFont {
        switch self {
        case .mono:
            return UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        case .serif:
            let base = UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body)
            let descriptor = base.withDesign(.serif) ?? UIFontDescriptor(name: "Georgia", size: size)
            return UIFont(descriptor: descriptor, size: size)
        case .sans:
            return UIFont.systemFont(ofSize: size, weight: .regular)
        }
    }
}

/// SwiftUI wrapper pairing a `UITextView` with a synchronized syllable-count
/// gutter, built directly on TextKit so the gutter and the text it
/// describes never drift out of alignment.
struct SyllableGutterTextView: UIViewRepresentable {
    @Binding var text: String
    var settings: EditorSettings

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeUIView(context: Context) -> ContainerView {
        let container = ContainerView()
        container.textView.delegate = context.coordinator
        container.textView.text = text
        context.coordinator.container = container
        applySettings(to: container)
        return container
    }

    func updateUIView(_ container: ContainerView, context: Context) {
        if container.textView.text != text {
            container.textView.text = text
        }
        applySettings(to: container)
        container.gutterView.setNeedsDisplay()
    }

    private func applySettings(to container: ContainerView) {
        let font = settings.fontFamily.uiFont(size: CGFloat(settings.fontSize))
        container.textView.font = font
        container.textView.backgroundColor = UIColor(settings.theme.background)
        container.textView.textColor = UIColor(settings.theme.text)
        container.textView.tintColor = UIColor(settings.theme.text)
        container.backgroundColor = UIColor(settings.theme.background)

        container.gutterView.textColor = UIColor(settings.theme.secondaryText)
        container.gutterView.font = .monospacedDigitSystemFont(ofSize: CGFloat(settings.fontSize) * 0.6, weight: .regular)
        container.gutterView.topInset = container.textView.textContainerInset.top
        container.gutterView.backgroundColor = UIColor(settings.theme.background)
        container.gutterView.isHidden = !settings.showSyllableCounts
        container.gutterWidthConstraint.constant = settings.showSyllableCounts ? 32 : 0
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var text: Binding<String>
        weak var container: ContainerView?

        init(text: Binding<String>) {
            self.text = text
        }

        func textViewDidChange(_ textView: UITextView) {
            text.wrappedValue = textView.text
            container?.gutterView.setNeedsDisplay()
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            container?.gutterView.scrollOffsetY = scrollView.contentOffset.y
        }
    }

    final class ContainerView: UIView {
        let textView = UITextView()
        let gutterView = GutterView()
        var gutterWidthConstraint: NSLayoutConstraint!

        override init(frame: CGRect) {
            super.init(frame: frame)

            textView.translatesAutoresizingMaskIntoConstraints = false
            gutterView.translatesAutoresizingMaskIntoConstraints = false
            gutterView.isUserInteractionEnabled = false

            gutterView.layoutManager = textView.layoutManager
            gutterView.textContainer = textView.textContainer
            gutterView.textStorage = textView.textStorage

            textView.alwaysBounceVertical = true
            textView.autocorrectionType = .no
            textView.autocapitalizationType = .none
            textView.smartQuotesType = .no
            textView.smartDashesType = .no

            addSubview(gutterView)
            addSubview(textView)

            gutterWidthConstraint = gutterView.widthAnchor.constraint(equalToConstant: 32)
            NSLayoutConstraint.activate([
                gutterView.leadingAnchor.constraint(equalTo: leadingAnchor),
                gutterView.topAnchor.constraint(equalTo: topAnchor),
                gutterView.bottomAnchor.constraint(equalTo: bottomAnchor),
                gutterWidthConstraint,

                textView.leadingAnchor.constraint(equalTo: gutterView.trailingAnchor),
                textView.trailingAnchor.constraint(equalTo: trailingAnchor),
                textView.topAnchor.constraint(equalTo: topAnchor),
                textView.bottomAnchor.constraint(equalTo: bottomAnchor)
            ])
        }

        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }
    }
}
#endif
