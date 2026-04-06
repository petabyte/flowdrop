# Free Tier Expiry & Email Upsell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expire free tier API keys after 7 days, and send a Day 5 reminder email via Resend encouraging upgrade.

**Architecture:** Two new columns on `users` (`api_key_expires_at`, `trial_reminder_sent_at`), expiry check in `requireApiKey` middleware, Resend email wrapper in a new `email.js` module, and a `sendTrialReminders()` function called alongside the existing daily cleanup cron.

**Tech Stack:** PostgreSQL (`pg`), Node 18 native `fetch` (no extra HTTP library needed), Resend REST API.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `server/lib/migrate.js` | Add 2 new columns + backfill + index |
| Modify | `server/lib/users.js` | Set/clear `api_key_expires_at`; add `findUsersNearExpiry`, `updateTrialReminderSent` |
| Modify | `server/middleware/auth.js` | Check `api_key_expires_at` before allowing request |
| Create | `server/lib/email.js` | Resend API wrapper + HTML email template |
| Modify | `server/lib/cleanup.js` | Add `sendTrialReminders()` |
| Modify | `server/lib/scheduler.js` | Call `sendTrialReminders()` in daily cron |
| Modify | `server/.env.example` | Document `RESEND_API_KEY` and `FROM_EMAIL` |

---

## Task 1: Database migration

**Files:**
- Modify: `server/lib/migrate.js`

- [ ] **Step 1: Add new columns and backfill**

Open `server/lib/migrate.js`. After the last `CREATE INDEX` line (line 38) and before `console.log('[DB] Migration complete')`, add:

```javascript
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
```

- [ ] **Step 2: Verify migration runs cleanly**

Deploy or restart the server locally. Check logs for:
```
[DB] Migration complete
```

No errors. If running locally with a real DB, connect and run:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users'
AND column_name IN ('api_key_expires_at', 'trial_reminder_sent_at');
```
Expected: 2 rows returned.

Verify backfill:
```sql
SELECT email, created_at, api_key_expires_at FROM users WHERE tier = 'free' LIMIT 5;
```
Expected: `api_key_expires_at = created_at + 7 days` for each row.

- [ ] **Step 3: Commit**

```bash
git add server/lib/migrate.js
git commit -m "feat: add api_key_expires_at and trial_reminder_sent_at columns"
```

---

## Task 2: Update users.js

**Files:**
- Modify: `server/lib/users.js`

- [ ] **Step 1: Update `create()` to set expiry for new free users**

Replace the existing `create()` method (lines 42–50):

```javascript
  async create({ email, passwordHash = null, googleId = null, githubId = null }) {
    const apiKey = generateApiKey();
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, google_id, github_id, api_key, api_key_expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + INTERVAL '7 days') RETURNING *`,
      [email, passwordHash, googleId, githubId, apiKey]
    );
    return rows[0];
  },
```

All new accounts default to free tier, so they always get a 7-day expiry.

- [ ] **Step 2: Update `updateTier()` to clear expiry when upgrading, set when downgrading**

Replace the existing `updateTier()` method (lines 52–57):

```javascript
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
```

- Upgrading to starter/pro → `api_key_expires_at = NULL` (never expires)
- Downgrading back to free (e.g. cancelled subscription) → new 7-day window from now

- [ ] **Step 3: Add `findUsersNearExpiry()` method**

Add after `updateStripeCustomerId` and before the closing `};`:

```javascript
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
```

- [ ] **Step 4: Verify logic**

