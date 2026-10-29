import { centsToString } from './money.js';

const money = (decimalString) => centsToString(Math.round(Number(decimalString) * 100));

export function serializeUser(row, profile) {
  const user = {
    id: row.public_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
  // Income is private: it is only ever returned to the member themselves.
  if (profile) user.annualIncome = money(profile.annual_income);
  return user;
}

export function serializeBill(row, items) {
  const bill = {
    id: row.public_id,
    title: row.title,
    merchant: row.merchant,
    description: row.description,
    itemCount: row.item_count,
    subtotal: money(row.subtotal),
    tax: money(row.tax),
    total: money(row.total),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    imageUrl: `/api/bills/${row.public_id}/image`,
    postedBy: { id: row.poster_public_id, displayName: row.poster_display_name },
  };
  if (items) {
    bill.items = items.map((item) => ({
      lineNo: item.line_no,
      name: item.name,
      quantity: Number(item.quantity),
      unitPrice: money(item.unit_price),
      lineTotal: money(item.line_total),
    }));
  }
  return bill;
}
