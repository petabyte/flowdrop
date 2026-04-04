# Auth & User Accounts — Design Spec

**Date:** 2026-04-03
**Status:** Approved

---

## Context

FlowDrop currently has no user account system. Auth is handled by three shared API keys — one per tier (`FREE_API_KEY`, `STARTER_API_KEY`, `PRO_API_KEY`). All uploaded files are publicly accessible. There is no way to attribute uploads to a specific person or manage a subscription tied to an identity.

This spec adds a full user account system so that uploaders can sign up, log in, manage their own files, and have their tier and API key tied to their account. Shared tier keys are removed entirely.

---

## Approach

JWT-based auth with Railway PostgreSQL. Sessions stored in `httpOnly` cookies. OAuth via Passport.js for Google and GitHub. Stripe linked to user rows via `stripe_customer_id`.

**New dependencies:**
- `pg` — PostgreSQL client
- `bcrypt` — password hashing
- `jsonwebtoken` — JWT creation and verification
- `cookie-parser` — read `httpOnly` session cookie
- `passport` — OAuth middleware
- `passport-google-oauth20` — Google OAuth strategy
- `passport-github2` — GitHub OAuth strategy

---

## Section 1 — Database & Data Model

Replace `data/uploads.json` and `data/users.json` with a Railway PostgreSQL database. Use the `pg` client directly — no ORM.

### `users` table

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key, `gen_random_uuid()` |
| `email` | VARCHAR(255) | Unique, not null |
| `password_hash` | VARCHAR | Null for OAuth-only users |
| `google_id` | VARCHAR | Null if not using Google |
| `github_id` | VARCHAR | Null if not using GitHub |
| `tier` | VARCHAR | `free`, `starter`, `pro` — default `free` |
| `api_key` | VARCHAR(64) | Unique, generated on signup via `crypto.randomBytes(32).toString('hex')` |
| `stripe_customer_id` | VARCHAR | Null until first Stripe checkout |
| `created_at` | TIMESTAMPTZ | Default `now()` |

### `uploads` table

Replaces `uploads.json`. Adds `user_id` foreign key.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → `users.id`, not null |
| `key` | VARCHAR | R2 object key, unique |
| `filename` | VARCHAR | Original filename |
| `mimetype` | VARCHAR | |
| `size` | BIGINT | Bytes |
| `url` | TEXT | Full public R2 URL |
| `tier` | VARCHAR | Tier at time of upload |
| `uploaded_at` | TIMESTAMPTZ | Default `now()` |
| `expires_at` | TIMESTAMPTZ | Null for Pro tier |

### Migration

`server/lib/db.js` is replaced by `server/lib/db-pg.js` which exports a `pg.Pool` instance. A `server/lib/migrate.js` script creates both tables on startup if they do not exist.

---

## Section 2 — Auth Layer

### New file: `server/routes/auth.js`

| Method | Path | Auth required | Description |
|---|---|---|---|
| `POST` | `/auth/register` | No | Email + password signup. Creates user, generates API key, returns JWT cookie. |
| `POST` | `/auth/login` | No | Validates email + password. Returns JWT cookie. |
| `POST` | `/auth/logout` | No | Clears JWT cookie. |
| `GET` | `/auth/google` | No | Redirects to Google OAuth consent screen. |
| `GET` | `/auth/google/callback` | No | Handles Google callback. Creates or finds user. Returns JWT cookie. |
| `GET` | `/auth/github` | No | Redirects to GitHub OAuth consent screen. |
| `GET` | `/auth/github/callback` | No | Handles GitHub callback. Creates or finds user. Returns JWT cookie. |
| `GET` | `/auth/me` | Yes | Returns `{ id, email, tier, api_key, created_at }`. Used by frontend auth guard. |
| `POST` | `/auth/regenerate-key` | Yes | Generates a new `api_key` for the user, invalidates the old one. |

### Session strategy

- JWT payload: `{ user_id, tier }`
- Stored in an `httpOnly`, `sameSite: strict` cookie named `session`
- Expires: 7 days
- `requireAuth` middleware: reads cookie, verifies JWT, attaches `req.user` to request

### API key auth

The existing `requireApiKey` middleware in `server/middleware/auth.js` is updated to look up the API key in the `users` table instead of matching against env vars. `req.userTier` is set from the matched user row. The shared `FREE_API_KEY`, `STARTER_API_KEY`, `PRO_API_KEY`, and `API_KEY_SECRET` env vars are removed.

### Password rules

- Minimum 8 characters
- Hashed with `bcrypt` (cost factor 12)
- No complexity requirements beyond length

---

## Section 3 — Frontend Pages

All new pages follow the existing dark theme in `public/style.css`.

