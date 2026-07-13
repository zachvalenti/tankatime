import SwiftUI
import TankaTimeCore

@main
struct TankaTimeApp: App {
    var body: some Scene {
        DocumentGroup(newDocument: { TankaDocument() }) { configuration in
            EditorView(document: configuration.$document)
        }
        #if os(macOS)
        .windowResizability(.contentSize)
        #endif
    }
}
