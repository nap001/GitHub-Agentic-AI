import crypto from 'crypto';

/**
 * Middleware to verify GitHub Webhook signature (X-Hub-Signature-256).
 * GitHub signs the payload using HMAC-SHA256 with the configured Webhook Secret.
 * Uses timingSafeEqual to protect against timing attacks.
 */
export function verifyGitHubWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Webhook Auth] GITHUB_WEBHOOK_SECRET is not configured in environment.');
    return res.status(500).json({ error: 'Server misconfiguration: Webhook secret missing' });
  }

  if (!signature) {
    console.warn('[Webhook Auth] Missing X-Hub-Signature-256 header.');
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  // Ensure rawBody was captured during JSON body parsing
  if (!req.rawBody) {
    console.error('[Webhook Auth] Raw request body buffer not available. Ensure express.json() verify hook is active.');
    return res.status(500).json({ error: 'Internal Server Error: Raw body missing' });
  }

  try {
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(req.rawBody);
    const expectedSignature = `sha256=${hmac.digest('hex')}`;

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    // Length check before timingSafeEqual to avoid RangeError
    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      console.warn('[Webhook Auth] Invalid webhook signature detected.');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    return next();
  } catch (err) {
    console.error('[Webhook Auth] Signature verification exception:', err);
    return res.status(401).json({ error: 'Webhook signature verification failed' });
  }
}
