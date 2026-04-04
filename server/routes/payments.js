const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const { users } = require('../lib/users');
const { TIERS } = require('../lib/tiers');

// Plan → Stripe Price ID mapping (set these in .env after creating products in Stripe)
const PLAN_PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID,
  pro:     process.env.STRIPE_PRO_PRICE_ID,
};

const PLAN_TIERS = { starter: 'starter', pro: 'pro' };

function stripeRequired(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      error: 'Payments Unavailable',
      message: 'Stripe is not configured yet. Set STRIPE_SECRET_KEY in your .env file.',
    });
  }
  next();
}

/**
 * POST /api/payments/checkout
 * Creates a Stripe Checkout session for the selected plan.
 * Body: { email, plan: 'starter' | 'pro' }
 */
router.post('/checkout', stripeRequired, async (req, res) => {
  const { email, plan } = req.body;

  if (!email || !plan) {
    return res.status(400).json({ error: 'email and plan are required.' });
  }
  if (!PLAN_PRICE_IDS[plan]) {
    return res.status(400).json({ error: `Unknown plan: "${plan}". Choose starter or pro.` });
  }
  if (!PLAN_PRICE_IDS[plan]) {
    return res.status(503).json({
      error: 'Price not configured.',
      message: `Set STRIPE_${plan.toUpperCase()}_PRICE_ID in your .env file.`,
    });
  }

  try {
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: PLAN_PRICE_IDS[plan], quantity: 1 }],
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/#pricing`,
      metadata: { plan, email },
      subscription_data: {
        metadata: { plan, email },
      },
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed', message: err.message });
  }
});

/**
 * POST /api/payments/free
 * Issues a free-tier API key without Stripe (no payment needed).
 * Body: { email }
 */
router.post('/free', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  let user = users.findByEmail(email);
  if (!user) user = users.create(email, 'free');

  res.json({
    success: true,
    message: 'Free API key issued.',
    apiKey: user.apiKey,
    tier: user.tier,
    retention: TIERS.free.description,
  });
});

/**
 * POST /api/payments/webhook
 * Stripe sends events here. Must be a raw body.
 * Handles: checkout.session.completed, customer.subscription.deleted
 */
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.sendStatus(200); // Stripe not configured, ignore

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { email, plan } = session.metadata || {};
      if (email && plan && PLAN_TIERS[plan]) {
        const user = users.upgrade(
          email,
          PLAN_TIERS[plan],
          session.customer,
          session.subscription
        );
        console.log(`[Stripe] Upgraded ${email} to ${plan}. API key: ${user.apiKey}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = users.downgrade(sub.customer);
      if (user) {
        console.log(`[Stripe] Subscription cancelled for ${user.email}. Downgraded to free.`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      console.warn('[Stripe] Payment failed for customer:', event.data.object.customer);
      break;
    }
  }

  res.sendStatus(200);
});

/**
 * GET /api/payments/session/:sessionId
 * Returns the API key for a completed checkout session.
 * Used by the /success page.
 */
router.get('/session/:sessionId', stripeRequired, async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    const email = session.customer_details?.email || session.metadata?.email;
    const user = email ? users.findByEmail(email) : null;

    if (!user) {
      return res.status(404).json({ error: 'User not found. Webhook may still be processing.' });
    }

    res.json({
      success: true,
      email: user.email,
      tier: user.tier,
      apiKey: user.apiKey,
      retention: TIERS[user.tier]?.description,
    });
  } catch (err) {
    console.error('[Stripe] Session lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payments/portal
 * Redirects user to Stripe Customer Portal to manage their subscription.
 * Query: ?email=user@example.com
 */
router.get('/portal', stripeRequired, async (req, res) => {
  const { email } = req.query;
  const user = email ? users.findByEmail(email) : null;

  if (!user?.stripeCustomerId) {
    return res.status(404).json({ error: 'No active subscription found for this email.' });
  }

  try {
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: baseUrl,
    });
    res.redirect(portalSession.url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
