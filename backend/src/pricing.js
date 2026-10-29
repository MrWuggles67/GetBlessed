// Prices for Blessings members. Subscription prices are also configured on the
// App Store (App Store Connect / ios/GetBlessed.storekit); these values must
// match them.
//
// The App Store's longest auto-renewing period is 1 year, so the 2-Year plan is
// a non-renewing subscription: one purchase, and the server ends access after
// `months`.

export const PLANS = Object.freeze({
  monthly: { productId: 'com.getblessed.app.blessings.monthly', name: 'Monthly', period: '1 month', months: 1, autoRenews: true, priceCents: 999 },
  yearly: { productId: 'com.getblessed.app.blessings.yearly', name: '1-Year', period: '1 year', months: 12, autoRenews: true, priceCents: 6999 },
  two_year: { productId: 'com.getblessed.app.blessings.twoyear', name: '2-Year', period: '2 years', months: 24, autoRenews: false, priceCents: 10499 },
});

/** Tip Service Fee charged on every blessing: $1.99 for every started $800. */
export const TIP_SERVICE_FEE = Object.freeze({ feeCents: 199, perCents: 80_000 });

export function planForProductId(productId) {
  return Object.keys(PLANS).find((plan) => PLANS[plan].productId === productId) ?? null;
}

/** $0.01-$800 -> $1.99, $800.01-$1,600 -> $3.98, and so on. */
export function tipServiceFeeCents(amountCents) {
  if (amountCents <= 0) return 0;
  return TIP_SERVICE_FEE.feeCents * Math.ceil(amountCents / TIP_SERVICE_FEE.perCents);
}
