import { centsToString } from './money.js';
import { serializeSubscription } from './subscriptions.js';

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
  if (profile) {
    user.annualIncome = money(profile.annual_income);
    // Passed to StoreKit as appAccountToken so purchases are tied to this member.
    user.appAccountToken = profile.app_account_token;
    user.subscription = serializeSubscription(profile.subscription);
  }
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
    amountBlessed: money(row.amount_blessed),
    amountRemaining: centsToString(Math.max(0, Math.round(Number(row.total) * 100) - Math.round(Number(row.amount_blessed) * 100))),
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

export function serializeBlessing(row) {
  return {
    id: row.public_id,
    billId: row.bill_public_id,
    billTitle: row.bill_title,
    amount: money(row.amount),
    tipServiceFee: money(row.tip_service_fee),
    chargeTotal: money(row.charge_total),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
  };
}
