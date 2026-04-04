const pool = require('./db-pg');

const stmts = {
  async insert(record) {
    await pool.query(
      `INSERT INTO uploads (id, user_id, key, filename, mimetype, size, url, tier, uploaded_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.id, record.user_id, record.key, record.filename,
        record.mimetype, record.size, record.url, record.tier,
        record.uploaded_at, record.expires_at,
      ]
    );
  },

  async listByUser(userId, limit, offset) {
    const { rows } = await pool.query(
      'SELECT * FROM uploads WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return rows;
  },

  async listByTier(tier, limit, offset) {
    const { rows } = await pool.query(
      'SELECT * FROM uploads WHERE tier = $1 ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3',
      [tier, limit, offset]
    );
    return rows;
  },

  async listByUserAndTier(userId, tier, limit, offset) {
    const { rows } = await pool.query(
      'SELECT * FROM uploads WHERE user_id = $1 AND tier = $2 ORDER BY uploaded_at DESC LIMIT $3 OFFSET $4',
      [userId, tier, limit, offset]
    );
    return rows;
  },

  async listAll(limit, offset) {
    const { rows } = await pool.query(
      'SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows;
  },

  async findByKey(key) {
    const { rows } = await pool.query('SELECT * FROM uploads WHERE key = $1', [key]);
    return rows[0] || null;
  },

  async deleteByKey(key) {
    await pool.query('DELETE FROM uploads WHERE key = $1', [key]);
  },

  async findExpired() {
    const { rows } = await pool.query(
      'SELECT * FROM uploads WHERE expires_at IS NOT NULL AND expires_at <= now()'
    );
    return rows;
  },

  async countByTier() {
    const { rows } = await pool.query(
      `SELECT tier,
              COUNT(*)::int AS count,
              COALESCE(SUM(size), 0)::bigint AS total_bytes
       FROM uploads GROUP BY tier`
    );
    return rows;
  },
};

module.exports = { stmts };
