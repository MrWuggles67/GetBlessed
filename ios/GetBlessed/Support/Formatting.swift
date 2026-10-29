import Foundation

extension Decimal {
    /// Rounds to `scale` decimal places.
    func roundedTo(_ scale: Int = 2) -> Decimal {
        var input = self
        var result = Decimal()
        NSDecimalRound(&result, &input, scale, .plain)
        return result
    }

    /// Plain "1234.56" string for the API (no grouping, '.' decimal separator).
    var apiString: String {
        NSDecimalNumber(decimal: self).description(withLocale: Locale(identifier: "en_US_POSIX"))
    }

    func currency(_ code: String = "USD") -> String {
        formatted(.currency(code: code))
    }
}

extension String {
    /// Parses an API money/quantity string ("12.34") into a Decimal.
    var decimal: Decimal { Decimal(string: self, locale: Locale(identifier: "en_US_POSIX")) ?? 0 }
}
