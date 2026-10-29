import Stripe from 'stripe';

/**
 * Stripe card payments for blessings. Returns null when not configured.
 * The iPhone app completes payment with Stripe's PaymentSheet; the result
 * arrives at POST /api/stripe/webhook.
 */
export function createStripePayments(config) {
  if (!config.secretKey || !config.webhookSecret || !config.publishableKey) return null;
  const stripe = new Stripe(config.secretKey);
  return {
    publishableKey: config.publishableKey,
    async createPaymentIntent({ amountCents, currency, metadata, idempotencyKey }) {
      const intent = await stripe.paymentIntents.create(
        { amount: amountCents, currency: currency.toLowerCase(), metadata, automatic_payment_methods: { enabled: true } },
        { idempotencyKey },
      );
      return { id: intent.id, clientSecret: intent.client_secret };
    },
    parseWebhook(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
    },
  };
}