### `public/login.html`

- Email + password form → `POST /auth/login`
- "Continue with Google" button → `GET /auth/google`
- "Continue with GitHub" button → `GET /auth/github`
- Link to `/signup`
- On success: redirect to `/dashboard`

### `public/signup.html`

- Email + password form → `POST /auth/register`
- "Continue with Google" button → `GET /auth/google`
- "Continue with GitHub" button → `GET /auth/github`
- Link to `/login`
- On success: redirect to `/dashboard`

### `public/dashboard.html`

Replaces the current `index.html` upload UI for authenticated users. Four sections rendered in a tabbed layout:

| Tab | Content |
|---|---|
| **Upload** | Existing drag-and-drop UI from `app.js`, scoped to the logged-in user's files |
| **My Files** | User's uploads only. Columns: filename, size, tier badge, expiry, copy URL, delete. |
| **Account** | Email, tier badge, API key (masked) with copy + regenerate buttons. |
| **Billing** | Current plan name. Upgrade/downgrade buttons → Stripe checkout. "Manage billing" link → Stripe Customer Portal. |

**Auth guard:** On page load, `dashboard.js` calls `GET /auth/me`. On 401, redirect to `/login`.

### `public/index.html` (landing page)

Unchanged except:
- "Get Started" and pricing CTA buttons redirect to `/signup`
- A small script checks `GET /auth/me` on load — if authenticated, redirect to `/dashboard`

---

## Section 4 — Stripe Integration Updates

### Checkout flow (`server/routes/payments.js`)

- `POST /api/payments/checkout` now requires `requireAuth`
- Reads `req.user.id` from JWT
- If user has no `stripe_customer_id`: create Stripe customer, store ID on user row
- Passes `user_id` as `metadata` on the Stripe checkout session

### Webhooks

**`checkout.session.completed`:**
1. Read `user_id` from `session.metadata`
2. Determine tier from the purchased price ID
3. `UPDATE users SET tier = $1 WHERE id = $2`
4. Store `stripe_customer_id` if not already set

**`customer.subscription.deleted`:**
1. Look up user by `stripe_customer_id`
2. `UPDATE users SET tier = 'free' WHERE stripe_customer_id = $1`

### New endpoint

| Method | Path | Auth required | Description |
|---|---|---|---|
| `GET` | `/api/payments/portal` | Yes | Creates a Stripe Customer Portal session and redirects the user to it |

---

## New Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Railway PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs — `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GITHUB_CLIENT_ID` | From GitHub OAuth App settings |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App settings |
| `APP_URL` | Public URL of the app (e.g. `https://yourapp.railway.app`) — used for OAuth callbacks |

**Removed variables:** `FREE_API_KEY`, `STARTER_API_KEY`, `PRO_API_KEY`, `API_KEY_SECRET`

---

## Files Changed / Created

| File | Change |
|---|---|
| `server/lib/db.js` | Replaced by `server/lib/db-pg.js` (pg Pool) |
| `server/lib/migrate.js` | New — creates tables on startup |
| `server/lib/users.js` | Updated — CRUD against Postgres instead of JSON |
| `server/routes/auth.js` | New — all auth endpoints |
| `server/routes/payments.js` | Updated — user-linked checkout, portal endpoint |
| `server/routes/upload.js` | Updated — DB calls use pg, uploads scoped to user |
| `server/middleware/auth.js` | Updated — API key lookup hits Postgres |
| `server/index.js` | Updated — mount auth routes, add cookie-parser, run migration |
| `public/login.html` | New |
| `public/signup.html` | New |
| `public/dashboard.html` | New — replaces current index.html upload UI |
| `public/dashboard.js` | New — dashboard frontend logic |
| `public/index.html` | Updated — CTA buttons to `/signup`, auth redirect |
| `server/.env.example` | Updated — add new vars, remove shared API key vars |
| `DEPLOYMENT.md` | Updated — add Railway Postgres provisioning step |

---

## Verification

1. `POST /auth/register` with email + password → user row created in Postgres, API key generated, JWT cookie set
2. `POST /auth/login` → JWT cookie returned
3. `GET /auth/me` with cookie → returns user info
4. `GET /auth/google` → OAuth flow completes, user created/found, cookie set
5. `POST /api/upload` with user's API key → upload scoped to their account
6. `GET /api/files` → returns only that user's uploads
7. `POST /api/payments/checkout` → Stripe session has `user_id` in metadata
8. Stripe webhook fires → `users.tier` updated in Postgres
9. `GET /api/payments/portal` → redirects to Stripe Customer Portal
10. `POST /auth/regenerate-key` → new API key issued, old key rejected on next upload attempt
