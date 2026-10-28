import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { initCronScheduler, stopCronScheduler } from './services/cron.service.js';
import { runNightlyReviewForAllRepos } from './services/nightlyOrchestrator.service.js';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Code Review Agent Server running on port ${PORT}`);
  console.log(`📡 GitHub Webhook URL: http://localhost:${PORT}/api/webhooks/github`);
  console.log(`🌙 Nightly Trigger:    http://localhost:${PORT}/api/nightly/trigger`);
  console.log(`🩺 Health Check URL:   http://localhost:${PORT}/health`);
  console.log(`====================================================`);

  // Initialize local cron scheduler if ENABLE_LOCAL_CRON=true
  initCronScheduler(runNightlyReviewForAllRepos);
});

// Graceful shutdown handling
const handleShutdown = () => {
  console.log('\n[Server] Shutting down gracefully...');
  stopCronScheduler();
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

