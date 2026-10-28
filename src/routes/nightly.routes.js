import { Router } from 'express';
import { verifyNightlySecret } from '../middleware/verifyNightlySecret.js';
import {
  runNightlyReviewForRepo,
  runNightlyReviewForAllRepos,
} from '../services/nightlyOrchestrator.service.js';
import { supabase } from '../config/supabase.js';

const router = Router();

/**
 * Route: POST /api/nightly/trigger
 * Triggers the nightly review cycle.
 * Can be triggered via external cron (e.g. GitHub Actions) or manual curl.
 * 
 * Body (optional for single repo override):
 * {
 *   "owner": "nap001",
 *   "repo": "high-perf-kernel",
 *   "installationId": 12345678,
 *   "defaultBranch": "main"
 * }
 */
router.post('/trigger', verifyNightlySecret, async (req, res) => {
  const { owner, repo, installationId, defaultBranch } = req.body || {};

  // Acknowledge trigger immediately (202 Accepted)
  res.status(202).json({
    status: 'accepted',
    message: owner && repo
      ? `Nightly review started for ${owner}/${repo}`
      : 'Nightly review started across all active assigned repositories',
    triggeredAt: new Date().toISOString(),
  });

  // Run asynchronously in the background
  (async () => {
    try {
      if (owner && repo && installationId) {
        console.log(`[Nightly Trigger] Manual trigger received for single repo ${owner}/${repo}`);
        await runNightlyReviewForRepo({
          owner,
          repo,
          installationId,
          defaultBranch: defaultBranch || 'main',
        });
      } else {
        console.log('[Nightly Trigger] Trigger received for all assigned repositories.');
        await runNightlyReviewForAllRepos();
      }
    } catch (err) {
      console.error('[Nightly Trigger] Error during background review run:', err);
    }
  })();
});

/**
 * Route: GET /api/nightly/status/:runId
 * Fetches status and PR details of a specific nightly run.
 */
router.get('/status/:runId', verifyNightlySecret, async (req, res) => {
  const { runId } = req.params;

  if (!supabase) {
    return res.status(503).json({ error: 'Supabase integration is not configured' });
  }

  const { data, error } = await supabase
    .from('nightly_runs')
    .select(`
      *,
      optimization_proposals (*)
    `)
    .eq('id', runId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: `Run with ID '${runId}' not found` });
  }

  return res.status(200).json({ run: data });
});

/**
 * Route: POST /api/nightly/register-repo
 * Convenience endpoint to register an assigned repository into Supabase.
 */
router.post('/register-repo', verifyNightlySecret, async (req, res) => {
  const { owner, repo, installationId, defaultBranch, optimizationTargets, reviewIntervalDays } = req.body || {};

  if (!owner || !repo || !installationId) {
    return res.status(400).json({ error: 'owner, repo, and installationId are required' });
  }

  if (!supabase) {
    return res.status(503).json({ error: 'Supabase integration is not configured' });
  }

  const { data, error } = await supabase
    .from('assigned_repositories')
    .upsert(
      {
        owner,
        repo,
        installation_id: Number(installationId),
        default_branch: defaultBranch || 'main',
        optimization_targets: optimizationTargets || ['simd', 'openmp', 'cache', 'algorithmic'],
        review_interval_days: reviewIntervalDays || 7,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner,repo' }
    )
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ message: 'Repository registered successfully', data });
});

export default router;
