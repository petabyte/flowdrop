const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[Stripe] WARNING: STRIPE_SECRET_KEY not set. Payment features disabled.');
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

module.exports = stripe;
