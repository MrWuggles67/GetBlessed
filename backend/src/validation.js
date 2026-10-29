import { badRequest } from './errors.js';
import { toCents, toMilli } from './money.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITEMS = 500;
const MAX_AMOUNT_CENTS = 999_999_999_999; // DECIMAL(12,2)
// Tolerance (in cents) between quantity * unit price and the printed line total,
// to allow for per-weight items that the store rounds.
const LINE_TOTAL_TOLERANCE = 1;

function str(value, field, { min = 0, max, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw badRequest(`${field} is required`, { field });
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`, { field });
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${field} must be at least ${min} characters`, { field });
  if (max && trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters`, { field });
  return trimmed;
}

function credentials(body) {
  const email = str(body.email, 'email', { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw badRequest('email is not a valid email address', { field: 'email' });
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
    throw badRequest('password must be 8-128 characters', { field: 'password' });
  }
  return { email, password: body.password };
}

export function validateBillableSignup(body = {}) {
  return {
    ...credentials(body),
    displayName: str(body.displayName, 'displayName', { min: 1, max: 80 }),
  };
}

export function validateBlessingsSignup(body = {}) {
  const annualIncomeCents = toCents(body.annualIncome);
  if (annualIncomeCents === null) {
    throw badRequest('annualIncome must be a non-negative amount, e.g. 85000 or 85000.00', { field: 'annualIncome' });
  }
  return {
    ...validateBillableSignup(body),
    annualIncomeCents,
  };
}

export function validateLogin(body = {}) {
  const email = str(body.email, 'email', { max: 254 }).toLowerCase();
  if (typeof body.password !== 'string' || body.password.length === 0) {
    throw badRequest('password is required', { field: 'password' });
  }
  return { email, password: body.password };
}

/**
 * Validates a bill payload produced by the iPhone app's receipt scanner
 * (after the member has reviewed it). Amounts are converted to integer cents.
 */
export function validateBill(body = {}) {
  const title = str(body.title, 'title', { min: 1, max: 120 });
  const merchant = str(body.merchant, 'merchant', { max: 120, optional: true });
  const description = str(body.description, 'description', { max: 1000, optional: true });
  const ocrRawText = body.ocrRawText == null ? null : str(body.ocrRawText, 'ocrRawText', { max: 60000, optional: true });

  if (!Array.isArray(body.items)) throw badRequest('items must be an array', { field: 'items' });
  if (body.items.length > MAX_ITEMS) throw badRequest(`a bill can have at most ${MAX_ITEMS} items`, { field: 'items' });

  const items = body.items.map((raw, i) => {
    const field = `items[${i}]`;
    if (!raw || typeof raw !== 'object') throw badRequest(`${field} must be an object`, { field });
    const name = str(raw.name, `${field}.name`, { min: 1, max: 200 });
    const quantityMilli = raw.quantity === undefined ? 1000 : toMilli(raw.quantity);
    if (quantityMilli === null) throw badRequest(`${field}.quantity must be a positive number`, { field: `${field}.quantity` });

    let unitPriceCents = raw.unitPrice === undefined ? null : toCents(raw.unitPrice);
    let lineTotalCents = raw.lineTotal === undefined ? null : toCents(raw.lineTotal);
    if (raw.unitPrice !== undefined && unitPriceCents === null) throw badRequest(`${field}.unitPrice is invalid`, { field: `${field}.unitPrice` });
    if (raw.lineTotal !== undefined && lineTotalCents === null) throw badRequest(`${field}.lineTotal is invalid`, { field: `${field}.lineTotal` });
    if (unitPriceCents === null && lineTotalCents === null) {
      throw badRequest(`${field} needs a unitPrice or lineTotal`, { field });
    }

    if (unitPriceCents === null) {
      // The printed line total is authoritative; the unit price is informational.
      unitPriceCents = Math.round((lineTotalCents * 1000) / quantityMilli);
    } else {
      const expected = Math.round((unitPriceCents * quantityMilli) / 1000);
      if (lineTotalCents === null) lineTotalCents = expected;
      if (Math.abs(expected - lineTotalCents) > LINE_TOTAL_TOLERANCE) {
        throw badRequest(`${field}.lineTotal does not equal quantity x unitPrice`, { field: `${field}.lineTotal` });
      }
    }
    return { lineNo: i + 1, name, quantityMilli, unitPriceCents, lineTotalCents };
  });

  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const taxCents = body.tax === undefined || body.tax === null ? 0 : toCents(body.tax);
  if (taxCents === null) throw badRequest('tax is invalid', { field: 'tax' });

  let totalCents;
  if (body.total === undefined || body.total === null) {
    totalCents = subtotalCents + taxCents;
  } else {
    totalCents = toCents(body.total);
    if (totalCents === null) throw badRequest('total is invalid', { field: 'total' });
  }
  if (subtotalCents > MAX_AMOUNT_CENTS || totalCents > MAX_AMOUNT_CENTS) {
    throw badRequest('bill amounts are too large', { field: 'total' });
  }
  if (totalCents === 0 && items.length === 0) {
    throw badRequest('a bill needs at least one item or a total', { field: 'total' });
  }

  return { title, merchant, description, ocrRawText, items, subtotalCents, taxCents, totalCents };
}
