/**
 * Pure-JS JSON file database for tracking uploads.
 * No native binaries required — works on any Node version.
 *
 * Data is stored in ../data/uploads.json
 * Uses synchronous fs for simplicity (file is small, write path is infrequent).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'uploads.json');

// Ensure data directory + file exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ uploads: [] }), 'utf-8');

/** Read the full DB from disk */
function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { uploads: [] };
  }
}

/** Persist the full DB to disk */
function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

const stmts = {
  /** Insert a new upload record */
  insert(record) {
    const db = readDb();
    db.uploads.push(record);
    writeDb(db);
  },

  /** List uploads, optionally filtered by tier, with pagination */
  listAll(limit = 20, offset = 0) {
    const db = readDb();
    return [...db.uploads]
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
      .slice(offset, offset + limit);
  },

  listByTier(tier, limit = 20, offset = 0) {
    const db = readDb();
    return db.uploads
      .filter((u) => u.tier === tier)
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
      .slice(offset, offset + limit);
  },

  /** Find a single upload by R2 key */
  findByKey(key) {
    return readDb().uploads.find((u) => u.key === key) || null;
  },

  /** Delete a record by R2 key */
  deleteByKey(key) {
    const db = readDb();
    db.uploads = db.uploads.filter((u) => u.key !== key);
    writeDb(db);
  },

  /** Return all uploads where expires_at is in the past */
  findExpired() {
    const now = new Date();
    return readDb().uploads.filter(
      (u) => u.expires_at && new Date(u.expires_at) <= now
    );
  },

  /** Return counts and total bytes per tier */
  countByTier() {
    const db = readDb();
    const result = {};
    for (const u of db.uploads) {
      if (!result[u.tier]) result[u.tier] = { tier: u.tier, count: 0, total_bytes: 0 };
      result[u.tier].count++;
      result[u.tier].total_bytes += u.size || 0;
    }
    return Object.values(result);
  },
};

module.exports = { stmts };
