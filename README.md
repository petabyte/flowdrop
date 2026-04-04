# Upload to URL

An API-first file hosting service — upload files and get instant public CDN URLs, backed by **Cloudflare R2** with automatic cleanup based on subscription tier.

## Features

- 📤 Drag-and-drop or API file uploads
- 🔗 Instant public CDN URLs via Cloudflare R2
- 💰 3 subscription tiers with automatic file retention/cleanup
- 🗓 Scheduled nightly cleanup via `node-cron`
- 🔑 API key authentication (per-tier keys)
- 🚦 Rate limiting (100 req/15min; 30 uploads/15min)
- 📊 Admin endpoints for stats and manual cleanup

## Subscription Tiers

| Tier    | File Retention | Max File Size | Uploads/Month |
|---------|---------------|---------------|---------------|
| Free    | 7 days        | 10 MB         | 25            |
| Starter | 30 days       | 50 MB         | 1,000         |
| Pro     | Never         | 200 MB        | 6,000         |

Tier is resolved from the API key used on upload (`FREE_API_KEY`, `STARTER_API_KEY`, `PRO_API_KEY`).

## Project Structure

```
url_temp/
├── server/
│   ├── index.js                  # Express entry point
│   ├── package.json
│   ├── .env.example              # Copy to .env and fill in values
│   ├── lib/
│   │   ├── r2.js                 # Cloudflare R2 S3 client
│   │   ├── db.js                 # SQLite upload tracking
│   │   ├── tiers.js              # Tier config + expiry helpers
│   │   ├── cleanup.js            # R2 + DB purge logic
│   │   └── scheduler.js          # node-cron job
│   ├── middleware/
│   │   ├── auth.js               # API key validation
│   │   └── rateLimit.js          # Rate limiter
│   └── routes/
│       └── upload.js             # Upload / list / delete / admin routes
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── data/                         # Auto-created — contains uploads.db (add to .gitignore)
```

## Setup

### 1. Clone and install

```bash
cd server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Cloudflare R2 credentials and API keys
```

### 3. Create a Cloudflare R2 bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Create a new bucket (e.g. `my-uploads`)
3. Enable **Public Access** and note the public URL (`pub-xxx.r2.dev`)
4. Create an **API Token** with R2 Read+Write permissions
5. Copy `Account ID`, `Access Key ID`, `Secret Access Key` into `.env`

### 4. Run locally

```bash
npm run dev   # nodemon
# or
npm start     # plain node
```

Server starts at `http://localhost:3000`.
Frontend served from `../public/`.

## API Reference

### Upload files
```bash
POST /api/upload
x-api-key: your-key
Content-Type: multipart/form-data

curl -X POST http://localhost:3000/api/upload \
  -H "x-api-key: $FREE_API_KEY" \
  -F "file=@photo.jpg"
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "files": [{
    "id": "uuid",
    "url": "https://pub-xxx.r2.dev/uuid.jpg",
    "tier": "free",
    "expiresAt": "2026-04-10T19:00:00.000Z",
    "retention": "7-day file retention"
  }]
}
```

### List uploads
```bash
GET /api/files?limit=20&offset=0&tier=free
x-api-key: your-key
```

### Delete a file
```bash
DELETE /api/files/:key
x-api-key: your-key
```

### Manual cleanup (admin)
```bash
POST /api/admin/cleanup
x-api-key: your-key
```

### Tier stats (admin)
```bash
GET /api/admin/stats
x-api-key: your-key
```

### Health check
```bash
GET /api/health
```

## Deployment (Railway + Cloudflare R2)

1. Push this repo to GitHub
2. Create a new [Railway](https://railway.app) project → connect GitHub repo
3. Add all `.env` values in Railway's **Variables** tab
4. Railway auto-detects `package.json` and deploys
5. Set `ALLOWED_ORIGINS` to your production frontend domain
6. Point a custom domain (optional) via Railway settings

## Cleanup Schedule

Default: **2:00 AM daily** (`0 2 * * *`).

Override via `CLEANUP_CRON` env var. The cleanup job:
1. Queries the SQLite DB for all rows where `expires_at <= now`
2. Calls `DeleteObjectCommand` on each expired file in R2
3. Removes the row from the DB
4. Logs results

Add `data/` to `.gitignore` to avoid committing the SQLite database.
