const pool = require('./db-pg');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR,
      google_id VARCHAR,
      github_id VARCHAR,
      tier VARCHAR NOT NULL DEFAULT 'free',
      api_key VARCHAR(64) UNIQUE NOT NULL,
      stripe_customer_id VARCHAR,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key VARCHAR UNIQUE NOT NULL,
      filename VARCHAR NOT NULL,
      mimetype VARCHAR NOT NULL,
      size BIGINT NOT NULL,
      url TEXT NOT NULL,
      tier VARCHAR NOT NULL,
      uploaded_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_uploads_expires_at ON uploads(expires_at)`);

  // Free tier trial expiry columns
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMPTZ`);

  // Backfill existing free users: expires 7 days after account creation
  await pool.query(`
    UPDATE users
    SET api_key_expires_at = created_at + INTERVAL '7 days'
    WHERE tier = 'free' AND api_key_expires_at IS NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_trial_expiry
    ON users(tier, api_key_expires_at)
    WHERE tier = 'free'
  `);

  console.log('[DB] Migration complete');
}

module.exports = { migrate };
