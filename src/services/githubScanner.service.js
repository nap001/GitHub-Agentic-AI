import { getReviewedFilesMap } from './supabase.service.js';

// Supported file extensions for algorithmic and hardware-level performance review
const SUPPORTED_EXTENSIONS = new Set([
  // Systems & Hardware Optimization Languages
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.rs', '.cu', '.cuh', '.asm', '.s', '.f90', '.f',
  // Algorithmic & High-level Languages
  '.py', '.go', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.java', '.cs',
]);

// Ignored directories and patterns
const IGNORED_PATH_PREFIXES = [
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  '.git/',
  '.github/',
  'target/',
  'out/',
  'coverage/',
  '__tests__/',
  'test/',
  'tests/',
];

const IGNORED_EXTENSIONS = new Set([
  '.json', '.md', '.txt', '.lock', '.yaml', '.yml',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico',
  '.pdf', '.wasm', '.map', '.min.js', '.min.css',
]);

// Target keywords for scoring optimization opportunities
const OPTIMIZATION_PATTERNS = {
  SIMD: /\b(_mm_|_mm256_|_mm512_|simd|immintrin\.h|arm_neon\.h|xmmintrin|emmintrin|wasm_simd128)\b/i,
  OpenMP: /(#pragma\s+omp\b|omp_get_thread_num|omp_set_num_threads|omp_get_num_threads|#pragma\s+omp\s+parallel)/i,
  ComputeHeavy: /\b(matrix|tensor|convolution|fft|gemm|dot_product|vector_add|quaternion|kernel)\b/i,
  NestedLoops: /(for\s*\(.*?\)\s*\{[^{}]*for\s*\(|while\s*\(.*?\)\s*\{[^{}]*while\s*\()/s,
};

/**
 * Checks if a path should be ignored.
 */
function shouldIgnorePath(filePath) {
  const lowerPath = filePath.toLowerCase();
  if (IGNORED_PATH_PREFIXES.some((prefix) => lowerPath.startsWith(prefix) || lowerPath.includes(`/${prefix}`))) {
    return true;
  }
  for (const ext of IGNORED_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Checks if a file extension is in our supported list.
 */
function isSupportedExtension(filePath) {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.substring(dotIndex).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Scans a GitHub repository, filters candidate files, compares against review history,
 * and fetches the file content for files requiring review.
 * 
 * @param {object} params
 * @param {import('@octokit/rest').Octokit} params.octokit Authenticated Octokit client
 * @param {string} params.owner Repository owner
 * @param {string} params.repo Repository name
 * @param {string} [params.defaultBranch='main'] Default branch name
 * @param {string} [params.repositoryId] Supabase repository UUID
 * @param {number} [params.reviewIntervalDays=7] Window before re-reviewing unchanged files
 * @param {number} [params.maxFiles=15] Max files to return for nightly review
 * @returns {Promise<{ branchSha: string, files: Array<{ path: string, sha: string, content: string, detectedTargets: string[], priorityScore: number }> }>}
 */
export async function scanRepositoryForReview({
  octokit,
  owner,
  repo,
  defaultBranch = 'main',
  repositoryId,
  reviewIntervalDays = 7,
  maxFiles = 15,
}) {
  console.log(`[Repo Scanner] Scanning ${owner}/${repo} on branch '${defaultBranch}'...`);

  // 1. Resolve commit SHA of the default branch
  let branchSha;
  try {
    const branchRef = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: defaultBranch,
    });
    branchSha = branchRef.data.commit.sha;
  } catch (err) {
    console.error(`[Repo Scanner] Failed to get branch '${defaultBranch}' ref for ${owner}/${repo}:`, err.message);
    throw err;
  }

  // 2. Fetch the entire Git Tree recursively
  const treeResponse = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: branchSha,
    recursive: 'true',
  });

  const treeItems = treeResponse.data.tree || [];
  console.log(`[Repo Scanner] Total items in tree: ${treeItems.length}`);

  // 3. Fetch review history from Supabase if repositoryId is provided
  const historyMap = repositoryId ? await getReviewedFilesMap(repositoryId) : new Map();
  const now = Date.now();
  const intervalMs = reviewIntervalDays * 24 * 60 * 60 * 1000;

  // 4. Initial filtering of blobs
  const candidates = [];
  for (const item of treeItems) {
    if (item.type !== 'blob' || !item.path || !item.sha) continue;
    if (shouldIgnorePath(item.path)) continue;
    if (!isSupportedExtension(item.path)) continue;

    // Check if file was recently reviewed and unchanged
    const previous = historyMap.get(item.path);
    if (previous && previous.lastBlobSha === item.sha) {
      const elapsed = now - previous.lastReviewedAt.getTime();
      if (elapsed < intervalMs) {
        // Skip: already reviewed recently and content has not changed
        continue;
      }
    }

    candidates.push({
      path: item.path,
      sha: item.sha,
      size: item.size || 0,
    });
  }

  console.log(`[Repo Scanner] Found ${candidates.length} candidate files needing review`);

  // 5. Fetch content and calculate optimization priority score
  // We cap candidate content fetching to avoid unbounded API usage
  const batchCandidates = candidates.slice(0, maxFiles * 3);
  const scoredFiles = [];

  for (const candidate of batchCandidates) {
    try {
      // Use getBlob to fetch raw blob content directly by SHA
      const blobResponse = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: candidate.sha,
      });

      const buffer = Buffer.from(blobResponse.data.content, 'base64');
      const content = buffer.toString('utf8');

      // Skip empty or massive files (> 200KB) to protect AI context limits
      if (content.length === 0 || content.length > 200000) {
        continue;
      }

      const detectedTargets = [];
      let priorityScore = 0;

      if (OPTIMIZATION_PATTERNS.SIMD.test(content)) {
        detectedTargets.push('SIMD');
        priorityScore += 10;
      }
      if (OPTIMIZATION_PATTERNS.OpenMP.test(content)) {
        detectedTargets.push('OpenMP');
        priorityScore += 10;
      }
      if (OPTIMIZATION_PATTERNS.ComputeHeavy.test(content)) {
        detectedTargets.push('ComputeHeavy');
        priorityScore += 5;
      }
      if (OPTIMIZATION_PATTERNS.NestedLoops.test(content)) {
        detectedTargets.push('NestedLoops');
        priorityScore += 3;
      }

      // Bonus score for performance-critical systems files (.c, .cpp, .rs, .cu)
      if (/\.(c|cpp|cc|rs|cu|cuh|h|hpp)$/i.test(candidate.path)) {
        priorityScore += 2;
      }

      scoredFiles.push({
        path: candidate.path,
        sha: candidate.sha,
        content,
        detectedTargets,
        priorityScore,
      });
    } catch (err) {
      console.warn(`[Repo Scanner] Error fetching blob for ${candidate.path}:`, err.message);
    }
  }

  // 6. Sort descending by priority score and take top `maxFiles`
  scoredFiles.sort((a, b) => b.priorityScore - a.priorityScore);
  const selectedFiles = scoredFiles.slice(0, maxFiles);

  console.log(`[Repo Scanner] Selected ${selectedFiles.length} prioritized files for nightly review.`);

  return {
    branchSha,
    files: selectedFiles,
  };
}
