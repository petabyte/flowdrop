# Deployment Guide — Railway + Cloudflare R2

## Before Pushing to GitHub

Make sure `.gitignore` excludes secrets and data:

```
.env
data/
node_modules/
```

The `data/uploads.json` file must **not** be committed — Railway's filesystem is ephemeral anyway (restarts wipe it), which is fine since R2 is the source of truth for files. DB metadata will reset on redeploy, but the actual files in R2 persist.

---

## Step 1 — Push to GitHub

If you haven't already, initialise and push your repo:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## Step 2 — Create Railway Project from GitHub

1. Go to [railway.app](https://railway.app) and log in (use **Login with GitHub** so Railway can access your repos)
2. Click **New Project** → **Deploy from GitHub repo**
3. Authorise Railway to access your GitHub account if prompted
4. Search for and select your repo
5. Railway will auto-detect `package.json` — before it deploys, go to your service **Settings** → **Build** and set the **Root Directory** to `server/` so Railway runs `npm install` and `npm start` from the right folder
6. Click **Deploy** — Railway will build and start the server

---

## Step 3 — Add Railway PostgreSQL

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway provisions the database and automatically injects `DATABASE_URL` into your project's environment
3. No further configuration needed — the server runs migrations automatically on startup and creates the required tables

---

## Step 4 — Add Environment Variables in Railway

In your Railway project → **Variables** tab, add all of these:

| Variable | Value |
|---|---|
| `R2_ACCOUNT_ID` | From Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | Your bucket name |
| `R2_PUBLIC_URL` | `https://pub-xxxx.r2.dev` |
| `FREE_API_KEY` | `openssl rand -hex 32` |
| `STARTER_API_KEY` | `openssl rand -hex 32` |
| `PRO_API_KEY` | `openssl rand -hex 32` |
| `API_KEY_SECRET` | `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | Your Railway domain + custom domain |
| `PORT` | `3000` (Railway injects this automatically) |
| `CLEANUP_CRON` | `0 2 * * *` |

---

## Step 5 — Cloudflare R2 Bucket Setup

1. Cloudflare Dashboard → **R2** → Create bucket
2. Enable **Public Access** on the bucket → note the `pub-xxx.r2.dev` URL
3. Create an **R2 API Token** with `Object Read & Write` permission on that bucket
4. Copy the `Account ID`, `Access Key ID`, and `Secret Access Key` into Railway vars

---

## Step 6 — Custom Domain (Optional)

- In Railway: **Settings** → **Domains** → add your custom domain
- Update `ALLOWED_ORIGINS` to include it
- You can also point a Cloudflare subdomain (e.g. `cdn.yourdomain.com`) to your R2 bucket for cleaner CDN URLs instead of `pub-xxx.r2.dev`

---

## Step 7 — Verify Deployment

Once Railway deploys, hit these endpoints:

```bash
# Health check
curl https://your-app.railway.app/api/health

# Test upload
curl -X POST https://your-app.railway.app/api/upload \
  -H "x-api-key: YOUR_FREE_API_KEY" \
  -F "file=@test.jpg"

# Check stats
curl https://your-app.railway.app/api/admin/stats \
  -H "x-api-key: YOUR_FREE_API_KEY"
```

---

## Gotcha — Ephemeral Filesystem

Railway's filesystem is **ephemeral** — `data/uploads.json` is wiped on every redeploy or restart. This means the DB metadata (file list, expiry records) resets, but files already uploaded to R2 remain in the bucket. For a production app you'd eventually want to swap `db.js` for a persistent database (Railway offers Postgres). For now it works fine for testing.
