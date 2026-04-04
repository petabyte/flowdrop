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

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
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
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
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
}

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

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google OAuth is not configured.' });
  }
  passport.authenticate('google', { scope: ['email', 'profile'], session: false })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect('/login?error=oauth');
  }
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=oauth' })(req, res, next);
}, (req, res) => { setSessionCookie(res, req.user); res.redirect('/dashboard'); });

router.get('/github', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(503).json({ error: 'GitHub OAuth is not configured.' });
  }
  passport.authenticate('github', { scope: ['user:email'], session: false })(req, res, next);
});

router.get('/github/callback', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.redirect('/login?error=oauth');
  }
  passport.authenticate('github', { session: false, failureRedirect: '/login?error=oauth' })(req, res, next);
}, (req, res) => { setSessionCookie(res, req.user); res.redirect('/dashboard'); });

module.exports = { router, passport };
