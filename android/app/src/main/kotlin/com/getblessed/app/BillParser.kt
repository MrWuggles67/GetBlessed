package com.getblessed.app

data class BillItem(val name: String, val quantity: Int, val price: Double)

data class ParsedBill(val merchant: String?, val items: List<BillItem>, val total: Double)

/** Turns OCR text from a receipt/bill into named, priced items plus a complete total. */
object BillParser {
    private val priceAtEnd = Regex("""[-$]?\s*(\d{1,3}(?:,\d{3})*|\d+)[.,](\d{2})\s*[A-Za-z]?\s*$""")
    private val qtyPrefix = Regex("""^(\d{1,3})\s*[xX@]\s+(.*)$""")
    private val totalLine = Regex("""(?i)\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\b""")
    private val skipLine = Regex("""(?i)\b(sub\s*total|subtotal|tax|vat|change|cash|visa|mastercard|amex|debit|credit|tender|tip|gratuity|discount|savings)\b""")

    private fun priceOf(line: String): Pair<Double, String>? {
        val m = priceAtEnd.find(line) ?: return null
        val whole = m.groupValues[1].replace(",", "")
        val value = "$whole.${m.groupValues[2]}".toDoubleOrNull() ?: return null
        return value to line.substring(0, m.range.first).trim()
    }

    fun parse(text: String): ParsedBill {
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val merchant = lines.firstOrNull { priceOf(it) == null && it.any(Char::isLetter) }
        val items = mutableListOf<BillItem>()
        var statedTotal: Double? = null
        for (line in lines) {
            val (price, label) = priceOf(line) ?: continue
            if (skipLine.containsMatchIn(line)) continue
            if (totalLine.containsMatchIn(line)) { statedTotal = price; continue }
            var name = label.trimEnd('.', ' ', '-', ':', '$')
            var qty = 1
            qtyPrefix.find(name)?.let { qty = it.groupValues[1].toInt().coerceAtLeast(1); name = it.groupValues[2] }
            if (name.any(Char::isLetter)) items += BillItem(name, qty, price)
        }
        val total = statedTotal ?: Math.round(items.sumOf { it.price } * 100) / 100.0
        return ParsedBill(merchant, items, total)
    }
}