Check `create()` returns a user with `api_key_expires_at` set ~7 days from now by registering a test account and running:
```sql
SELECT email, api_key_expires_at FROM users ORDER BY created_at DESC LIMIT 1;
```
Expected: `api_key_expires_at` is approximately `now() + 7 days`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/users.js
git commit -m "feat: set api_key_expires_at on create/updateTier, add expiry query methods"
```

---

## Task 3: API key expiry check in middleware

**Files:**
- Modify: `server/middleware/auth.js`

- [ ] **Step 1: Add expiry check to `requireApiKey`**

Replace the full `requireApiKey` function (lines 4–27):

```javascript
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

    if (user.api_key_expires_at && new Date(user.api_key_expires_at) <= new Date()) {
      return res.status(401).json({
        error: 'API key expired',
        message: 'Your free trial has ended. Upgrade to keep uploading.',
        upgrade_url: `${process.env.APP_URL || 'https://flow-drop.app'}/dashboard`,
      });
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
```

- [ ] **Step 2: Verify expired key returns 401**

To test, temporarily set a past expiry on a free user in the DB:
```sql
UPDATE users SET api_key_expires_at = now() - INTERVAL '1 hour'
WHERE email = 'test@example.com';
```

Then make an API call:
```bash
curl -H "x-api-key: fd_yourkey" https://flow-drop.app/api/files
```

Expected:
```json
{
  "error": "API key expired",
  "message": "Your free trial has ended. Upgrade to keep uploading.",
  "upgrade_url": "https://flow-drop.app/dashboard"
}
```

Reset the expiry after testing:
```sql
UPDATE users SET api_key_expires_at = created_at + INTERVAL '7 days'
WHERE email = 'test@example.com';
```

- [ ] **Step 3: Commit**

```bash
git add server/middleware/auth.js
git commit -m "feat: block expired free tier API keys with 401 response"
```

---

## Task 4: Create email.js

**Files:**
- Create: `server/lib/email.js`

- [ ] **Step 1: Create `server/lib/email.js`**

```javascript
const FROM_EMAIL = process.env.FROM_EMAIL || 'FlowDrop <noreply@flowdrop.app>';
const APP_URL = process.env.APP_URL || 'https://flow-drop.app';

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function buildTrialReminderHtml(expiresAt) {
  const expiryDate = formatDate(expiresAt);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Inter',Arial,sans-serif;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;">⚡ FlowDrop</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#fff;">
                Your free trial expires in 2 days
              </h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a0a0a0;">
                Your FlowDrop API key expires on <strong style="color:#fff;">${expiryDate}</strong>.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a0a0a0;">
                After that, your API key will stop working and uploaded files will be deleted.
                Upgrade now to keep your workflows running without interruption.
              </p>

              <!-- Pricing -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:16px;background:#242424;border-radius:8px;border:1px solid #333;vertical-align:top;">
                    <div style="font-weight:600;color:#fff;margin-bottom:4px;">Starter — $9/mo</div>
                    <div style="font-size:13px;color:#888;">30-day retention · 50MB uploads · 1,000/mo</div>
                  </td>
                  <td width="12"></td>
                  <td style="padding:16px;background:#1e1730;border-radius:8px;border:1px solid #5a3ea0;vertical-align:top;">
                    <div style="font-weight:600;color:#fff;margin-bottom:4px;">Pro — $29/mo ✦</div>
                    <div style="font-size:13px;color:#888;">Files never expire · 200MB uploads · 6,000/mo</div>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <a href="${APP_URL}/dashboard"
                 style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
                Upgrade Now →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #2a2a2a;">
              <p style="margin:0;font-size:12px;color:#555;line-height:1.5;">
                You're receiving this because you have a free FlowDrop account.
                If you no longer need it, you can ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendTrialReminderEmail(email, expiresAt) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email to', email);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Your FlowDrop trial expires in 2 days',
      html: buildTrialReminderHtml(expiresAt),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

module.exports = { sendTrialReminderEmail };
```

- [ ] **Step 2: Add `RESEND_API_KEY` to `.env.example`**

Add to `server/.env.example` at the end:

```
# Resend — email notifications (get key at resend.com)
RESEND_API_KEY=re_...
# Optional: verified sender address (default: noreply@flowdrop.app)
FROM_EMAIL=FlowDrop <noreply@yourdomain.com>
```

- [ ] **Step 3: Verify email sends**

Set `RESEND_API_KEY` in your local `.env`, then test from a Node REPL:

```bash
cd server
node -e "
require('dotenv').config();
const { sendTrialReminderEmail } = require('./lib/email');
sendTrialReminderEmail('your@email.com', new Date(Date.now() + 2*24*60*60*1000).toISOString())
  .then(() => console.log('Email sent'))
  .catch(e => console.error('Failed:', e.message));
"
```

Expected: `Email sent` in console, email arrives in inbox.

**Note:** Resend requires your sender domain to be verified. Until then, use `onboarding@resend.dev` as `FROM_EMAIL` (Resend's shared test domain — only delivers to your own verified email address). Verify your domain at [resend.com/domains](https://resend.com/domains) for production use.

- [ ] **Step 4: Commit**

```bash
git add server/lib/email.js server/.env.example
git commit -m "feat: add Resend email helper with trial reminder template"
```

---

## Task 5: Add sendTrialReminders() to cleanup.js

**Files:**
- Modify: `server/lib/cleanup.js`

- [ ] **Step 1: Import users and email modules**

At the top of `server/lib/cleanup.js`, add two imports after the existing requires (after line 4):

```javascript
const { users } = require('./users');
const { sendTrialReminderEmail } = require('./email');
```

- [ ] **Step 2: Add `sendTrialReminders()` function**

Add after the `getRetentionSummary` function, before `module.exports`:

```javascript
/**
 * sendTrialReminders
 *
 * Finds free users whose API key expires within 3 days and who haven't
 * received a reminder yet. Sends a Resend email to each, then marks
 * trial_reminder_sent_at to prevent duplicates.
 *
 * @returns {{ sent: number, errors: number }}
 */
async function sendTrialReminders() {
  const nearExpiry = await users.findUsersNearExpiry();

  if (nearExpiry.length === 0) {
    console.log('[Reminders] No trial reminders to send.');
    return { sent: 0, errors: 0 };
  }

  console.log(`[Reminders] Sending trial reminders to ${nearExpiry.length} user(s)...`);

  let sent = 0;
  let errors = 0;

  for (const user of nearExpiry) {
    try {
      await sendTrialReminderEmail(user.email, user.api_key_expires_at);
      await users.updateTrialReminderSent(user.id);
      sent++;
      console.log(`[Reminders] ✅ Sent reminder to ${user.email}`);
    } catch (err) {
      errors++;
      console.error(`[Reminders] ❌ Failed for ${user.email}:`, err.message);
    }
  }

  console.log(`[Reminders] Done. Sent: ${sent}, Errors: ${errors}`);
  return { sent, errors };
}
```

- [ ] **Step 3: Export the new function**

Replace the existing `module.exports` line at the bottom:

```javascript
module.exports = { cleanupExpiredFiles, getRetentionSummary, sendTrialReminders };
```

- [ ] **Step 4: Verify the function can be imported without errors**

```bash
cd server
node -e "const { sendTrialReminders } = require('./lib/cleanup'); console.log('OK');"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add server/lib/cleanup.js
git commit -m "feat: add sendTrialReminders to cleanup module"
```

---

## Task 6: Wire reminders into scheduler + update env example

**Files:**
- Modify: `server/lib/scheduler.js`

- [ ] **Step 1: Import and call `sendTrialReminders`**

Replace the full contents of `server/lib/scheduler.js`:

```javascript
const cron = require('node-cron');
const { cleanupExpiredFiles, sendTrialReminders } = require('./cleanup');

// Schedules the file cleanup and trial reminder cron job.
// Default schedule: every day at 2:00 AM server time.
// Override via CLEANUP_CRON env var using a standard cron expression.
// Example values:
//   "0 2 * * *"    = 2:00 AM daily (default)
//   "0 * * * *"    = top of every hour
//   "*/30 * * * *" = every 30 minutes (useful for testing)
function startCleanupScheduler() {
  const schedule = process.env.CLEANUP_CRON || '0 2 * * *';

  if (!cron.validate(schedule)) {
    console.error(`[Scheduler] Invalid cron expression: "${schedule}". Cleanup job NOT started.`);
    return;
  }

  console.log(`[Scheduler] File cleanup job scheduled: "${schedule}"`);

  cron.schedule(schedule, async () => {
    console.log(`\n[Scheduler] ⏰ Running scheduled jobs at ${new Date().toISOString()}`);
    try {
      const cleanupResult = await cleanupExpiredFiles();
      console.log('[Scheduler] Cleanup complete:', cleanupResult);
    } catch (err) {
      console.error('[Scheduler] Cleanup job failed:', err.message);
    }
    try {
      const reminderResult = await sendTrialReminders();
      console.log('[Scheduler] Reminders complete:', reminderResult);
    } catch (err) {
      console.error('[Scheduler] Reminder job failed:', err.message);
    }
  });
}

module.exports = { startCleanupScheduler };
```

- [ ] **Step 2: Add `RESEND_API_KEY` to Railway**

In Railway → your app service → **Variables**, add:
```
RESEND_API_KEY=re_your_key_here
```

Get the key from [resend.com](https://resend.com) → API Keys → Create API Key.

- [ ] **Step 3: Verify scheduler starts without errors**

Restart the server. Check logs for:
```
[Scheduler] File cleanup job scheduled: "0 2 * * *"
```

No import errors.

- [ ] **Step 4: End-to-end smoke test**

To trigger the job immediately without waiting for 2 AM, temporarily set:
```
CLEANUP_CRON=* * * * *
```
(runs every minute). Check logs for:
```
[Scheduler] ⏰ Running scheduled jobs at ...
[Cleanup] No expired files found.
[Reminders] No trial reminders to send.
```

Reset `CLEANUP_CRON` to `0 2 * * *` after testing.

- [ ] **Step 5: Commit and push**

```bash
git add server/lib/scheduler.js
git commit -m "feat: run trial reminders alongside file cleanup in daily cron"
git push
```

---

## Verification Summary

- [ ] `users` table has `api_key_expires_at` and `trial_reminder_sent_at` columns
- [ ] Existing free users have `api_key_expires_at = created_at + 7 days` backfilled
- [ ] New registrations get `api_key_expires_at = now() + 7 days`
- [ ] Upgrading to starter/pro clears `api_key_expires_at` to NULL
- [ ] Expired API key returns HTTP 401 with `"error": "API key expired"` and `upgrade_url`
- [ ] Valid (non-expired) API key continues to work normally
- [ ] `RESEND_API_KEY` not set → email skipped with a warning log, no crash
- [ ] Trial reminder email delivers with correct expiry date and upgrade button
- [ ] `trial_reminder_sent_at` is set after sending — same user doesn't receive duplicate emails
- [ ] Scheduler logs both cleanup and reminder results at each run
