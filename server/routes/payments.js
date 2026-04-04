const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const { users } = require('../lib/users');
const { requireAuth } = require('../middleware/requireAuth');

const PLAN_PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID,
  pro: process.env.STRIPE_PRO_PRICE_ID,
};

const TIER_FOR_PLAN = { starter: 'starter', pro: 'pro' };

function stripeRequired(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      error: 'Payments Unavailable',
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY in your .env file.',
    });
  }
  next();
}

/**
 * POST /api/payments/checkout
 * Requires the user to be logged in. Creates a Stripe Checkout session.
 * Body: { plan: 'starter' | 'pro' }
 */
router.post('/checkout', requireAuth, stripeRequired, async (req, res) => {
  const { plan } = req.body;
  if (!plan || !PLAN_PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'plan must be "starter" or "pro".' });
  }

  try {
    const user = req.user;
    let stripeCustomerId = user.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: user.email });
      stripeCustomerId = customer.id;
      await users.updateStripeCustomerId(user.id, stripeCustomerId);
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: PLAN_PRICE_IDS[plan], quantity: 1 }],
      success_url: `${baseUrl}/dashboard?upgraded=1`,
      cancel_url: `${baseUrl}/dashboard`,
      metadata: { user_id: user.id, plan },
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed', message: err.message });
  }
});

/**
 * GET /api/payments/portal
 * Redirects the logged-in user to the Stripe Customer Portal.
 */
router.get('/portal', requireAuth, stripeRequired, async (req, res) => {
  const user = req.user;
  if (!user.stripe_customer_id) {
    return res.status(404).json({ error: 'No active subscription found.' });
  }

  try {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${baseUrl}/dashboard`,
    });
    res.redirect(portalSession.url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payments/webhook
 */
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { user_id, plan } = session.metadata || {};
      if (user_id && plan && TIER_FOR_PLAN[plan]) {
        await users.updateTier(user_id, TIER_FOR_PLAN[plan]);
        console.log(`[Stripe] Upgraded user ${user_id} to ${plan}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = await users.findByStripeCustomerId(sub.customer);
      if (user) {
        await users.updateTier(user.id, 'free');
        console.log(`[Stripe] Downgraded user ${user.id} to free`);
      }
      break;
    }

    case 'invoice.payment_failed':
      console.warn('[Stripe] Payment failed for customer:', event.data.object.customer);
      break;
  }

  res.sendStatus(200);
});

module.exports = router;
