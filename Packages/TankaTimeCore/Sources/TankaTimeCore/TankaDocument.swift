import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    /// Plain Markdown, the native format for TankaTime documents.
    public static var tankaMarkdown: UTType {
        UTType(importedAs: "net.daringfireball.markdown", conformingTo: .plainText)
    }
}

/// A single plain-text/Markdown document, editable on iPhone, iPad, and Mac.
///
/// TankaTime intentionally has no proprietary format: every document is a
/// plain `.md` (or `.txt`) file, so it stays legible and portable outside
/// the app, in the spirit of iA Writer and Highland.
public struct TankaDocument: FileDocument {
    public static var readableContentTypes: [UTType] { [.tankaMarkdown, .plainText] }
    public static var writableContentTypes: [UTType] { [.tankaMarkdown, .plainText] }

    public var text: String

    public init(text: String = "") {
        self.text = text
    }

    public init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let string = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = string
    }

    public func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
