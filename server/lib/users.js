const pool = require('./db-pg');
const crypto = require('crypto');

function generateApiKey() {
  return `fd_${crypto.randomBytes(24).toString('hex')}`;
}

const users = {
  async findByEmail(email) {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async findByApiKey(apiKey) {
    const { rows } = await pool.query('SELECT * FROM users WHERE api_key = $1', [apiKey]);
    return rows[0] || null;
  },

  async findByGoogleId(googleId) {
    const { rows } = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    return rows[0] || null;
  },

  async findByGithubId(githubId) {
    const { rows } = await pool.query('SELECT * FROM users WHERE github_id = $1', [githubId]);
    return rows[0] || null;
  },

  async findByStripeCustomerId(stripeCustomerId) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE stripe_customer_id = $1',
      [stripeCustomerId]
    );
    return rows[0] || null;
  },

  async create({ email, passwordHash = null, googleId = null, githubId = null }) {
    const apiKey = generateApiKey();
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, google_id, github_id, api_key, api_key_expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + INTERVAL '7 days') RETURNING *`,
      [email, passwordHash, googleId, githubId, apiKey]
    );
    return rows[0];
  },

  async updateTier(id, tier) {
    const { rows } = await pool.query(
      `UPDATE users SET
         tier = $1,
         api_key_expires_at = CASE WHEN $1 = 'free' THEN now() + INTERVAL '7 days' ELSE NULL END
       WHERE id = $2 RETURNING *`,
      [tier, id]
    );
    return rows[0];
  },

  async updateApiKey(id) {
    const apiKey = generateApiKey();
    const { rows } = await pool.query(
      'UPDATE users SET api_key = $1 WHERE id = $2 RETURNING *',
      [apiKey, id]
    );
    return rows[0];
  },

  async updateStripeCustomerId(id, stripeCustomerId) {
    const { rows } = await pool.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2 RETURNING *',
      [stripeCustomerId, id]
    );
    return rows[0];
  },

  async findUsersNearExpiry() {
    const { rows } = await pool.query(`
      SELECT id, email, api_key_expires_at
      FROM users
      WHERE tier = 'free'
        AND api_key_expires_at BETWEEN now() AND now() + INTERVAL '3 days'
        AND trial_reminder_sent_at IS NULL
    `);
    return rows;
  },

  async updateTrialReminderSent(id) {
    await pool.query(
      'UPDATE users SET trial_reminder_sent_at = now() WHERE id = $1',
      [id]
    );
  },
};

module.exports = { users, generateApiKey };
