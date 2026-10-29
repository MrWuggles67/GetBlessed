import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centsToString, milliToString, toCents, toMilli } from '../src/money.js';

test('toCents parses money without floating point error', () => {
  assert.equal(toCents('12.34'), 1234);
  assert.equal(toCents('$5'), 500);
  assert.equal(toCents('0.1'), 10);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents('85000'), 8500000);
  assert.equal(toCents('-1.00'), null);
  assert.equal(toCents('1.234'), null);
  assert.equal(toCents('abc'), null);
  assert.equal(toCents(undefined), null);
});

test('toMilli parses positive quantities', () => {
  assert.equal(toMilli(2), 2000);
  assert.equal(toMilli('1.25'), 1250);
  assert.equal(toMilli('0'), null);
  assert.equal(toMilli('-1'), null);
});

test('formatters round-trip', () => {
  assert.equal(centsToString(1234), '12.34');
  assert.equal(centsToString(5), '0.05');
  assert.equal(milliToString(1250), '1.250');
});
