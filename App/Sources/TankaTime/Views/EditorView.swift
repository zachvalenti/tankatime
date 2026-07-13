import SwiftUI
import TankaTimeCore

/// The distraction-free writing surface: a centered column of text on a
/// full-bleed background, the syllable gutter riding along its inner edge,
/// and all other chrome willing to get out of the way.
struct EditorView: View {
    @Binding var document: TankaDocument
    @AppStorage("editorSettings") private var storedSettings = EditorSettings.default.encoded
    @State private var showSettings = false
    @State private var isChromeVisible = true

    private var settings: EditorSettings {
        EditorSettings.decoded(from: storedSettings)
    }

    var body: some View {
        ZStack(alignment: .top) {
            settings.theme.background.ignoresSafeArea()

            HStack {
                Spacer(minLength: 0)
                SyllableGutterTextView(text: $document.text, settings: settings)
                    .frame(maxWidth: CGFloat(settings.columnWidth))
                Spacer(minLength: 0)
            }
            .padding(.top, isChromeVisible ? 44 : 0)

            if isChromeVisible {
                toolbar
            }
        }
        .animation(.easeInOut(duration: 0.2), value: isChromeVisible)
        .toolbar(.hidden, for: .navigationBar)
        #if os(iOS)
        .statusBarHidden(!isChromeVisible)
        #endif
        .onTapGesture(count: 2) {
            if settings.focusMode {
                isChromeVisible.toggle()
            }
        }
        .sheet(isPresented: $showSettings) {
            EditorSettingsView(settings: bindingSettings)
        }
        .onAppear {
            isChromeVisible = !settings.focusMode
        }
    }

    private var toolbar: some View {
        HStack {
            Text(wordAndSyllableSummary)
                .font(.caption.monospacedDigit())
                .foregroundStyle(settings.theme.secondaryText)

            Spacer()

            Button {
                showSettings = true
            } label: {
                Image(systemName: "textformat.size")
            }
            .buttonStyle(.plain)
            .foregroundStyle(settings.theme.secondaryText)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .transition(.opacity)
    }

    private var wordAndSyllableSummary: String {
        let words = document.text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count
        let syllables = document.text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .reduce(0) { $0 + SyllableCounter.syllables(inLine: String($1)) }
        return "\(words) words · \(syllables) syllables"
    }

    private var bindingSettings: Binding<EditorSettings> {
        Binding(
            get: { settings },
            set: { storedSettings = $0.encoded }
        )
    }
}

private extension EditorSettings {
    var encoded: String {
        (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? ""
    }

    static func decoded(from string: String) -> EditorSettings {
        guard let data = string.data(using: .utf8),
              let settings = try? JSONDecoder().decode(EditorSettings.self, from: data) else {
            return .default
        }
        return settings
    }
}
