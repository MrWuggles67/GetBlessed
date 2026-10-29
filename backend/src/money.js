// Money is handled as integer cents end-to-end to avoid floating point drift.

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const QTY_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

/** Parses "12.34" / 12.34 into 1234 cents. Returns null when invalid or negative. */
export function toCents(value) {
  const str = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim().replace(/^\$/, '');
  if (!MONEY_PATTERN.test(str)) return null;
  const [whole, frac = ''] = str.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Parses a quantity into thousandths (1.5 -> 1500). Returns null when invalid or zero. */
export function toMilli(value) {
  const str = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!QTY_PATTERN.test(str)) return null;
  const [whole, frac = ''] = str.split('.');
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  return milli > 0 ? milli : null;
}

export function centsToString(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function milliToString(milli) {
  return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`;
}
