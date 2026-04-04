# Auth & User Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared-API-key system with real user accounts backed by PostgreSQL, adding email/password and OAuth login, JWT sessions, and a user dashboard.

**Architecture:** Add Railway PostgreSQL as the persistence layer. Rewrite `users.js` and `db.js` to use `pg` instead of JSON files. Add JWT-cookie sessions via `jsonwebtoken` and `cookie-parser`. Add Passport.js for Google/GitHub OAuth. All existing upload/payments routes are updated to be async and user-scoped.

**Tech Stack:** `pg`, `bcrypt`, `jsonwebtoken`, `cookie-parser`, `passport`, `passport-google-oauth20`, `passport-github2`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `server/lib/db-pg.js` | pg Pool singleton |
| Create | `server/lib/migrate.js` | CREATE TABLE on startup |
| Rewrite | `server/lib/users.js` | User CRUD against Postgres |
| Rewrite | `server/lib/db.js` | Upload CRUD against Postgres |
| Create | `server/lib/jwt.js` | Sign/verify JWT, set/clear cookie |
| Rewrite | `server/middleware/auth.js` | API key lookup in DB |
| Create | `server/middleware/requireAuth.js` | JWT cookie auth for dashboard routes |
| Create | `server/routes/auth.js` | Register, login, logout, me, regenerate-key, OAuth |
| Rewrite | `server/routes/upload.js` | Async DB calls, uploads scoped to user |
| Rewrite | `server/routes/payments.js` | User-linked checkout, webhook, portal |
| Modify | `server/lib/tiers.js` | Remove `tierFromApiKey` env-var lookups |
| Modify | `server/index.js` | Add cookie-parser, passport, auth routes, migrate() |
| Create | `public/login.html` | Login page |
| Create | `public/signup.html` | Signup page |
| Create | `public/dashboard.html` | Authenticated user dashboard |
| Create | `public/dashboard.js` | Dashboard frontend logic |
| Modify | `public/index.html` | CTA → /signup, auth redirect |
| Update | `server/.env.example` | Add new vars, remove shared key vars |
| Update | `DEPLOYMENT.md` | Add Railway Postgres provisioning step |

---

## Task 1: Install dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install new packages**

```bash
cd server
npm install pg bcrypt jsonwebtoken cookie-parser passport passport-google-oauth20 passport-github2
```

Expected output: packages added to `node_modules/`, `package.json` updated with new entries under `"dependencies"`.

- [ ] **Step 2: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: install auth dependencies"
```

---

## Task 2: Create Postgres connection pool

**Files:**
- Create: `server/lib/db-pg.js`

- [ ] **Step 1: Create the pool module**

Create `server/lib/db-pg.js`:

```javascript
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
```

- [ ] **Step 2: Verify it loads without error**

```bash
cd server
node -e "require('./lib/db-pg'); console.log('Pool created')"
```

Expected: `Pool created` (no error — Pool doesn't connect until first query)

- [ ] **Step 3: Commit**

```bash
git add server/lib/db-pg.js
git commit -m "feat: add pg connection pool"
```

---

## Task 3: Write database migration

**Files:**
- Create: `server/lib/migrate.js`

- [ ] **Step 1: Create migrate.js**

Create `server/lib/migrate.js`:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/migrate.js
git commit -m "feat: add database migration for users and uploads tables"
```

---

## Task 4: Rewrite users.js for Postgres

**Files:**
- Rewrite: `server/lib/users.js`

- [ ] **Step 1: Replace users.js entirely**

Overwrite `server/lib/users.js`:

```javascript
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
      `INSERT INTO users (email, password_hash, google_id, github_id, api_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [email, passwordHash, googleId, githubId, apiKey]
    );
    return rows[0];
  },

  async updateTier(id, tier) {
    const { rows } = await pool.query(
      'UPDATE users SET tier = $1 WHERE id = $2 RETURNING *',
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
    await pool.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [stripeCustomerId, id]
    );
  },
};

module.exports = { users, generateApiKey };
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
node -e "const { users } = require('./lib/users'); console.log(typeof users.findByEmail)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add server/lib/users.js
git commit -m "feat: rewrite users.js with PostgreSQL"
```

---

## Task 5: Rewrite db.js for Postgres

**Files:**
- Rewrite: `server/lib/db.js`

- [ ] **Step 1: Replace db.js entirely**

Overwrite `server/lib/db.js`:

```javascript
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
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
node -e "const { stmts } = require('./lib/db'); console.log(typeof stmts.insert)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add server/lib/db.js
git commit -m "feat: rewrite db.js with PostgreSQL"
```

---

## Task 6: Remove tierFromApiKey from tiers.js

**Files:**
- Modify: `server/lib/tiers.js`

- [ ] **Step 1: Remove the tierFromApiKey function**

Delete the `tierFromApiKey` function from `server/lib/tiers.js` (lines 52–57) and remove it from `module.exports`. The tier is now derived from the authenticated user row, not env vars.

The final `module.exports` line should be:

```javascript
module.exports = { TIERS, calcExpiresAt };
```

- [ ] **Step 2: Verify**

```bash
cd server
node -e "const t = require('./lib/tiers'); console.log(Object.keys(t))"
```

Expected: `[ 'TIERS', 'calcExpiresAt' ]`

- [ ] **Step 3: Commit**

```bash
git add server/lib/tiers.js
git commit -m "refactor: remove tierFromApiKey, tier now comes from user row"
```

---

## Task 7: Create JWT helpers

**Files:**
- Create: `server/lib/jwt.js`

- [ ] **Step 1: Create jwt.js**

Create `server/lib/jwt.js`:

```javascript
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'session';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

