import { getInstallationOctokit } from '../config/octokit.js';
import { scanRepositoryForReview } from './githubScanner.service.js';
import { nightlyReviewGraph } from '../workflows/nightlyReviewGraph.js';
import {
  createNightlyBranch,
  commitFilesToBranch,
  createOptimizationPullRequest,
  getNightlyDateString,
} from './gitAutomation.service.js';
import {
  getActiveAssignedRepositories,
  createNightlyRunRecord,
  updateNightlyRunRecord,
  upsertReviewedFile,
  saveOptimizationProposals,
} from './supabase.service.js';

/**
 * Orchestrates the nightly review workflow for a single repository.
 * 
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.installationId
 * @param {string} [params.defaultBranch='main']
 * @param {string} [params.repositoryId]
 * @param {string[]} [params.optimizationTargets]
 * @param {number} [params.reviewIntervalDays=7]
 * @returns {Promise<object>} Summary of the run
 */
export async function runNightlyReviewForRepo({
  owner,
  repo,
  installationId,
  defaultBranch = 'main',
  repositoryId,
  optimizationTargets = ['simd', 'openmp', 'cache', 'algorithmic'],
  reviewIntervalDays = 7,
}) {
  const repoFullName = `${owner}/${repo}`;
  console.log(`\n======================================================`);
  console.log(`🌙 Starting Nightly Review for ${repoFullName}`);
  console.log(`======================================================`);

  const octokit = getInstallationOctokit(installationId);
  const dateStr = getNightlyDateString();
  const branchName = `nightly-ai-review-${dateStr}`;

  // 1. Create Nightly Run record in Supabase
  const runRecord = await createNightlyRunRecord({
    repositoryId,
    repoFullName,
    branchName,
  });
  const runId = runRecord?.id;

  try {
    // 2. Fetch and score candidate files from the repository
    const maxFiles = parseInt(process.env.MAX_FILES_PER_NIGHTLY_RUN || '15', 10);
    const { branchSha, files } = await scanRepositoryForReview({
      octokit,
      owner,
      repo,
      defaultBranch,
      repositoryId,
      reviewIntervalDays,
      maxFiles,
    });

    await updateNightlyRunRecord(runId, {
      status: 'analyzing',
      files_scanned_count: files.length,
    });

    if (files.length === 0) {
      console.log(`[Orchestrator] No unreviewed or candidate files found for ${repoFullName}.`);
      await updateNightlyRunRecord(runId, {
        status: 'completed',
        error_message: 'No candidate files required review.',
      });
      return { success: true, message: 'No candidate files required review.', filesScanned: 0 };
    }

    // 3. Execute LangGraph AI Analysis & Synthesis Pipeline
    console.log(`[Orchestrator] Dispatching ${files.length} file(s) to LangGraph pipeline...`);
    const graphResult = await nightlyReviewGraph.invoke({
      files,
      targetOptimizations: optimizationTargets,
    });

    const optimizations = graphResult.optimizations || [];
    const modifiedFiles = graphResult.modifiedFiles || [];
    const reviewSummary = graphResult.reviewSummary || '';

    console.log(`[Orchestrator] AI Analysis complete. Found ${optimizations.length} optimization(s), ${modifiedFiles.length} modified file(s).`);

    // 4. Case: No code changes were warranted
    if (modifiedFiles.length === 0) {
      console.log(`[Orchestrator] No modified code generated for ${repoFullName}. Updating review timestamps.`);

      // Update reviewed_files table with blob SHAs so they won't be scanned immediately again
      for (const file of files) {
        await upsertReviewedFile({
          repositoryId,
          filePath: file.path,
          blobSha: file.sha,
          hasOptimizations: false,
          nightlyRunId: runId,
        });
      }

      await updateNightlyRunRecord(runId, {
        status: 'completed',
        files_optimized_count: 0,
        error_message: 'No code changes warranted.',
      });

      return {
        success: true,
        message: 'Review completed; no optimizations were necessary.',
        filesScanned: files.length,
        filesOptimized: 0,
      };
    }

    // 5. Case: Code changes exist -> Branch, Commit, and Open PR
    await updateNightlyRunRecord(runId, { status: 'creating_pr' });

    // 5a. Create the branch from default branch base SHA
    const actualBranchName = await createNightlyBranch({
      octokit,
      owner,
      repo,
      defaultBranch,
      baseCommitSha: branchSha,
    });

    // 5b. Commit all modified files atomically via Git Data API
    await commitFilesToBranch({
      octokit,
      owner,
      repo,
      branchName: actualBranchName,
      baseCommitSha: branchSha,
      modifiedFiles,
    });

    // 5c. Create Pull Request
    const { prNumber, prUrl } = await createOptimizationPullRequest({
      octokit,
      owner,
      repo,
      branchName: actualBranchName,
      defaultBranch,
      reviewSummary,
    });

    // 6. Persist results in Supabase
    // Save individual proposals
    if (runId && optimizations.length > 0) {
      const proposalsToSave = optimizations.map((p) => ({
        ...p,
        nightlyRunId: runId,
      }));
      await saveOptimizationProposals(proposalsToSave);
    }

    // Mark reviewed files with latest SHAs
    for (const file of files) {
      const isModified = modifiedFiles.some((mf) => mf.path === file.path);
      await upsertReviewedFile({
        repositoryId,
        filePath: file.path,
        blobSha: file.sha,
        hasOptimizations: isModified,
        nightlyRunId: runId,
      });
    }

    // Mark run completed
    await updateNightlyRunRecord(runId, {
      status: 'completed',
      branch_name: actualBranchName,
      pr_number: prNumber,
      pr_url: prUrl,
      files_optimized_count: modifiedFiles.length,
    });

    console.log(`[Orchestrator] Successfully created PR #${prNumber} for ${repoFullName}: ${prUrl}`);

    return {
      success: true,
      repo: repoFullName,
      branchName: actualBranchName,
      prNumber,
      prUrl,
      filesScanned: files.length,
      filesOptimized: modifiedFiles.length,
      optimizationsCount: optimizations.length,
    };
  } catch (error) {
    console.error(`[Orchestrator Error] Failed nightly review for ${repoFullName}:`, error);
    if (runId) {
      await updateNightlyRunRecord(runId, {
        status: 'failed',
        error_message: error.message,
      });
    }
    throw error;
  }
}

