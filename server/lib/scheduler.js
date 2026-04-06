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
