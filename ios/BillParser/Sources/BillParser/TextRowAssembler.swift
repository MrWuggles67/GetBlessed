import Foundation

/// A piece of text recognised in a photo, in normalised image coordinates
/// (0...1, origin at the top-left, y grows downward).
public struct TextFragment: Equatable, Sendable {
    public var text: String
    public var minX: Double
    public var minY: Double
    public var width: Double
    public var height: Double

    public init(text: String, minX: Double, minY: Double, width: Double, height: Double) {
        self.text = text
        self.minX = minX
        self.minY = minY
        self.width = width
        self.height = height
    }

    var midY: Double { minY + height / 2 }
}

/// Text recognisers usually return the item name and its price as separate
/// fragments (they sit far apart on a receipt). This joins fragments that sit
/// on the same printed row back together, left to right, top to bottom.
public enum TextRowAssembler {
    public static func rows(from fragments: [TextFragment]) -> [String] {
        var rows: [[TextFragment]] = []
        for fragment in fragments.sorted(by: { $0.midY < $1.midY }) {
            if let index = rows.lastIndex(where: { row in sameRow(row, fragment) }) {
                rows[index].append(fragment)
            } else {
                rows.append([fragment])
            }
        }
        return rows.map { row in
            row.sorted { $0.minX < $1.minX }
                .map { $0.text.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .joined(separator: "  ")
        }
    }

    private static func sameRow(_ row: [TextFragment], _ fragment: TextFragment) -> Bool {
        let rowMid = row.map(\.midY).reduce(0, +) / Double(row.count)
        let rowHeight = row.map(\.height).reduce(0, +) / Double(row.count)
        let tolerance = min(rowHeight, fragment.height) * 0.5
        return abs(rowMid - fragment.midY) <= tolerance
    }
}
