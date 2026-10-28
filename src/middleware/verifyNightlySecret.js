import crypto from 'crypto';

/**
 * Middleware to secure nightly review trigger endpoints.
 * Requires a pre-shared secret token passed in:
 * - Header: 'x-nightly-secret' OR
 * - Header: 'Authorization: Bearer <token>'
 */
export function verifyNightlySecret(req, res, next) {
  const configuredSecret = process.env.NIGHTLY_JOB_SECRET;

  if (!configuredSecret) {
    console.error('[Nightly Auth] NIGHTLY_JOB_SECRET is not configured in environment.');
    return res.status(500).json({ error: 'Server misconfiguration: NIGHTLY_JOB_SECRET missing' });
  }

  // Extract secret from x-nightly-secret or Authorization header
  let providedToken = req.headers['x-nightly-secret'];

  const authHeader = req.headers['authorization'];
  if (!providedToken && authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  }

  if (!providedToken) {
    console.warn('[Nightly Auth] Missing authentication secret in request.');
    return res.status(401).json({ error: 'Unauthorized: Missing x-nightly-secret or Bearer token' });
  }

  try {
    const providedBuffer = Buffer.from(providedToken, 'utf8');
    const expectedBuffer = Buffer.from(configuredSecret, 'utf8');

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      console.warn('[Nightly Auth] Invalid nightly secret provided.');
      return res.status(403).json({ error: 'Forbidden: Invalid secret token' });
    }

    return next();
  } catch (err) {
    console.error('[Nightly Auth] Error verifying secret:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
