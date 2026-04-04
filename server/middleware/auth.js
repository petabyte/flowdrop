const { users } = require('../lib/users');
const { TIERS } = require('../lib/tiers');

async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Pass via x-api-key header or ?api_key= query param.',
    });
  }

  try {
    const user = await users.findByApiKey(apiKey);
    if (!user) {
      return res.status(403).json({ error: 'Forbidden', message: 'Invalid API key.' });
    }
    req.user = user;
    req.userTier = user.tier;
    req.tierConfig = TIERS[user.tier];
    next();
  } catch (err) {
    console.error('[Auth] DB error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
}

module.exports = { requireApiKey };
