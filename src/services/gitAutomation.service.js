/**
 * Formats a clean date string in YYYY-MM-DD format.
 */
export function getNightlyDateString(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Creates a unique branch name for the nightly review.
 * Example: nightly-ai-review-2026-10-29
 * If the branch already exists, appends a timestamp suffix to ensure uniqueness.
 */
export async function createNightlyBranch({ octokit, owner, repo, defaultBranch, baseCommitSha }) {
  const dateStr = getNightlyDateString();
  let branchName = `nightly-ai-review-${dateStr}`;

  // Check if branch already exists
  try {
    const existingRef = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });
    if (existingRef.data) {
      // Append hours and minutes if a previous run today created this branch
      const timeSuffix = new Date().toTimeString().slice(0, 5).replace(':', '');
      branchName = `nightly-ai-review-${dateStr}-${timeSuffix}`;
    }
  } catch (err) {
    // 404 indicates the branch does not exist, which is expected
    if (err.status !== 404) {
      console.warn(`[Git Automation] Note on checking ref heads/${branchName}:`, err.message);
    }
  }

  console.log(`[Git Automation] Creating branch '${branchName}' from base SHA ${baseCommitSha.slice(0, 7)}...`);

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseCommitSha,
  });

  return branchName;
}

/**
 * Pushes modified files as an atomic single commit to the target branch using the Git Data API.
 * 
 * @param {object} params
 * @param {import('@octokit/rest').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.branchName Target branch name
 * @param {string} params.baseCommitSha SHA of the commit the branch was created from
 * @param {Array<{ path: string, modifiedContent: string }>} params.modifiedFiles
 * @returns {Promise<string>} The created commit SHA
 */
export async function commitFilesToBranch({
  octokit,
  owner,
  repo,
  branchName,
  baseCommitSha,
  modifiedFiles,
}) {
  if (!modifiedFiles || modifiedFiles.length === 0) {
    throw new Error('No modified files provided for commit.');
  }

  console.log(`[Git Automation] Committing ${modifiedFiles.length} file(s) to '${branchName}' via Git Data API...`);

  // 1. Create a Git blob for each modified file
  const treeEntries = [];
  for (const file of modifiedFiles) {
    console.log(`[Git Automation] Creating blob for ${file.path}...`);
    const blobResponse = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: file.modifiedContent,
      encoding: 'utf-8',
    });

    treeEntries.push({
      path: file.path,
      mode: '100644', // normal file
      type: 'blob',
      sha: blobResponse.data.sha,
    });
  }

  // 2. Create a new Git Tree referencing the base commit's tree
  console.log(`[Git Automation] Creating new tree with ${treeEntries.length} entries...`);
  const treeResponse = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommitSha,
    tree: treeEntries,
  });

  const newTreeSha = treeResponse.data.sha;

  // 3. Create a single atomic commit
  const dateStr = getNightlyDateString();
  const commitMessage = `perf: autonomous nightly optimizations [${dateStr}]\n\nAutomated performance review applying SIMD vectorization, OpenMP parallelism, CPU cache alignment, and algorithmic speedups.`;

  console.log(`[Git Automation] Creating commit on tree ${newTreeSha.slice(0, 7)}...`);
  const commitResponse = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: newTreeSha,
    parents: [baseCommitSha],
  });

  const newCommitSha = commitResponse.data.sha;

  // 4. Update the branch HEAD ref to point to the new commit
  console.log(`[Git Automation] Updating ref heads/${branchName} to ${newCommitSha.slice(0, 7)}...`);
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: newCommitSha,
    force: false,
  });

  console.log(`[Git Automation] Successfully committed changes to ${branchName} (Commit: ${newCommitSha})`);
  return newCommitSha;
}

/**
 * Opens a Pull Request against the default branch summarizing the AI optimizations.
 * 
 * @param {object} params
 * @param {import('@octokit/rest').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.branchName
 * @param {string} [params.defaultBranch='main']
 * @param {string} params.reviewSummary Markdown formatted summary from LangGraph
 * @returns {Promise<{ prNumber: number, prUrl: string }>}
 */
export async function createOptimizationPullRequest({
  octokit,
  owner,
  repo,
  branchName,
  defaultBranch = 'main',
  reviewSummary,
}) {
  const dateStr = getNightlyDateString();
  const title = `perf(nightly): autonomous AI performance optimizations (${dateStr})`;

  console.log(`[Git Automation] Opening PR from '${branchName}' -> '${defaultBranch}' in ${owner}/${repo}...`);

  const prResponse = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head: branchName,
    base: defaultBranch,
    body: reviewSummary,
    maintainer_can_modify: true,
  });

  const prNumber = prResponse.data.number;
  const prUrl = prResponse.data.html_url;

  console.log(`[Git Automation] PR #${prNumber} opened successfully: ${prUrl}`);

  // Attempt to apply descriptive labels to the PR (non-fatal if labels don't exist in target repo)
  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: ['performance', 'automated-pr', 'ai-review'],
    });
  } catch (labelErr) {
    console.log(`[Git Automation] Labels could not be attached (optional): ${labelErr.message}`);
  }

  return {
    prNumber,
    prUrl,
  };
}
