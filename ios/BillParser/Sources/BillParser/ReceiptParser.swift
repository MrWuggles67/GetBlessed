import Foundation

/// One purchased item read off a bill.
public struct ParsedItem: Equatable, Sendable, Identifiable {
    public var id = UUID()
    public var name: String
    public var quantity: Decimal
    public var unitPrice: Decimal
    public var lineTotal: Decimal

    public init(name: String, quantity: Decimal = 1, unitPrice: Decimal, lineTotal: Decimal) {
        self.name = name
        self.quantity = quantity
        self.unitPrice = unitPrice
        self.lineTotal = lineTotal
    }

    public static func == (lhs: ParsedItem, rhs: ParsedItem) -> Bool {
        lhs.name == rhs.name && lhs.quantity == rhs.quantity
            && lhs.unitPrice == rhs.unitPrice && lhs.lineTotal == rhs.lineTotal
    }
}

/// Everything recognised on a bill.
public struct ParsedBill: Equatable, Sendable {
    public var merchant: String?
    public var items: [ParsedItem]
    public var subtotal: Decimal
    public var tax: Decimal
    /// The complete total. Taken from the printed total when there is one,
    /// otherwise items + tax.
    public var total: Decimal
    /// True when the total was read from the bill rather than calculated.
    public var totalWasPrinted: Bool

    /// Whether the items (plus tax) add up to the printed total. When they
    /// don't, the app asks the member to double check the items.
    public var itemsMatchTotal: Bool {
        abs(NSDecimalNumber(decimal: subtotal + tax - total).doubleValue) < 0.015
    }
}

/// Turns the rows of text recognised on a receipt or bill into named, priced
/// items plus the complete total.
public enum ReceiptParser {
    public static func parse(rows: [String]) -> ParsedBill {
        var items: [ParsedItem] = []
        var tax: Decimal = 0
        var printedSubtotal: Decimal?
        var totals: [Decimal] = []
        var merchant: String?
        var pendingName: String?

        for rawRow in rows {
            let row = clean(rawRow)
            guard !row.isEmpty else { continue }

            guard let split = splitTrailingAmount(row) else {
                // A row with no price: the merchant name (first wordy row), or an
                // item name whose price sits on the next row ("2 @ 3.49  6.98").
                if merchant == nil, items.isEmpty, totals.isEmpty, isWordy(row) {
                    merchant = row
                } else if totals.isEmpty, isWordy(row), classify(row) == .item {
                    pendingName = row
                } else {
                    pendingName = nil
                }
                continue
            }

            let (label, amount) = split
            switch classify(label) {
            case .total:
                totals.append(amount)
            case .subtotal:
                printedSubtotal = amount
            case .tax:
                tax += amount
            case .ignored:
                break
            case .item:
                // Anything after the total is payment / change information.
                guard totals.isEmpty, amount > 0 else { continue }
                let (labelName, quantity, unitPrice) = splitQuantity(label)
                var name = labelName
                if name.isEmpty, let pending = pendingName { name = pending }
                name = tidyName(name)
                guard !name.isEmpty, isWordy(name) else { continue }
                let lineTotal = amount
                let unit = unitPrice ?? (quantity == 1 ? amount : round(lineTotal / quantity))
                items.append(ParsedItem(name: name, quantity: quantity, unitPrice: unit, lineTotal: lineTotal))
            }
            pendingName = nil
        }

        let itemsSum = items.reduce(Decimal(0)) { $0 + $1.lineTotal }
        let subtotal = items.isEmpty ? (printedSubtotal ?? 0) : itemsSum
        // When several totals are printed (e.g. before and after tip) the
        // largest is what is actually owed.
        let printedTotal = totals.max()
        return ParsedBill(
            merchant: merchant,
            items: items,
            subtotal: subtotal,
            tax: tax,
            total: printedTotal ?? (subtotal + tax),
            totalWasPrinted: printedTotal != nil
        )
    }

    // MARK: - Row classification

    enum Kind { case item, subtotal, tax, total, ignored }

