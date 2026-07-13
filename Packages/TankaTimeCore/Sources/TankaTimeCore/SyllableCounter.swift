import Foundation

/// Estimates English syllable counts for words and lines of text.
///
/// This is the engine behind TankaTime's signature feature: a discreet
/// syllable count rendered in the margin next to every line, so poets
/// (tanka, haiku, or otherwise syllable-conscious writers) can see their
/// meter as they type.
///
/// The estimate is heuristic, not dictionary-perfect: it counts vowel
/// groups and adjusts for silent trailing "e" and "le" endings, the same
/// approach used by most lightweight syllable counters. English is full of
/// "hiatus" words where two adjacent vowel letters are pronounced as
/// separate syllables (e.g. "poet", "idea", "create") rather than as a
/// single diphthong (e.g. "boat", "rain") — a heuristic can't tell those
/// apart from spelling alone, so a short, hand-verified exception list
/// covers the common cases.
public enum SyllableCounter {

    /// Estimates the number of syllables in a single word.
    public static func syllables(in word: String) -> Int {
        let lettersOnly = word.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard !lettersOnly.isEmpty else { return 0 }

        let normalized = String(String.UnicodeScalarView(lettersOnly)).lowercased()

        if let exception = exceptions[normalized] {
            return exception
        }

        let vowels: Set<Character> = ["a", "e", "i", "o", "u", "y"]
        var groupCount = 0
        var previousWasVowel = false

        for character in normalized {
            let isVowel = vowels.contains(character)
            if isVowel && !previousWasVowel {
                groupCount += 1
            }
            previousWasVowel = isVowel
        }

        var count = groupCount

        // A trailing silent "e" (make, code, like) doesn't add a syllable,
        // unless it's the word's only vowel group, or it follows patterns
        // where the "e" is actually voiced (table, tree, toe, dye).
        if count > 1,
           normalized.hasSuffix("e"),
           !normalized.hasSuffix("le"),
           !normalized.hasSuffix("ee"),
           !normalized.hasSuffix("oe"),
           !normalized.hasSuffix("ye") {
            count -= 1
        }

        return max(count, 1)
    }

    /// Estimates the total syllable count across every word on a line.
    public static func syllables(inLine line: String) -> Int {
        wordTokens(in: line).reduce(0) { $0 + syllables(in: $1) }
    }

    /// Splits a line into word tokens, keeping internal apostrophes
    /// (so "don't" is one word) but treating everything else non-letter
    /// as a separator.
    static func wordTokens(in line: String) -> [Substring] {
        line.split(whereSeparator: { !$0.isLetter && $0 != "'" })
    }

    /// Hand-verified corrections for common words where the vowel-group
    /// heuristic disagrees with standard dictionary syllable counts.
    private static let exceptions: [String: Int] = [
        "business": 2, "businesses": 3,
        "evening": 2, "evenings": 2,
        "poem": 2, "poems": 2,
        "poet": 2, "poets": 2, "poetry": 3, "poetic": 3,
        "create": 2, "creates": 2, "created": 3, "creating": 3,
        "creation": 3, "creative": 3,
        "science": 2, "sciences": 3,
        "society": 4, "societies": 4,
        "area": 3, "areas": 3,
        "idea": 3, "ideas": 3,
        "quiet": 2, "quietly": 3,
        "being": 2, "beings": 2,
        "reality": 4,
        "video": 3, "videos": 3
    ]
}
