# Free Tier Expiry, File Deletion & Email Upsell — Design Spec

**Date:** 2026-04-06
**Status:** Approved

---

## Overview

Free tier users get a 7-day trial. After 7 days:
- Their API key returns `401 Expired`
- Their uploaded files are already deleted (existing cleanup job handles this)
- A reminder email is sent on Day 5 via Resend encouraging upgrade

---

## Section 1 — Data Model

Two new columns added to the `users` table via migration:

### `api_key_expires_at TIMESTAMPTZ`
- Set to `created_at + 7 days` for all new free tier users at registration
- Set to `NULL` when user upgrades to starter or pro (key never expires)
- `NULL` means the key never expires (all paid users)
- Existing free users are backfilled: `api_key_expires_at = created_at + INTERVAL '7 days'`
- Existing paid users: left as `NULL`

### `trial_reminder_sent_at TIMESTAMPTZ`
- `NULL` by default for all users
- Set to `now()` when the Day 5 reminder email is successfully sent
- Prevents duplicate emails if the scheduler runs multiple times

**Migration:** `ALTER TABLE users ADD COLUMN IF NOT EXISTS` for both columns. Safe to run on existing data.

**New index:** `idx_users_trial_expiry` on `(tier, api_key_expires_at)` for efficient scheduler queries.

---

## Section 2 — API Key Expiry

### `server/middleware/auth.js` — `requireApiKey`

After resolving the user by API key, add expiry check:

```
if user.api_key_expires_at is set AND user.api_key_expires_at <= now():
  return HTTP 401 {
    error: "API key expired",
    message: "Your free trial has ended. Upgrade to keep uploading.",
    upgrade_url: "https://flowdrop-production-6e1e.up.railway.app/dashboard"
  }
```

If `api_key_expires_at` is null (paid user) or in the future, continue normally.

### `server/lib/users.js` updates

- **`create()`** — when `tier` is `'free'` (default), set `api_key_expires_at = now() + INTERVAL '7 days'`. For non-free tiers, set `NULL`.
- **`updateTier(id, tier)`** — when upgrading to `'starter'` or `'pro'`, clear `api_key_expires_at` to `NULL`.

---

## Section 3 — Email Reminders

### `server/lib/email.js` (new file)

Thin wrapper around Resend REST API using Node 18 native `fetch`. No SDK required.

```
sendTrialReminderEmail(email, expiresAt) → Promise<void>
```

- POSTs to `https://api.resend.com/emails`
- Auth: `Authorization: Bearer $RESEND_API_KEY`
- From: `FlowDrop <noreply@yourdomain.com>`
- Subject: `Your FlowDrop trial expires in 2 days`
- Body: HTML email (see template below)
- Throws on non-2xx response

### Email Template

**Subject:** Your FlowDrop trial expires in 2 days

**Body:**
```
Hi,

Your FlowDrop free trial API key expires on [DATE].

When it expires, your API key will stop working and any uploaded files will be deleted.

Upgrade to keep your workflow running:

• Starter — $9/mo: 30-day file retention, 50MB uploads, 1,000 uploads/month
• Pro — $29/mo: Files never expire, 200MB uploads, 6,000 uploads/month

[Upgrade Now →] → https://flowdrop-production-6e1e.up.railway.app/dashboard

---
You're receiving this because you have a free FlowDrop account.
If you no longer need it, you can ignore this email.
```

### `server/lib/cleanup.js` — `sendTrialReminders()` (new function)

Query:
```sql
SELECT id, email, api_key_expires_at
FROM users
WHERE tier = 'free'
  AND api_key_expires_at BETWEEN now() AND now() + INTERVAL '3 days'
  AND trial_reminder_sent_at IS NULL
```

For each user:
1. Call `sendTrialReminderEmail(user.email, user.api_key_expires_at)`
2. On success: `UPDATE users SET trial_reminder_sent_at = now() WHERE id = user.id`
3. On error: log and continue (don't crash the scheduler)

Returns `{ sent: number, errors: number }`

### `server/lib/scheduler.js` update

Add `sendTrialReminders()` call alongside existing `cleanupExpiredFiles()` in the daily cron job. Both run at 2:00 AM daily.

---

## Section 4 — Environment Variables

One new variable required:

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | API key from resend.com — add to Railway Variables |

Add to `server/.env.example`:
```
RESEND_API_KEY=re_...
```

The `FROM_EMAIL` address defaults to `noreply@flowdrop.app`. If the user has a custom domain verified in Resend, this can be overridden via `FROM_EMAIL` env var.

---

## What's Already Working (No Changes Needed)

- File deletion after 7 days — `cleanupExpiredFiles()` already deletes uploads where `expires_at <= now()`, and free tier files already get `expires_at = now() + 7 days` at upload time via `calcExpiresAt('free')`

---

## Files Changed

| Action | File | Change |
|---|---|---|
| Modify | `server/lib/migrate.js` | Add two new columns + index |
| Modify | `server/lib/users.js` | Set/clear `api_key_expires_at` in `create()` and `updateTier()` |
| Modify | `server/middleware/auth.js` | Check expiry in `requireApiKey` |
| Create | `server/lib/email.js` | Resend email helper |
| Modify | `server/lib/cleanup.js` | Add `sendTrialReminders()` |
| Modify | `server/lib/scheduler.js` | Call `sendTrialReminders()` in daily job |
| Modify | `server/.env.example` | Add `RESEND_API_KEY` |
