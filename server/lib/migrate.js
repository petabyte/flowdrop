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

  console.log('[DB] Migration complete');
}

module.exports = { migrate };
