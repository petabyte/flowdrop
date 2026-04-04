const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const r2Client = require('./r2');
const { stmts } = require('./db');
const { TIERS } = require('./tiers');

/**
 * cleanupExpiredFiles
 *
 * Finds all uploads past their expires_at date, deletes each from R2,
 * then removes the DB record. Safe to call as often as you like — it
 * only touches rows that are genuinely overdue.
 *
 * @returns {{ deleted: number, errors: number, details: object[] }}
 */
async function cleanupExpiredFiles() {
  const expired = await stmts.findExpired();

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
      // 1. Delete from Cloudflare R2
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: file.key,
        })
      );

      // 2. Remove from DB
      await stmts.deleteByKey(file.key);

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

/**
 * getRetentionSummary
 *
 * Returns a human-readable summary of each tier's retention policy.
 */
function getRetentionSummary() {
  return Object.entries(TIERS).map(([tier, config]) => ({
    tier,
    label: config.label,
    retentionDays: config.retentionDays,
    description: config.description,
  }));
}

module.exports = { cleanupExpiredFiles, getRetentionSummary };
