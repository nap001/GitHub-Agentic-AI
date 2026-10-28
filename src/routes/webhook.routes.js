import { Router } from 'express';
import { verifyGitHubWebhook } from '../middleware/verifyWebhook.js';

const router = Router();

/**
 * Route: POST /api/webhooks/github
 * Listens for GitHub App webhook events (specifically 'pull_request').
 */
router.post('/github', verifyGitHubWebhook, async (req, res) => {
  const event = req.headers['x-github-event'];
  const deliveryId = req.headers['x-github-delivery'];
  const payload = req.body;

  console.log(`[Webhook] Event '${event}' received (Delivery ID: ${deliveryId})`);

  // Handle GitHub App ping event
  if (event === 'ping') {
    return res.status(200).json({ message: 'Pong! Webhook successfully configured.' });
  }

  // Filter for pull_request events
  if (event !== 'pull_request') {
    return res.status(200).json({ message: `Ignored unhandled event: ${event}` });
  }

  const { action, pull_request, repository, installation } = payload;
  const targetActions = ['opened', 'synchronize', 'reopened'];

  if (!targetActions.includes(action)) {
    console.log(`[Webhook] Ignored PR action '${action}' for PR #${pull_request?.number}`);
    return res.status(200).json({ message: `Ignored action: ${action}` });
  }

  // Acknowledge GitHub within the 10-second webhook timeout window
  res.status(202).json({
    status: 'accepted',
    message: `PR #${pull_request.number} action '${action}' accepted for processing`,
    deliveryId,
  });

  // Asynchronous Execution: Process PR review pipeline in background
  try {
    console.log(`[Pipeline] Dispatching review for ${repository.full_name} PR #${pull_request.number} (Commit: ${pull_request.head.sha})`);
    
    // We will hook this to our PR review orchestrator service
    // orchestratePRReview({ payload, installationId: installation?.id });
  } catch (error) {
    console.error(`[Pipeline Error] Failed to process PR #${pull_request?.number}:`, error);
  }
});

export default router;
