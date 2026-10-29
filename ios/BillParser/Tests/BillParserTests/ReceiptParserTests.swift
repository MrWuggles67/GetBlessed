import XCTest
@testable import BillParser

private func d(_ string: String) -> Decimal { Decimal(string: string)! }

final class ReceiptParserTests: XCTestCase {
    func testGroceryReceiptWithMultipleItemsTaxAndTotal() {
        let bill = ReceiptParser.parse(rows: [
            "CORNER MARKET",
            "123 Main St",
            "MILK 2%  3.49 F",
            "BANANAS",
            "2 @ 1.25  2.50",
            "BREAD  2.99",
            "SUBTOTAL  8.98",
            "TAX  0.45",
            "TOTAL  9.43",
            "VISA  9.43",
            "CHANGE  0.00",
        ])

        XCTAssertEqual(bill.merchant, "CORNER MARKET")
        XCTAssertEqual(bill.items.map(\.name), ["MILK 2%", "BANANAS", "BREAD"])
        XCTAssertEqual(bill.items.map(\.lineTotal), [d("3.49"), d("2.50"), d("2.99")])
        XCTAssertEqual(bill.items[1].quantity, 2)
        XCTAssertEqual(bill.subtotal, d("8.98"))
        XCTAssertEqual(bill.tax, d("0.45"))
        XCTAssertEqual(bill.total, d("9.43"))
        XCTAssertTrue(bill.totalWasPrinted)
        XCTAssertTrue(bill.itemsMatchTotal)
    }

    func testQuantitiesAreRecognised() {
        let bill = ReceiptParser.parse(rows: [
            "Joe's Diner",
            "2 x Cheeseburger  17.98",
            "3 Coffee  6.00",
            "Fries 2 @ 3.25  6.50",
            "12 oz Soda  1.99",
            "Total  32.47",
        ])

        XCTAssertEqual(bill.items.count, 4)
        XCTAssertEqual(bill.items[0], ParsedItem(name: "Cheeseburger", quantity: 2, unitPrice: d("8.99"), lineTotal: d("17.98")))
        XCTAssertEqual(bill.items[1], ParsedItem(name: "Coffee", quantity: 3, unitPrice: 2, lineTotal: 6))
        XCTAssertEqual(bill.items[2], ParsedItem(name: "Fries", quantity: 2, unitPrice: d("3.25"), lineTotal: d("6.50")))
        // "12 oz" is a size, not a quantity.
        XCTAssertEqual(bill.items[3].name, "12 oz Soda")
        XCTAssertEqual(bill.items[3].quantity, 1)
        XCTAssertEqual(bill.total, d("32.47"))
    }

    func testItemNameOnOneRowAndQuantityOnTheNext() {
        let bill = ReceiptParser.parse(rows: [
            "STORE",
            "ORANGE JUICE",
            "2 @ 3.49  6.98",
            "TOTAL  6.98",
        ])
        XCTAssertEqual(bill.items, [ParsedItem(name: "ORANGE JUICE", quantity: 2, unitPrice: d("3.49"), lineTotal: d("6.98"))])
    }

    func testUtilityBillUsesAmountDue() {
        let bill = ReceiptParser.parse(rows: [
            "City Power & Light",
            "Account Number 0012345",
            "Previous Balance  120.00",
            "Payment Received  -120.00",
            "Electric Service  98.40",
            "Delivery Charge  21.15",
            "Taxes  4.79",
            "Amount Due  $124.34",
        ])
        XCTAssertEqual(bill.items.map(\.name), ["Electric Service", "Delivery Charge"])
        XCTAssertEqual(bill.tax, d("4.79"))
        XCTAssertEqual(bill.total, d("124.34"))
        XCTAssertTrue(bill.itemsMatchTotal)
    }

    func testTotalIsCalculatedWhenNotPrinted() {
        let bill = ReceiptParser.parse(rows: ["Lunch", "Salad  9.50", "Tea  2.25", "Tax  0.94"])
        XCTAssertFalse(bill.totalWasPrinted)
        XCTAssertEqual(bill.total, d("12.69"))
    }

    func testLargestPrintedTotalWinsAndSavingsAreIgnored() {
        let bill = ReceiptParser.parse(rows: [
            "Bistro",
            "Pasta  18.00",
            "Total  18.00",
            "Tip  3.60",
            "Total  21.60",
            "Total Savings  2.00",
        ])
        XCTAssertEqual(bill.total, d("21.60"))
        XCTAssertFalse(bill.itemsMatchTotal)
    }

    func testSkuNumbersAndThousandsSeparators() {
        let bill = ReceiptParser.parse(rows: [
            "Electronics Plus",
            "LAPTOP 0012345678  1,299.99",
            "TOTAL  1,299.99",
        ])
        XCTAssertEqual(bill.items.first?.name, "LAPTOP")
        XCTAssertEqual(bill.total, d("1299.99"))
    }

    func testRowAssemblerJoinsNameAndPriceOnTheSameLine() {
        let rows = TextRowAssembler.rows(from: [
            TextFragment(text: "3.49", minX: 0.80, minY: 0.201, width: 0.1, height: 0.02),
            TextFragment(text: "TOTAL", minX: 0.10, minY: 0.400, width: 0.2, height: 0.02),
            TextFragment(text: "MILK", minX: 0.10, minY: 0.200, width: 0.2, height: 0.02),
            TextFragment(text: "5.00", minX: 0.80, minY: 0.399, width: 0.1, height: 0.02),
        ])
        XCTAssertEqual(rows, ["MILK  3.49", "TOTAL  5.00"])
    }
}
