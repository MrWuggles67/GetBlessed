const test = require('node:test');
const assert = require('node:assert');
const { normalizeItems } = require('../src/billing');

test('computes total from multiple items', () => {
  const r = normalizeItems([{ name: 'Rent', price: 10.1 }, { name: 'Power', quantity: 2, price: '20.2' }]);
  assert.strictEqual(r.total, 30.3);
  assert.strictEqual(r.items[1].quantity, 2);
});

test('rejects empty and invalid items', () => {
  assert.throws(() => normalizeItems([]));
  assert.throws(() => normalizeItems([{ name: '', price: 1 }]));
  assert.throws(() => normalizeItems([{ name: 'x', price: -1 }]));
});
