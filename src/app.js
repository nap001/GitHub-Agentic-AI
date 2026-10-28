import express from 'express';
import cors from 'cors';
import webhookRouter from './routes/webhook.routes.js';

const app = express();

// Enable Cross-Origin Resource Sharing
app.use(cors());

/**
 * Capture raw buffer for webhook signature verification.
 * The raw body buffer is strictly required to verify GitHub's HMAC-SHA256 signature.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Fallback urlencoded support
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Autonomous Code Review & Optimization Agent',
  });
});

// Register webhook routes
app.use('/api/webhooks', webhookRouter);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Global Error Handler
app.use((err, req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
