import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError } from '../src/errors.js';
import { validateBill, validateBlessingsSignup } from '../src/validation.js';

test('blessings sign-up requires an annual income', () => {
  const base = { email: 'A@Example.com', password: 'longenough', displayName: 'Ann' };
  assert.throws(() => validateBlessingsSignup(base), HttpError);
  assert.throws(() => validateBlessingsSignup({ ...base, annualIncome: '-5' }), HttpError);
  const ok = validateBlessingsSignup({ ...base, annualIncome: '85000' });
  assert.equal(ok.annualIncomeCents, 8_500_000);
  assert.equal(ok.email, 'a@example.com');
});

test('validateBill computes subtotal from items and keeps the printed total', () => {
  const bill = validateBill({
    title: 'Groceries',
    items: [
      { name: 'Milk', quantity: 2, unitPrice: '3.49', lineTotal: '6.98' },
      { name: 'Bread', lineTotal: '2.50' },
      { name: 'Apples', quantity: '1.37', unitPrice: '1.99' },
    ],
    tax: '0.75',
    total: '12.96',
  });
  assert.equal(bill.items.length, 3);
  assert.equal(bill.items[1].unitPriceCents, 250);
  assert.equal(bill.items[2].lineTotalCents, 273);
  assert.equal(bill.subtotalCents, 698 + 250 + 273);
  assert.equal(bill.taxCents, 75);
  assert.equal(bill.totalCents, 1296);
});

test('validateBill derives the unit price from quantity and line total', () => {
  const bill = validateBill({ title: 'x', items: [{ name: 'Soda', quantity: 7, lineTotal: '10.03' }] });
  assert.equal(bill.items[0].unitPriceCents, 143);
  assert.equal(bill.items[0].lineTotalCents, 1003);
});

test('validateBill derives total when absent', () => {
  const bill = validateBill({ title: 'x', items: [{ name: 'A', lineTotal: '1.00' }], tax: '0.10' });
  assert.equal(bill.totalCents, 110);
});

test('validateBill rejects inconsistent line totals', () => {
  assert.throws(
    () => validateBill({ title: 'x', items: [{ name: 'A', quantity: 2, unitPrice: '1.00', lineTotal: '5.00' }] }),
    /quantity x unitPrice/,
  );
});

test('validateBill allows a total-only bill (e.g. a utility bill) but not an empty one', () => {
  assert.equal(validateBill({ title: 'Electric', items: [], total: '142.10' }).totalCents, 14210);
  assert.throws(() => validateBill({ title: 'Empty', items: [] }), HttpError);
});
