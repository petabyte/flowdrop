/**
 * Subscription tier configuration
 *
 * Each tier maps to:
 *  - retentionDays: how long files are kept (null = forever)
 *  - maxUploadsPerMonth: soft limit enforced via API key
 *  - maxFileSizeMB: per-file size cap
 *  - label / price: display info
 *
 * Tier is resolved from the API key at upload time (see tierFromApiKey).
 */

const TIERS = {
  free: {
    label: 'Free',
    price: '$0/mo',
    retentionDays: 7,          // files deleted after 7 days
    maxUploadsPerMonth: 25,
    maxFileSizeMB: 10,
    description: '7-day file retention',
  },
  starter: {
    label: 'Starter',
    price: '$9/mo',
    retentionDays: 30,         // files deleted after 30 days
    maxUploadsPerMonth: 1000,
    maxFileSizeMB: 50,
    description: '30-day file retention',
  },
  pro: {
    label: 'Pro',
    price: '$29/mo',
    retentionDays: null,       // null = never expires
    maxUploadsPerMonth: 6000,
    maxFileSizeMB: 200,
    description: 'Files never expire',
  },
};

/**
 * Calculate the ISO 8601 expiry datetime for a given tier.
 * Returns null if the tier never expires.
 *
 * @param {string} tier - 'free' | 'starter' | 'pro'
 * @returns {string|null}
 */
function calcExpiresAt(tier) {
  const config = TIERS[tier];
  if (!config || config.retentionDays === null) return null;

  const d = new Date();
  d.setDate(d.getDate() + config.retentionDays);
  return d.toISOString();
}

module.exports = { TIERS, calcExpiresAt };
