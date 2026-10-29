package com.getblessed.app

import org.junit.Assert.assertEquals
import org.junit.Test

class BillParserTest {
    @Test
    fun parsesMultipleItemsAndTotal() {
        val p = BillParser.parse("City Power Co\nElectric service 85.20\n2 x Late fee 5.00\nSubtotal 95.20\nTax 4.80\nTOTAL 100.00")
        assertEquals("City Power Co", p.merchant)
        assertEquals(2, p.items.size)
        assertEquals(2, p.items[1].quantity)
        assertEquals(100.00, p.total, 0.001)
    }

    @Test
    fun sumsItemsWhenNoTotalLine() {
        val p = BillParser.parse("Water 20.10\nGas 30.20")
        assertEquals(50.30, p.total, 0.001)
    }
}