    static func classify(_ label: String) -> Kind {
        let text = " " + label.lowercased()
            .replacingOccurrences(of: "[^a-z ]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: " +", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces) + " "

        func has(_ words: [String]) -> Bool { words.contains { text.contains(" \($0) ") } }

        if has(["subtotal", "sub total", "sub ttl", "subttl", "net total", "merchandise total"]) { return .subtotal }
        if has(["total savings", "you saved", "total items", "items sold", "total discount", "savings"]) { return .ignored }
        if has(["total", "ttl", "amount due", "balance due", "total due", "amount owed", "please pay",
                "new balance", "current balance", "grand total", "pay this amount"]) { return .total }
        if has(["tax", "taxes", "sales tax", "vat", "gst", "hst", "pst", "state tax", "city tax"]) { return .tax }
        if has(["change", "change due", "cash", "visa", "mastercard", "master card", "amex", "discover", "debit",
                "credit", "tender", "tendered", "payment", "paid", "auth", "approval", "acct",
                "discount", "coupon", "promo", "rounding", "previous balance", "balance forward", "points"]) {
            return .ignored
        }
        return .item
    }

    // MARK: - Amounts

    private static let trailingAmount = try! NSRegularExpression(
        pattern: #"^(.*?)\s*(-)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})\s*(-)?(?:\s+[A-Z*]{1,2})?$"#
    )

    /// Splits "MILK 2%  3.49 F" into ("MILK 2%", 3.49). Returns nil when the
    /// row does not end in a price. Negative amounts (discounts) come back < 0.
    static func splitTrailingAmount(_ row: String) -> (String, Decimal)? {
        let range = NSRange(row.startIndex..., in: row)
        guard let match = trailingAmount.firstMatch(in: row, range: range) else { return nil }
        let label = substring(row, match.range(at: 1)) ?? ""
        let whole = (substring(row, match.range(at: 3)) ?? "").replacingOccurrences(of: ",", with: "")
        let cents = substring(row, match.range(at: 4)) ?? "00"
        guard var amount = Decimal(string: "\(whole).\(cents)", locale: Locale(identifier: "en_US_POSIX")) else { return nil }
        if match.range(at: 2).location != NSNotFound || match.range(at: 5).location != NSNotFound { amount = -amount }
        return (label.trimmingCharacters(in: .whitespaces), amount)
    }

    // MARK: - Quantities

    private static let quantityAtPrice = try! NSRegularExpression(
        pattern: #"^(.*?)\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|kg|oz|ea)?\s*(?:@|x|X|×)\s*\$?(\d+\.\d{2})\s*(?:/\s*(?:lb|kg|oz|ea))?\s*(?:ea)?$"#
    )
    private static let leadingQuantity = try! NSRegularExpression(
        pattern: #"^(\d{1,3})\s*(?:x|X|×|@)?\s+(.+)$"#
    )
    private static let unitWords: Set<String> = ["oz", "lb", "lbs", "ml", "l", "g", "kg", "ct", "pk", "pc", "in", "ft", "gal", "qt", "pt"]

    /// Pulls a quantity (and unit price, when printed) out of an item label:
    /// "MILK 2 @ 3.49", "2 x MILK", "2 MILK", "BANANAS 1.37 lb @ 0.59/lb".
    static func splitQuantity(_ label: String) -> (name: String, quantity: Decimal, unitPrice: Decimal?) {
        let range = NSRange(label.startIndex..., in: label)
        if let match = quantityAtPrice.firstMatch(in: label, range: range),
           let qty = substring(label, match.range(at: 2)).flatMap({ Decimal(string: $0) }),
           let unit = substring(label, match.range(at: 3)).flatMap({ Decimal(string: $0) }),
           qty > 0 {
            return (substring(label, match.range(at: 1)) ?? "", qty, unit)
        }
        if let match = leadingQuantity.firstMatch(in: label, range: range),
           let qty = substring(label, match.range(at: 1)).flatMap({ Decimal(string: $0) }),
           let rest = substring(label, match.range(at: 2)),
           qty > 1, qty <= 99 {
            let firstWord = rest.split(separator: " ").first.map { $0.lowercased() } ?? ""
            if !unitWords.contains(firstWord), rest.first?.isLetter == true {
                return (rest, qty, nil)
            }
        }
        return (label, 1, nil)
    }

    // MARK: - Text helpers

    private static func clean(_ row: String) -> String {
        row.replacingOccurrences(of: "\t", with: " ")
            .replacingOccurrences(of: " {2,}", with: "  ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Removes SKU / barcode numbers and leftover punctuation from item names.
    static func tidyName(_ name: String) -> String {
        name.replacingOccurrences(of: #"\b\d{5,}\b"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"^[\s\-–.:*#]+|[\s\-–.:*#@]+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: " {2,}", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    private static func isWordy(_ text: String) -> Bool {
        text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count >= 2
    }

    private static func round(_ value: Decimal) -> Decimal {
        var input = value
        var result = Decimal()
        NSDecimalRound(&result, &input, 2, .plain)
        return result
    }

    private static func substring(_ text: String, _ range: NSRange) -> String? {
        guard range.location != NSNotFound, let r = Range(range, in: text) else { return nil }
        return String(text[r])
    }
}
