import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Code Review Agent Server running on port ${PORT}`);
  console.log(`📡 GitHub Webhook URL: http://localhost:${PORT}/api/webhooks/github`);
  console.log(`🩺 Health Check URL:  http://localhost:${PORT}/health`);
  console.log(`====================================================`);
});
