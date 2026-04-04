require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { apiLimiter } = require('./middleware/rateLimit');
const uploadRoutes = require('./routes/upload');
const paymentRoutes = require('./routes/payments');
const { startCleanupScheduler } = require('./lib/scheduler');
const { TIERS } = require('./lib/tiers');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin))
        return cb(null, true);
      cb(new Error(`CORS policy: origin "${origin}" not allowed.`));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
  })
);

// ─── Body parsers ─────────────────────────────────────────────────────────────
// Stripe webhook needs raw body — must be registered BEFORE express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Serve Frontend ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api', apiLimiter, uploadRoutes);
app.use('/api/payments', paymentRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bucket: process.env.R2_BUCKET_NAME || 'not configured',
    tiers: Object.fromEntries(
      Object.entries(TIERS).map(([k, v]) => [
        k,
        {
          retentionDays: v.retentionDays,
          maxFileSizeMB: v.maxFileSizeMB,
          maxUploadsPerMonth: v.maxUploadsPerMonth,
        },
      ])
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

// ─── Start Server + Scheduler ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Upload to URL server running at http://localhost:${PORT}`);
  console.log(`   → Health:   GET  http://localhost:${PORT}/api/health`);
  console.log(`   → Upload:   POST http://localhost:${PORT}/api/upload`);
  console.log(`   → Files:    GET  http://localhost:${PORT}/api/files`);
  console.log(`   → Cleanup:  POST http://localhost:${PORT}/api/admin/cleanup`);
  console.log(`   → Stats:    GET  http://localhost:${PORT}/api/admin/stats`);
  console.log(`\n📦 Retention policy:`);
  Object.entries(TIERS).forEach(([tier, cfg]) => {
    const days = cfg.retentionDays ? `${cfg.retentionDays} days` : 'never expires';
    console.log(`   ${tier.padEnd(8)} → ${days}`);
  });
  console.log('');

  // Start the nightly cleanup cron job
  startCleanupScheduler();
});

module.exports = app;
