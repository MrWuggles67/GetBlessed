const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Validates items [{name, quantity, price}] (price = line total) and returns cleaned items plus the total.
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
    throw new Error('A bill needs between 1 and 200 items');
  }
  const clean = items.map((i) => {
    const name = String(i.name || '').trim().slice(0, 200);
    const quantity = Number.isInteger(Number(i.quantity)) && Number(i.quantity) > 0 ? Number(i.quantity) : 1;
    const price = Number(i.price);
    if (!name || !Number.isFinite(price) || price < 0 || price > 1e9) throw new Error('Invalid item: ' + (name || '(unnamed)'));
    return { name, quantity, price: round2(price) };
  });
  return { items: clean, total: round2(clean.reduce((s, i) => s + i.price, 0)) };
}

module.exports = { normalizeItems, round2 };