/**
 * Runs the nightly review cycle across all active repositories registered in Supabase.
 */
export async function runNightlyReviewForAllRepos() {
  console.log('\n======================================================');
  console.log('🌌 Starting Nightly Review Cycle Across All Repositories');
  console.log('======================================================');

  let repositories = [];
  try {
    repositories = await getActiveAssignedRepositories();
  } catch (err) {
    console.error('[Orchestrator] Failed to fetch active repositories:', err);
    return [];
  }

  if (repositories.length === 0) {
    console.log('[Orchestrator] No active repositories configured in assigned_repositories.');
    return [];
  }

  const results = [];
  for (const repoConfig of repositories) {
    try {
      const result = await runNightlyReviewForRepo({
        owner: repoConfig.owner,
        repo: repoConfig.repo,
        installationId: repoConfig.installation_id,
        defaultBranch: repoConfig.default_branch || 'main',
        repositoryId: repoConfig.id,
        optimizationTargets: repoConfig.optimization_targets,
        reviewIntervalDays: repoConfig.review_interval_days || 7,
      });
      results.push({ repo: `${repoConfig.owner}/${repoConfig.repo}`, success: true, ...result });
    } catch (err) {
      results.push({
        repo: `${repoConfig.owner}/${repoConfig.repo}`,
        success: false,
        error: err.message,
      });
    }
  }

  console.log('[Orchestrator] Finished nightly review cycle for all repositories.');
  return results;
}
