/**
 * API Key authentication middleware
 * Reads from `x-api-key` header or `?api_key=` query param
 */
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Pass via x-api-key header or ?api_key= query param.',
    });
  }

  if (apiKey !== process.env.API_KEY_SECRET) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key.',
    });
  }

  next();
}

module.exports = { requireApiKey };
