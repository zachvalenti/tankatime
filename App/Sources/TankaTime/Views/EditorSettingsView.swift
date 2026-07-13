import SwiftUI
import TankaTimeCore

/// The full settings surface, reachable from the editor's single toolbar
/// button — kept short enough to fit without scrolling on iPhone.
struct EditorSettingsView: View {
    @Binding var settings: EditorSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Theme") {
                    Picker("Theme", selection: $settings.theme) {
                        ForEach(EditorTheme.allCases) { theme in
                            Text(theme.displayName).tag(theme)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Typeface") {
                    Picker("Font", selection: $settings.fontFamily) {
                        ForEach(EditorFontFamily.allCases) { family in
                            Text(family.displayName).tag(family)
                        }
                    }
                    .pickerStyle(.segmented)

                    Stepper(value: $settings.fontSize, in: 13...28, step: 1) {
                        Text("Size: \(Int(settings.fontSize)) pt")
                    }
                }

                Section("Layout") {
                    Stepper(value: $settings.columnWidth, in: 360...900, step: 20) {
                        Text("Column width: \(Int(settings.columnWidth)) pt")
                    }
                    Toggle("Typewriter scrolling", isOn: $settings.typewriterScrolling)
                    Toggle("Focus mode (hide chrome, double-tap to toggle)", isOn: $settings.focusMode)
                }

                Section("Syllables") {
                    Toggle("Show syllable count in margin", isOn: $settings.showSyllableCounts)
                }
            }
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
