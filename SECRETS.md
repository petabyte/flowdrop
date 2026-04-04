# Environment Variables — How to Get Every Secret

All variables go into Railway's **Variables** tab (or your local `.env` file for development).

---

## R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL

**Cloudflare R2 storage credentials.**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and log in
2. Click **R2** in the left sidebar → **Create bucket**
3. Name your bucket (e.g. `flowdrop`) → **Create bucket**
4. On the bucket page, click **Settings** → enable **Public Access** → note the `pub-xxxx.r2.dev` URL → `R2_PUBLIC_URL`
5. Back on the R2 overview page, note your **Account ID** in the URL or right sidebar → `R2_ACCOUNT_ID`
6. Click **Manage R2 API tokens** → **Create API token**
   - Permissions: **Object Read & Write**
   - Scope: your bucket
   - Click **Create API token**
7. Copy:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - Your bucket name → `R2_BUCKET_NAME`

---

## DATABASE_URL

**Automatically injected by Railway** when you add a PostgreSQL database to your project.

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway provisions the database and sets `DATABASE_URL` in your environment automatically
3. No further action needed — the server runs migrations on startup

For local development, install PostgreSQL and set:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/flowdrop
```

---

## JWT_SECRET

**Random secret used to sign session cookies.**

Generate one with either of these commands:

```bash
# Option A — OpenSSL
openssl rand -hex 32

# Option B — Node.js (Windows-friendly)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output (a 64-character hex string) as `JWT_SECRET`. Use a different value per environment.

---

## GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

**Google OAuth credentials** (optional — skip if you don't want Google login).

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. **APIs & Services** → **OAuth consent screen**
   - User type: **External**
   - Fill in app name and support email → Save
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Application type: **Web application**
6. Under **Authorized redirect URIs**, add:
   ```
   https://yourapp.railway.app/auth/google/callback
   http://localhost:3000/auth/google/callback
   ```
7. Click **Create** — copy:
   - **Client ID** → `GOOGLE_CLIENT_ID`
   - **Client secret** → `GOOGLE_CLIENT_SECRET`

> If these are not set, Google login is disabled but the rest of the app works normally.

---

## GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET

**GitHub OAuth credentials** (optional — skip if you don't want GitHub login).

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name:** FlowDrop
   - **Homepage URL:** `https://yourapp.railway.app`
   - **Authorization callback URL:** `https://yourapp.railway.app/auth/github/callback`
4. Click **Register application**
5. Copy **Client ID** → `GITHUB_CLIENT_ID`
6. Click **Generate a new client secret** → copy it → `GITHUB_CLIENT_SECRET`

> If these are not set, GitHub login is disabled but the rest of the app works normally.

---

## APP_URL

The public root URL of your deployed app. Used to construct OAuth callback URLs.

```
APP_URL=https://yourapp.railway.app
```

Replace `yourapp` with your actual Railway subdomain. If you have a custom domain, use that instead.

---

## STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID

**Stripe billing credentials.**

### Secret Key

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) and sign up / log in
2. **Developers** → **API keys**
3. Copy **Secret key** (`sk_test_...` in test mode) → `STRIPE_SECRET_KEY`

> Use test mode (`sk_test_...`) during development. Switch to live (`sk_live_...`) for production.

### Webhook Secret

1. **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL: `https://yourapp.railway.app/api/payments/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Click **Add endpoint** → copy **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

### Price IDs

1. **Product catalog** → **Add product**
2. Create the **Starter** plan:
   - Name: Starter
   - Price: $9.00 / month (recurring)
   - Click **Save product** → copy the **Price ID** (`price_...`) → `STRIPE_STARTER_PRICE_ID`
3. Create the **Pro** plan:
   - Name: Pro
   - Price: $29.00 / month (recurring)
   - Click **Save product** → copy the **Price ID** (`price_...`) → `STRIPE_PRO_PRICE_ID`

---

## PORT

Set to `3000`. Railway injects this automatically — you don't need to set it manually in Railway's Variables tab.

```
PORT=3000
```

---

## CLEANUP_CRON

Cron schedule for the automatic file expiry cleanup job. Default runs at 2 AM daily:

```
CLEANUP_CRON=0 2 * * *
```

You can adjust the schedule using standard cron syntax. Leave as-is unless you have a reason to change it.

---

## ALLOWED_ORIGINS

Comma-separated list of origins allowed to make API requests (CORS). Include your Railway domain and any custom domain:

```
ALLOWED_ORIGINS=https://yourapp.railway.app,https://yourcustomdomain.com
```

For local development add `http://localhost:3000`.

---

## Full Variable Reference

| Variable | Required | Where to get it |
|---|---|---|
| `R2_ACCOUNT_ID` | Yes | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` | Yes | Cloudflare R2 API token |
| `R2_SECRET_ACCESS_KEY` | Yes | Cloudflare R2 API token |
| `R2_BUCKET_NAME` | Yes | Your R2 bucket name |
| `R2_PUBLIC_URL` | Yes | R2 bucket public URL (`pub-xxx.r2.dev`) |
| `DATABASE_URL` | Yes | Auto-injected by Railway PostgreSQL |
| `JWT_SECRET` | Yes | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | No | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | No | Google Cloud Console |
| `GITHUB_CLIENT_ID` | No | GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | No | GitHub Developer Settings |
| `APP_URL` | Yes | Your Railway app URL |
| `STRIPE_SECRET_KEY` | No | Stripe Dashboard → API keys |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe Dashboard → Webhooks |
| `STRIPE_STARTER_PRICE_ID` | No | Stripe Dashboard → Product catalog |
| `STRIPE_PRO_PRICE_ID` | No | Stripe Dashboard → Product catalog |
| `PORT` | No | Set to `3000` (Railway injects automatically) |
| `CLEANUP_CRON` | No | `0 2 * * *` (2 AM daily) |
| `ALLOWED_ORIGINS` | Yes | Your app domains, comma-separated |