function setSessionCookie(res, user) {
  const token = jwt.sign(
    { user_id: user.id, tier: user.tier },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { setSessionCookie, clearSessionCookie, verifyToken, COOKIE_NAME };
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/jwt.js
git commit -m "feat: add JWT session helpers"
```

---

## Task 8: Rewrite requireApiKey middleware

**Files:**
- Rewrite: `server/middleware/auth.js`

- [ ] **Step 1: Replace auth.js**

Overwrite `server/middleware/auth.js`:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add server/middleware/auth.js
git commit -m "feat: update requireApiKey to look up API key in Postgres"
```

---

## Task 9: Create requireAuth middleware

**Files:**
- Create: `server/middleware/requireAuth.js`

- [ ] **Step 1: Create requireAuth.js**

Create `server/middleware/requireAuth.js`:

```javascript
const { verifyToken, COOKIE_NAME } = require('../lib/jwt');
const { users } = require('../lib/users');

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = verifyToken(token);
    const user = await users.findById(payload.user_id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };
```

- [ ] **Step 2: Commit**

```bash
git add server/middleware/requireAuth.js
git commit -m "feat: add requireAuth JWT cookie middleware"
```

---

## Task 10: Create auth routes

**Files:**
- Create: `server/routes/auth.js`

- [ ] **Step 1: Create auth.js**

Create `server/routes/auth.js`:

```javascript
const express = require('express');
const bcrypt = require('bcrypt');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Strategy: GitHubStrategy } = require('passport-github2');
const pool = require('../lib/db-pg');
const { users } = require('../lib/users');
const { setSessionCookie, clearSessionCookie } = require('../lib/jwt');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// ─── Passport OAuth Strategies ───────────────────────────────────────────────

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL}/auth/google/callback`,
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await users.findByGoogleId(profile.id);
      if (!user) {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error('Google account has no email'));
        user = await users.findByEmail(email);
        if (user) {
          await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, user.id]);
          user = await users.findById(user.id);
        } else {
          user = await users.create({ email, googleId: profile.id });
        }
      }
      done(null, user);
    } catch (err) { done(err); }
  }
));

