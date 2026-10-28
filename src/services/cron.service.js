import cron from 'node-cron';

let scheduledTask = null;

/**
 * Initializes the nightly review cron scheduler.
 * 
 * @param {Function} taskExecutor - Async function to run (e.g., nightlyOrchestrator.runNightlyReviewForAllRepos)
 */
export function initCronScheduler(taskExecutor) {
  const isEnabled = process.env.ENABLE_LOCAL_CRON === 'true';
  const cronSchedule = process.env.NIGHTLY_CRON_SCHEDULE || '0 2 * * *'; // Default 2:00 AM daily

  if (!isEnabled) {
    console.log('[Cron Service] Local cron scheduler disabled (ENABLE_LOCAL_CRON is not true).');
    return;
  }

  if (!cron.validate(cronSchedule)) {
    console.error(`[Cron Service] Invalid cron schedule expression: "${cronSchedule}". Scheduler aborted.`);
    return;
  }

  console.log(`[Cron Service] Initializing local nightly cron scheduler with expression: "${cronSchedule}"`);

  scheduledTask = cron.schedule(
    cronSchedule,
    async () => {
      console.log(`[Cron Service] Nightly review triggered at ${new Date().toISOString()}`);
      try {
        if (typeof taskExecutor === 'function') {
          await taskExecutor();
        } else {
          console.warn('[Cron Service] No task executor function supplied to cron runner.');
        }
      } catch (err) {
        console.error('[Cron Service] Error during nightly review execution:', err);
      }
    },
    {
      scheduled: true,
      timezone: process.env.TZ || 'UTC',
    }
  );

  console.log('[Cron Service] Nightly review cron schedule active.');
}

/**
 * Gracefully stops the cron task (e.g. on server shutdown)
 */
export function stopCronScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log('[Cron Service] Cron scheduler stopped.');
    scheduledTask = null;
  }
}
