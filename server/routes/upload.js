const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const r2Client = require('../lib/r2');
const { stmts } = require('../lib/db');
const { tierFromApiKey, calcExpiresAt, TIERS } = require('../lib/tiers');
const { cleanupExpiredFiles, getRetentionSummary } = require('../lib/cleanup');
const { requireApiKey } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Allowed MIME types
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
        cb(null, {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
          tier: req.userTier || 'free',
        });
      },
    }),
    limits: { fileSize: maxFileSizeMB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
      cb(new Error(`File type "${file.mimetype}" is not allowed.`), false);
    },
  });
}

// ─── Middleware: resolve tier from API key ─────────────────────────────────────
function resolveTier(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  req.userTier = tierFromApiKey(apiKey);
  req.tierConfig = TIERS[req.userTier];
  next();
}

/**
 * POST /api/upload
 * Streams files to R2, records each upload in SQLite with tier + expiry.
 */
router.post('/upload', uploadLimiter, requireApiKey, resolveTier, (req, res) => {
  const maxSizeMB = req.tierConfig.maxFileSizeMB;
  const uploader = buildUploader(maxSizeMB);

  uploader.array('file', 10)(req, res, (err) => {
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

    for (const file of req.files) {
      const id = file.key.split('.')[0]; // UUID
      const expiresAt = calcExpiresAt(req.userTier);
      const url = `${process.env.R2_PUBLIC_URL}/${file.key}`;

      // Persist to SQLite
      stmts.insert({
        id,
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
        id,
        key: file.key,
        filename: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        url,
        tier: req.userTier,
        uploadedAt: now,
        expiresAt,
        retention: req.tierConfig.description,
      });
    }

    res.status(200).json({ success: true, count: results.length, files: results });
  });
});

/**
 * GET /api/files
 * List uploads from the DB (filtered by tier if ?tier= param provided).
 */
router.get('/files', requireApiKey, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);
  const tier = req.query.tier;

  const files = tier
    ? stmts.listByTier(tier, limit, offset)
    : stmts.listAll(limit, offset);

  res.json({ success: true, count: files.length, files });
});

/**
 * DELETE /api/files/:key
 * Delete a file from both R2 and the DB.
 */
router.delete('/files/:key', requireApiKey, async (req, res) => {
  const key = req.params.key;
  if (!key || key.includes('..') || key.includes('/')) {
    return res.status(400).json({ error: 'Invalid Key' });
  }

  try {
    await r2Client.send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
    );
    stmts.deleteByKey(key);
    res.json({ success: true, message: `File "${key}" deleted.` });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/admin/cleanup
 * Manually trigger expired file cleanup (admin use or testing).
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
 * Per-tier upload counts and storage usage.
 */
router.get('/admin/stats', requireApiKey, (req, res) => {
  const stats = stmts.countByTier();
  const retention = getRetentionSummary();

  res.json({
    success: true,
    tiers: retention.map((t) => {
      const s = stats.find((r) => r.tier === t.tier) || { count: 0, total_bytes: 0 };
      return { ...t, uploads: s.count, storageBytes: s.total_bytes };
    }),
  });
});

module.exports = router;
