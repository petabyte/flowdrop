/**
 * Pure-JS JSON user store.
 * Stores registered users in data/users.json:
 * {
 *   users: [{
 *     id, email, tier, apiKey,
 *     stripeCustomerId, stripeSubscriptionId,
 *     createdAt, updatedAt
 *   }]
 * }
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, JSON.stringify({ users: [] }), 'utf-8');

function readDb() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8')); }
  catch { return { users: [] }; }
}
function writeDb(data) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/** Generate a secure FlowDrop API key */
function generateApiKey() {
  return `fd_${crypto.randomBytes(24).toString('hex')}`;
}

const users = {
  findByEmail(email) {
    return readDb().users.find((u) => u.email === email) || null;
  },

  findByApiKey(apiKey) {
    return readDb().users.find((u) => u.apiKey === apiKey) || null;
  },

  findByStripeCustomer(customerId) {
    return readDb().users.find((u) => u.stripeCustomerId === customerId) || null;
  },

  findByStripeSubscription(subscriptionId) {
    return readDb().users.find((u) => u.stripeSubscriptionId === subscriptionId) || null;
  },

  /** Create a new user with a free tier API key */
  create(email, tier = 'free') {
    const db = readDb();
    const now = new Date().toISOString();
    const user = {
      id: uuidv4(),
      email,
      tier,
      apiKey: generateApiKey(),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: now,
      updatedAt: now,
    };
    db.users.push(user);
    writeDb(db);
    return user;
  },

  /** Upgrade a user's tier and set Stripe IDs after a successful payment */
  upgrade(email, tier, stripeCustomerId, stripeSubscriptionId) {
    const db = readDb();
    const idx = db.users.findIndex((u) => u.email === email);
    if (idx === -1) {
      // Create user if they don't exist yet (first-time checkout)
      return users.create(email, tier);
    }
    db.users[idx].tier = tier;
    db.users[idx].stripeCustomerId = stripeCustomerId;
    db.users[idx].stripeSubscriptionId = stripeSubscriptionId;
    db.users[idx].updatedAt = new Date().toISOString();
    // Issue a fresh API key on upgrade
    db.users[idx].apiKey = generateApiKey();
    writeDb(db);
    return db.users[idx];
  },

  /** Downgrade to free tier on subscription cancellation */
  downgrade(stripeCustomerId) {
    const db = readDb();
    const idx = db.users.findIndex((u) => u.stripeCustomerId === stripeCustomerId);
    if (idx === -1) return null;
    db.users[idx].tier = 'free';
    db.users[idx].stripeSubscriptionId = null;
    db.users[idx].updatedAt = new Date().toISOString();
    writeDb(db);
    return db.users[idx];
  },
};

module.exports = { users, generateApiKey };
