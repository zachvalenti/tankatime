import XCTest
@testable import TankaTimeCore

final class SyllableCounterTests: XCTestCase {

    func testSingleSyllableWords() {
        let words = ["the", "a", "i", "queue", "you", "your", "were", "here",
                     "there", "where", "one", "once", "eye", "buy", "guide",
                     "guy", "aisle", "isle", "friend", "be", "like", "name",
                     "time", "write", "tree", "free", "toe", "real"]
        for word in words {
            XCTAssertEqual(SyllableCounter.syllables(in: word), 1, "\(word) should be 1 syllable")
        }
    }

    func testTwoSyllableWords() {
        let expectations: [String: Int] = [
            "table": 2, "apple": 2, "writer": 2, "poem": 2, "poet": 2,
            "quiet": 2, "being": 2, "science": 2, "flower": 2, "power": 2
        ]
        for (word, expected) in expectations {
            XCTAssertEqual(SyllableCounter.syllables(in: word), expected, "\(word) should be \(expected) syllables")
        }
    }

    func testThreeOrMoreSyllableWords() {
        let expectations: [String: Int] = [
            "syllable": 3,
            "minimalist": 4,
            "beautiful": 3,
            "poetry": 3,
            "poetic": 3,
            "created": 3,
            "creating": 3,
            "creation": 3,
            "creative": 3,
            "sciences": 3,
            "society": 4,
            "societies": 4,
            "area": 3,
            "idea": 3,
            "quietly": 3,
            "reality": 4,
            "video": 3,
            "family": 3,
            "camera": 3
        ]
        for (word, expected) in expectations {
            XCTAssertEqual(SyllableCounter.syllables(in: word), expected, "\(word) should be \(expected) syllables")
        }
    }

    func testContractionsKeepApostrophe() {
        XCTAssertEqual(SyllableCounter.syllables(in: "don't"), 1)
        XCTAssertEqual(SyllableCounter.syllables(in: "I'm"), 1)
    }

    func testEmptyAndNonAlphabeticInput() {
        XCTAssertEqual(SyllableCounter.syllables(in: ""), 0)
        XCTAssertEqual(SyllableCounter.syllables(in: "2024"), 0)
        XCTAssertEqual(SyllableCounter.syllables(in: "---"), 0)
    }

    func testLineCounting() {
        // Classic 5-syllable haiku opening line.
        XCTAssertEqual(SyllableCounter.syllables(inLine: "An old silent pond"), 5)
        // 7-syllable line.
        XCTAssertEqual(SyllableCounter.syllables(inLine: "A frog jumps into the pond"), 7)
    }

    func testLineTokenizationSplitsOnPunctuationNotApostrophes() {
        let tokens = SyllableCounter.wordTokens(in: "Well-being, and don't stop—now.")
        XCTAssertEqual(tokens.map(String.init), ["Well", "being", "and", "don't", "stop", "now"])
    }
}