passport.use(new GitHubStrategy(
  {
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL}/auth/github/callback`,
    scope: ['user:email'],
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await users.findByGithubId(String(profile.id));
      if (!user) {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error('GitHub account has no public email'));
        user = await users.findByEmail(email);
        if (user) {
          await pool.query('UPDATE users SET github_id = $1 WHERE id = $2', [String(profile.id), user.id]);
          user = await users.findById(user.id);
        } else {
          user = await users.create({ email, githubId: String(profile.id) });
        }
      }
      done(null, user);
    } catch (err) { done(err); }
  }
));

// ─── Email / Password ─────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const existing = await users.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await users.create({ email, passwordHash });
    setSessionCookie(res, user);
    res.status(201).json({
      success: true,
      user: { id: user.id, email: user.email, tier: user.tier, api_key: user.api_key },
    });
  } catch (err) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const user = await users.findByEmail(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    setSessionCookie(res, user);
    res.json({
      success: true,
      user: { id: user.id, email: user.email, tier: user.tier, api_key: user.api_key },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  const { id, email, tier, api_key, created_at } = req.user;
  res.json({ success: true, user: { id, email, tier, api_key, created_at } });
});

router.post('/regenerate-key', requireAuth, async (req, res) => {
  try {
    const user = await users.updateApiKey(req.user.id);
    res.json({ success: true, api_key: user.api_key });
  } catch (err) {
    console.error('[Auth] Regenerate key error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// ─── OAuth ────────────────────────────────────────────────────────────────────

router.get('/google', passport.authenticate('google', { scope: ['email', 'profile'], session: false }));
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=oauth' }),
  (req, res) => { setSessionCookie(res, req.user); res.redirect('/dashboard'); }
);

router.get('/github', passport.authenticate('github', { scope: ['user:email'], session: false }));
router.get('/github/callback',
  passport.authenticate('github', { session: false, failureRedirect: '/login?error=oauth' }),
  (req, res) => { setSessionCookie(res, req.user); res.redirect('/dashboard'); }
);

module.exports = { router, passport };
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
node -e "require('./routes/auth'); console.log('Auth routes loaded')"
```

Expected: `Auth routes loaded` (OAuth strategies will warn about missing env vars — that's fine at load time)

- [ ] **Step 3: Commit**

```bash
git add server/routes/auth.js
git commit -m "feat: add auth routes (register, login, logout, OAuth)"
```

---

## Task 11: Rewrite upload.js with async DB and user scoping

**Files:**
- Rewrite: `server/routes/upload.js`

- [ ] **Step 1: Replace upload.js**

Overwrite `server/routes/upload.js`:

```javascript
const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const r2Client = require('../lib/r2');
const { stmts } = require('../lib/db');
const { calcExpiresAt, TIERS } = require('../lib/tiers');
const { cleanupExpiredFiles, getRetentionSummary } = require('../lib/cleanup');
const { requireApiKey } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/pdf',
  'text/plain', 'text/csv', 'text/html',
  'application/json',
  'application/zip', 'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function buildUploader(maxFileSizeMB) {
  return multer({
    storage: multerS3({
      s3: r2Client,
      bucket: process.env.R2_BUCKET_NAME,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
      },
      metadata: (req, file, cb) => {
        cb(null, { originalName: file.originalname, uploadedAt: new Date().toISOString(), tier: req.userTier || 'free' });
      },
    }),
    limits: { fileSize: maxFileSizeMB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
      cb(new Error(`File type "${file.mimetype}" is not allowed.`), false);
    },
  });
}

/**
 * POST /api/upload
 */
router.post('/upload', uploadLimiter, requireApiKey, (req, res) => {
  const maxSizeMB = req.tierConfig.maxFileSizeMB;
  const uploader = buildUploader(maxSizeMB);

  uploader.array('file', 10)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'File Too Large',
          message: `Your ${req.tierConfig.label} plan allows up to ${maxSizeMB}MB per file.`,
        });
      }
      return res.status(400).json({ error: 'Upload Failed', message: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No Files', message: 'No files were uploaded.' });
    }

    const now = new Date().toISOString();
    const results = [];

    try {
      for (const file of req.files) {
        const id = file.key.split('.')[0];
        const expiresAt = calcExpiresAt(req.userTier);
        const url = `${process.env.R2_PUBLIC_URL}/${file.key}`;

        await stmts.insert({
          id,
          user_id: req.user.id,
          key: file.key,
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url,
          tier: req.userTier,
          uploaded_at: now,
          expires_at: expiresAt,
        });

        results.push({
          id, key: file.key, filename: file.originalname,
          size: file.size, mimetype: file.mimetype, url,
          tier: req.userTier, uploadedAt: now, expiresAt,
          retention: req.tierConfig.description,
        });
      }
    } catch (dbErr) {
      console.error('[Upload] DB insert error:', dbErr.message);
      return res.status(500).json({ error: 'Server Error', message: 'Failed to record upload.' });
    }

    res.status(200).json({ success: true, count: results.length, files: results });
  });
});

/**
 * GET /api/files
 */
router.get('/files', requireApiKey, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);
  const tier = req.query.tier;

  try {
    const files = tier
      ? await stmts.listByTier(tier, limit, offset)
      : await stmts.listByUser(req.user.id, limit, offset);

    res.json({ success: true, count: files.length, files });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * DELETE /api/files/:key
 */
router.delete('/files/:key', requireApiKey, async (req, res) => {
  const key = req.params.key;
  if (!key || key.includes('..') || key.includes('/')) {
    return res.status(400).json({ error: 'Invalid Key' });
  }

  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    await stmts.deleteByKey(key);
    res.json({ success: true, message: `File "${key}" deleted.` });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/admin/cleanup
 */
router.post('/admin/cleanup', requireApiKey, async (req, res) => {
  try {
    const result = await cleanupExpiredFiles();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Cleanup Failed', message: err.message });
  }
});

/**
 * GET /api/admin/stats
 */
router.get('/admin/stats', requireApiKey, async (req, res) => {
  try {
    const stats = await stmts.countByTier();
    const retention = getRetentionSummary();
    res.json({
      success: true,
      tiers: retention.map((t) => {
        const s = stats.find((r) => r.tier === t.tier) || { count: 0, total_bytes: 0 };
        return { ...t, uploads: s.count, storageBytes: Number(s.total_bytes) };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
node -e "require('./routes/upload'); console.log('Upload routes loaded')"
```

Expected: `Upload routes loaded`

- [ ] **Step 3: Commit**

```bash
git add server/routes/upload.js
git commit -m "feat: update upload routes for async Postgres and user-scoped file listing"
```

---

## Task 12: Rewrite payments.js with user-linked checkout

**Files:**
- Rewrite: `server/routes/payments.js`

- [ ] **Step 1: Replace payments.js**

Overwrite `server/routes/payments.js`:

```javascript
const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const { users } = require('../lib/users');
const { TIERS } = require('../lib/tiers');
const { requireAuth } = require('../middleware/requireAuth');

const PLAN_PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID,
  pro: process.env.STRIPE_PRO_PRICE_ID,
};

const TIER_FOR_PLAN = { starter: 'starter', pro: 'pro' };

function stripeRequired(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      error: 'Payments Unavailable',
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY in your .env file.',
    });
  }
  next();
}

/**
 * POST /api/payments/checkout
 * Requires the user to be logged in. Creates a Stripe Checkout session.
 * Body: { plan: 'starter' | 'pro' }
 */
router.post('/checkout', requireAuth, stripeRequired, async (req, res) => {
  const { plan } = req.body;
  if (!plan || !PLAN_PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'plan must be "starter" or "pro".' });
  }
  if (!PLAN_PRICE_IDS[plan]) {
    return res.status(503).json({ error: `Set STRIPE_${plan.toUpperCase()}_PRICE_ID in your .env.` });
  }

  try {
    const user = req.user;
    let stripeCustomerId = user.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: user.email });
      stripeCustomerId = customer.id;
      await users.updateStripeCustomerId(user.id, stripeCustomerId);
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: PLAN_PRICE_IDS[plan], quantity: 1 }],
      success_url: `${baseUrl}/dashboard?upgraded=1`,
      cancel_url: `${baseUrl}/dashboard`,
      metadata: { user_id: user.id, plan },
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed', message: err.message });
  }
});

/**
 * GET /api/payments/portal
 * Redirects the logged-in user to the Stripe Customer Portal.
 */
router.get('/portal', requireAuth, stripeRequired, async (req, res) => {
  const user = req.user;
  if (!user.stripe_customer_id) {
    return res.status(404).json({ error: 'No active subscription found.' });
  }

  try {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${baseUrl}/dashboard`,
    });
    res.redirect(portalSession.url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payments/webhook
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { user_id, plan } = session.metadata || {};
      if (user_id && plan && TIER_FOR_PLAN[plan]) {
        await users.updateTier(user_id, TIER_FOR_PLAN[plan]);
        console.log(`[Stripe] Upgraded user ${user_id} to ${plan}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = await users.findByStripeCustomerId(sub.customer);
      if (user) {
        await users.updateTier(user.id, 'free');
        console.log(`[Stripe] Downgraded user ${user.id} to free`);
      }
      break;
    }

    case 'invoice.payment_failed':
      console.warn('[Stripe] Payment failed for customer:', event.data.object.customer);
      break;
  }

  res.sendStatus(200);
});

module.exports = router;
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
node -e "require('./routes/payments'); console.log('Payments routes loaded')"
```

Expected: `Payments routes loaded`

- [ ] **Step 3: Commit**

```bash
git add server/routes/payments.js
git commit -m "feat: link Stripe checkout and webhook to user accounts"
```

---

## Task 13: Update index.js

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add cookie-parser, passport, auth routes, and migration call**

Replace `server/index.js` with:

```javascript
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const passport = require('passport');

const { apiLimiter } = require('./middleware/rateLimit');
const uploadRoutes = require('./routes/upload');
const paymentRoutes = require('./routes/payments');
const { router: authRoutes } = require('./routes/auth');
const { startCleanupScheduler } = require('./lib/scheduler');
const { migrate } = require('./lib/migrate');
const { TIERS } = require('./lib/tiers');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin))
      return cb(null, true);
    cb(new Error(`CORS policy: origin "${origin}" not allowed.`));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  credentials: true,
}));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(passport.initialize());

// ─── Serve Frontend ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api', apiLimiter, uploadRoutes);
app.use('/api/payments', paymentRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bucket: process.env.R2_BUCKET_NAME || 'not configured',
    tiers: Object.fromEntries(
      Object.entries(TIERS).map(([k, v]) => [k, {
        retentionDays: v.retentionDays,
        maxFileSizeMB: v.maxFileSizeMB,
        maxUploadsPerMonth: v.maxUploadsPerMonth,
      }])
    ),
    cleanupSchedule: process.env.CLEANUP_CRON || '0 2 * * * (2:00 AM daily)',
  });
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await migrate();
  app.listen(PORT, () => {
    console.log(`\n🚀 FlowDrop running at http://localhost:${PORT}`);
    console.log(`   → Health:    GET  http://localhost:${PORT}/api/health`);
    console.log(`   → Upload:    POST http://localhost:${PORT}/api/upload`);
    console.log(`   → Files:     GET  http://localhost:${PORT}/api/files`);
    console.log(`   → Login:     POST http://localhost:${PORT}/auth/login`);
    console.log(`   → Register:  POST http://localhost:${PORT}/auth/register\n`);
    startCleanupScheduler();
  });
}

start().catch((err) => {
  console.error('[Startup] Fatal error:', err.message);
  process.exit(1);
});

module.exports = app;
```

- [ ] **Step 2: Verify it starts (with DATABASE_URL set)**

```bash
cd server
node index.js
```

Expected: `[DB] Migration complete` followed by `🚀 FlowDrop running at http://localhost:3000`

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: wire auth routes, cookie-parser, passport, and DB migration into server"
```

---

## Task 14: Update .env.example

**Files:**
- Modify: `server/.env.example`

- [ ] **Step 1: Replace .env.example**

Overwrite `server/.env.example`:

```
# Cloudflare R2 Credentials
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxx.r2.dev

# PostgreSQL (Railway provides this automatically)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# JWT secret — generate with: openssl rand -hex 32
JWT_SECRET=your_jwt_secret_here

# Google OAuth — from Google Cloud Console
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# GitHub OAuth — from GitHub Developer Settings
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Public URL of your app (used for OAuth callbacks)
APP_URL=https://yourapp.railway.app

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...

# Server
PORT=3000
CLEANUP_CRON=0 2 * * *

# CORS allowed origins (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,https://yourapp.railway.app
```

- [ ] **Step 2: Commit**

```bash
git add server/.env.example
git commit -m "chore: update .env.example for auth and Postgres"
```

---

## Task 15: Create login.html

**Files:**
- Create: `public/login.html`

- [ ] **Step 1: Create login.html**

Create `public/login.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login — FlowDrop</title>
  <link rel="stylesheet" href="style.css" />
  <style>
    .auth-card { max-width: 420px; margin: 80px auto; background: var(--card-bg, #1a1a2e); border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.08); }
    .auth-card h1 { font-size: 1.8rem; margin-bottom: 8px; }
    .auth-card p { color: var(--text-muted, #888); margin-bottom: 28px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 6px; font-size: 0.875rem; color: #ccc; }
    .form-group input { width: 100%; padding: 12px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 1rem; box-sizing: border-box; }
    .btn-primary { width: 100%; padding: 13px; background: linear-gradient(135deg, #667eea, #764ba2); border: none; border-radius: 8px; color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .divider { text-align: center; color: #555; margin: 20px 0; font-size: 0.85rem; }
    .btn-oauth { width: 100%; padding: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 0.95rem; cursor: pointer; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; }
    .btn-oauth:hover { background: rgba(255,255,255,0.1); }
    .auth-footer { text-align: center; margin-top: 24px; color: #888; font-size: 0.9rem; }
    .auth-footer a { color: #667eea; }
    .error-msg { color: #ff6b6b; font-size: 0.875rem; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="auth-card">
    <h1>Welcome back</h1>
    <p>Log in to your FlowDrop account</p>

    <form id="loginForm">
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="email" placeholder="you@example.com" required />
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" placeholder="••••••••" required />
      </div>
      <p class="error-msg" id="errorMsg"></p>
      <button type="submit" class="btn-primary">Log in</button>
    </form>

    <div class="divider">or continue with</div>

    <a href="/auth/google" class="btn-oauth">
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Continue with Google
    </a>
    <a href="/auth/github" class="btn-oauth">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>
      Continue with GitHub
    </a>

    <div class="auth-footer">Don't have an account? <a href="/signup">Sign up</a></div>
  </div>

  <script>
    // Redirect if already logged in
    fetch('/auth/me').then(r => { if (r.ok) window.location.href = '/dashboard'; });

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorMsg = document.getElementById('errorMsg');
      errorMsg.style.display = 'none';
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value }),
      });
      const data = await res.json();
      if (res.ok) { window.location.href = '/dashboard'; }
      else { errorMsg.textContent = data.error || 'Login failed'; errorMsg.style.display = 'block'; }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/login.html
git commit -m "feat: add login page"
```

---

## Task 16: Create signup.html

**Files:**
- Create: `public/signup.html`

- [ ] **Step 1: Create signup.html**

Create `public/signup.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign Up — FlowDrop</title>
  <link rel="stylesheet" href="style.css" />
  <style>
    .auth-card { max-width: 420px; margin: 80px auto; background: var(--card-bg, #1a1a2e); border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.08); }
    .auth-card h1 { font-size: 1.8rem; margin-bottom: 8px; }
    .auth-card p { color: var(--text-muted, #888); margin-bottom: 28px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 6px; font-size: 0.875rem; color: #ccc; }
    .form-group input { width: 100%; padding: 12px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 1rem; box-sizing: border-box; }
    .btn-primary { width: 100%; padding: 13px; background: linear-gradient(135deg, #667eea, #764ba2); border: none; border-radius: 8px; color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .divider { text-align: center; color: #555; margin: 20px 0; font-size: 0.85rem; }
    .btn-oauth { width: 100%; padding: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 0.95rem; cursor: pointer; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; }
    .btn-oauth:hover { background: rgba(255,255,255,0.1); }
    .auth-footer { text-align: center; margin-top: 24px; color: #888; font-size: 0.9rem; }
    .auth-footer a { color: #667eea; }
    .error-msg { color: #ff6b6b; font-size: 0.875rem; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="auth-card">
    <h1>Create your account</h1>
    <p>Start hosting files with FlowDrop</p>

    <form id="signupForm">
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="email" placeholder="you@example.com" required />
      </div>
      <div class="form-group">
        <label>Password <span style="color:#666;font-size:0.8rem">(min 8 characters)</span></label>
        <input type="password" id="password" placeholder="••••••••" required minlength="8" />
      </div>
      <p class="error-msg" id="errorMsg"></p>
      <button type="submit" class="btn-primary">Create account</button>
    </form>

    <div class="divider">or continue with</div>

    <a href="/auth/google" class="btn-oauth">
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Continue with Google
    </a>
    <a href="/auth/github" class="btn-oauth">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>
      Continue with GitHub
    </a>

    <div class="auth-footer">Already have an account? <a href="/login">Log in</a></div>
  </div>

  <script>
    fetch('/auth/me').then(r => { if (r.ok) window.location.href = '/dashboard'; });

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorMsg = document.getElementById('errorMsg');
      errorMsg.style.display = 'none';
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value }),
      });
      const data = await res.json();
      if (res.ok) { window.location.href = '/dashboard'; }
      else { errorMsg.textContent = data.error || 'Signup failed'; errorMsg.style.display = 'block'; }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/signup.html
git commit -m "feat: add signup page"
```

---

## Task 17: Create dashboard.html and dashboard.js

**Files:**
- Create: `public/dashboard.html`
- Create: `public/dashboard.js`

- [ ] **Step 1: Create dashboard.html**

Create `public/dashboard.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard — FlowDrop</title>
  <link rel="stylesheet" href="style.css" />
  <style>
    .dash-nav { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .dash-nav .logo { font-size: 1.4rem; font-weight: 700; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .dash-nav .user-info { display: flex; align-items: center; gap: 12px; }
    .tier-badge { padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .tier-badge.free { background: rgba(255,255,255,0.1); color: #aaa; }
    .tier-badge.starter { background: rgba(102,126,234,0.2); color: #667eea; }
    .tier-badge.pro { background: rgba(118,75,162,0.3); color: #a78bfa; }
    .btn-logout { padding: 8px 16px; background: transparent; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #aaa; cursor: pointer; font-size: 0.875rem; }
    .dash-tabs { display: flex; gap: 4px; padding: 24px 32px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .tab-btn { padding: 10px 20px; background: transparent; border: none; color: #888; cursor: pointer; font-size: 0.95rem; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab-btn.active { color: #fff; border-bottom-color: #667eea; }
    .dash-content { padding: 32px; max-width: 900px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    /* Upload zone reuse */
    .file-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.06); }
    .file-row .file-name { flex: 1; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-row .file-meta { color: #666; font-size: 0.8rem; }
    .btn-copy { padding: 5px 12px; background: rgba(102,126,234,0.15); border: 1px solid rgba(102,126,234,0.3); border-radius: 6px; color: #667eea; cursor: pointer; font-size: 0.8rem; }
    .btn-delete { padding: 5px 12px; background: rgba(255,100,100,0.1); border: 1px solid rgba(255,100,100,0.2); border-radius: 6px; color: #ff6b6b; cursor: pointer; font-size: 0.8rem; }
    .account-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .account-card h3 { margin-bottom: 16px; font-size: 1rem; color: #ccc; }
    .api-key-row { display: flex; align-items: center; gap: 10px; }
    .api-key-display { flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .section-title { font-size: 1.3rem; font-weight: 600; margin-bottom: 20px; }
    .empty-state { text-align: center; padding: 60px 0; color: #555; }
  </style>
</head>
<body>
  <nav class="dash-nav">
    <div class="logo">FlowDrop</div>
    <div class="user-info">
      <span id="userEmail" style="color:#888;font-size:0.9rem"></span>
      <span id="tierBadge" class="tier-badge"></span>
      <button class="btn-logout" id="logoutBtn">Log out</button>
    </div>
  </nav>

  <div class="dash-tabs">
    <button class="tab-btn active" data-tab="upload">Upload</button>
    <button class="tab-btn" data-tab="files">My Files</button>
    <button class="tab-btn" data-tab="account">Account</button>
    <button class="tab-btn" data-tab="billing">Billing</button>
  </div>

  <div class="dash-content">
    <!-- Upload Tab -->
    <div class="tab-panel active" id="tab-upload">
      <div class="section-title">Upload Files</div>
      <div id="dropZone" style="border:2px dashed rgba(255,255,255,0.15);border-radius:12px;padding:60px;text-align:center;cursor:pointer;margin-bottom:24px;">
        <p style="color:#888">Drag & drop files here, or <label for="fileInput" style="color:#667eea;cursor:pointer">browse</label></p>
        <input type="file" id="fileInput" multiple style="display:none" />
      </div>
      <div id="uploadResults"></div>
    </div>

    <!-- Files Tab -->
    <div class="tab-panel" id="tab-files">
      <div class="section-title">My Files</div>
      <div id="filesList"><div class="empty-state">Loading...</div></div>
    </div>

    <!-- Account Tab -->
    <div class="tab-panel" id="tab-account">
      <div class="section-title">Account</div>
      <div class="account-card">
        <h3>API Key</h3>
        <div class="api-key-row">
          <span class="api-key-display" id="apiKeyDisplay"></span>
          <button class="btn-copy" id="copyKeyBtn">Copy</button>
          <button class="btn-delete" id="regenKeyBtn">Regenerate</button>
        </div>
        <p style="color:#666;font-size:0.8rem;margin-top:12px">Use this key as the <code>x-api-key</code> header when uploading via API.</p>
      </div>
      <div class="account-card">
        <h3>Account Details</h3>
        <p style="color:#888;font-size:0.9rem">Email: <span id="accountEmail" style="color:#fff"></span></p>
        <p style="color:#888;font-size:0.9rem;margin-top:8px">Member since: <span id="memberSince" style="color:#fff"></span></p>
      </div>
    </div>

    <!-- Billing Tab -->
    <div class="tab-panel" id="tab-billing">
      <div class="section-title">Billing</div>
      <div class="account-card">
        <h3>Current Plan</h3>
        <p>You are on the <strong id="billingTier"></strong> plan.</p>
        <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
          <button class="btn-primary" id="upgradeStarterBtn" style="padding:10px 20px;border:none;border-radius:8px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;cursor:pointer;font-size:0.9rem;">Upgrade to Starter — $9/mo</button>
          <button class="btn-primary" id="upgradeProBtn" style="padding:10px 20px;border:none;border-radius:8px;background:linear-gradient(135deg,#764ba2,#f093fb);color:#fff;cursor:pointer;font-size:0.9rem;">Upgrade to Pro — $29/mo</button>
          <button id="portalBtn" style="padding:10px 20px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:transparent;color:#aaa;cursor:pointer;font-size:0.9rem;">Manage Billing</button>
        </div>
      </div>
    </div>
  </div>

  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create dashboard.js**

Create `public/dashboard.js`:

```javascript
let currentUser = null;

// ─── Auth Guard ───────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/auth/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  const { user } = await res.json();
  currentUser = user;
  renderUser(user);
  loadFiles();
}

function renderUser(user) {
  document.getElementById('userEmail').textContent = user.email;
  const badge = document.getElementById('tierBadge');
  badge.textContent = user.tier;
  badge.className = `tier-badge ${user.tier}`;
  document.getElementById('apiKeyDisplay').textContent = user.api_key;
  document.getElementById('accountEmail').textContent = user.email;
  document.getElementById('memberSince').textContent = new Date(user.created_at).toLocaleDateString();
  document.getElementById('billingTier').textContent = user.tier.charAt(0).toUpperCase() + user.tier.slice(1);
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'files') loadFiles();
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// ─── Upload ───────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#667eea'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; });
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; uploadFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

async function uploadFiles(files) {
  const form = new FormData();
  for (const f of files) form.append('file', f);
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-api-key': currentUser.api_key }, body: form });
  const data = await res.json();
  const results = document.getElementById('uploadResults');
  if (res.ok) {
    results.innerHTML = data.files.map(f => `
      <div class="file-row">
        <span class="file-name">${f.filename}</span>
        <span class="file-meta">${(f.size / 1024).toFixed(1)} KB</span>
        <button class="btn-copy" onclick="navigator.clipboard.writeText('${f.url}')">Copy URL</button>
      </div>`).join('');
  } else {
    results.innerHTML = `<p style="color:#ff6b6b">${data.error}: ${data.message}</p>`;
  }
}

// ─── Files List ───────────────────────────────────────────────────────────────
async function loadFiles() {
  const res = await fetch('/api/files', { headers: { 'x-api-key': currentUser.api_key } });
  const data = await res.json();
  const container = document.getElementById('filesList');
  if (!res.ok || data.files.length === 0) {
    container.innerHTML = '<div class="empty-state">No files uploaded yet.</div>';
    return;
  }
  container.innerHTML = data.files.map(f => `
    <div class="file-row" id="row-${f.key}">
      <span class="file-name">${f.filename}</span>
      <span class="file-meta">${(f.size / 1024).toFixed(1)} KB · ${f.tier}</span>
      ${f.expires_at ? `<span class="file-meta">Expires ${new Date(f.expires_at).toLocaleDateString()}</span>` : '<span class="file-meta">Never expires</span>'}
      <button class="btn-copy" onclick="navigator.clipboard.writeText('${f.url}')">Copy URL</button>
      <button class="btn-delete" onclick="deleteFile('${f.key}')">Delete</button>
    </div>`).join('');
}

async function deleteFile(key) {
  if (!confirm('Delete this file?')) return;
  const res = await fetch(`/api/files/${key}`, { method: 'DELETE', headers: { 'x-api-key': currentUser.api_key } });
  if (res.ok) document.getElementById(`row-${key}`)?.remove();
}

// ─── Account ──────────────────────────────────────────────────────────────────
document.getElementById('copyKeyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(currentUser.api_key);
  document.getElementById('copyKeyBtn').textContent = 'Copied!';
  setTimeout(() => { document.getElementById('copyKeyBtn').textContent = 'Copy'; }, 2000);
});

document.getElementById('regenKeyBtn').addEventListener('click', async () => {
  if (!confirm('Regenerate your API key? The old key will stop working immediately.')) return;
  const res = await fetch('/auth/regenerate-key', { method: 'POST' });
  const data = await res.json();
  if (res.ok) {
    currentUser.api_key = data.api_key;
    document.getElementById('apiKeyDisplay').textContent = data.api_key;
  }
});

// ─── Billing ──────────────────────────────────────────────────────────────────
document.getElementById('upgradeStarterBtn').addEventListener('click', () => checkout('starter'));
document.getElementById('upgradeProBtn').addEventListener('click', () => checkout('pro'));
document.getElementById('portalBtn').addEventListener('click', () => { window.location.href = '/api/payments/portal'; });

async function checkout(plan) {
  const res = await fetch('/api/payments/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  const data = await res.json();
  if (res.ok) window.location.href = data.url;
}

init();
```

- [ ] **Step 3: Commit**

```bash
git add public/dashboard.html public/dashboard.js
git commit -m "feat: add user dashboard with upload, files, account, and billing tabs"
```

---

## Task 18: Update index.html

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add auth redirect and update CTA buttons**

Add this script at the top of `<body>` in `public/index.html`:

```html
<script>
  fetch('/auth/me').then(r => { if (r.ok) window.location.href = '/dashboard'; });
</script>
```

Find all "Get Started" / pricing CTA `<a>` or `<button>` elements that link to `#pricing` or open a checkout modal, and update their `href` to `/signup` or add `onclick="window.location.href='/signup'"`.

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: redirect logged-in users to dashboard from landing page"
```

---

## Task 19: Update DEPLOYMENT.md with Railway Postgres step

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Add Postgres provisioning section**

Add a new step after Step 2 (Create Railway Project) in `DEPLOYMENT.md`:

```markdown
## Step 3 — Add Railway PostgreSQL

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway provisions the database and automatically adds `DATABASE_URL` to your project's environment
3. No further configuration needed — the server runs `migrate()` on startup and creates the tables

---
```

Renumber the remaining steps from Step 3 → Step 4, etc.

- [ ] **Step 2: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs: add Railway PostgreSQL provisioning step to deployment guide"
```

---

## Task 19: Update cleanup.js for async DB calls

**Files:**
- Modify: `server/lib/cleanup.js`

- [ ] **Step 1: Add await to the two DB calls in cleanupExpiredFiles**

In `server/lib/cleanup.js`, update `cleanupExpiredFiles`:

```javascript
async function cleanupExpiredFiles() {
  const expired = await stmts.findExpired();   // add await

  if (expired.length === 0) {
    console.log('[Cleanup] No expired files found.');
    return { deleted: 0, errors: 0, details: [] };
  }

  console.log(`[Cleanup] Found ${expired.length} expired file(s). Starting purge...`);

  let deleted = 0;
  let errors = 0;
  const details = [];

  for (const file of expired) {
    try {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: file.key,
        })
      );

      await stmts.deleteByKey(file.key);   // add await

      deleted++;
      details.push({ key: file.key, status: 'deleted', tier: file.tier, expiredAt: file.expires_at });
      console.log(`[Cleanup] ✅ Deleted: ${file.key} (tier: ${file.tier}, expired: ${file.expires_at})`);
    } catch (err) {
      errors++;
      details.push({ key: file.key, status: 'error', error: err.message });
      console.error(`[Cleanup] ❌ Failed to delete ${file.key}:`, err.message);
    }
  }

  console.log(`[Cleanup] Done. Deleted: ${deleted}, Errors: ${errors}`);
  return { deleted, errors, details };
}
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
node -e "require('./lib/cleanup'); console.log('Cleanup loaded')"
```

Expected: `Cleanup loaded`

- [ ] **Step 3: Commit**

```bash
git add server/lib/cleanup.js
git commit -m "fix: await async DB calls in cleanup.js"
```

---

## Verification

- [ ] `cd server && node -e "require('./lib/db-pg')"` — no error
- [ ] Start server with `DATABASE_URL` set: `[DB] Migration complete` in logs
- [ ] `curl -X POST /auth/register -d '{"email":"test@test.com","password":"password123"}' -H "Content-Type: application/json"` → `201` with `api_key` in response
- [ ] `curl -X POST /auth/login` with same credentials → `200` with session cookie
- [ ] `curl /auth/me` with cookie → returns user object
- [ ] `curl -X POST /api/upload -H "x-api-key: <key>" -F "file=@test.jpg"` → `200` with URL
- [ ] `curl /api/files -H "x-api-key: <key>"` → returns only that user's uploads
- [ ] `curl -X POST /auth/regenerate-key` → new key returned, old key returns `403`
- [ ] Visit `/login`, `/signup`, `/dashboard` in browser — all render correctly
- [ ] `/dashboard` redirects to `/login` when not authenticated
- [ ] `/` redirects to `/dashboard` when authenticated
