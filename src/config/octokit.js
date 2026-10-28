import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import path from 'path';

/**
 * Normalizes private key retrieval.
 * Supports GITHUB_PRIVATE_KEY as inline string or file path from GITHUB_PRIVATE_KEY_PATH.
 */
function getPrivateKey() {
  if (process.env.GITHUB_PRIVATE_KEY) {
    // Handle escaped newlines if passed in .env
    return process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  if (process.env.GITHUB_PRIVATE_KEY_PATH) {
    const resolvedPath = path.resolve(process.cwd(), process.env.GITHUB_PRIVATE_KEY_PATH);
    if (fs.existsSync(resolvedPath)) {
      return fs.readFileSync(resolvedPath, 'utf8');
    }
  }

  console.warn('[Octokit Config] GitHub App private key not configured.');
  return null;
}

/**
 * Creates an authenticated Octokit instance scoped to a specific repository installation.
 * 
 * @param {number|string} installationId - GitHub App Installation ID
 * @returns {Octokit} Authenticated Octokit instance
 */
export function getInstallationOctokit(installationId) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = getPrivateKey();

  if (!appId || !privateKey) {
    throw new Error('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY in environment.');
  }

  if (!installationId) {
    throw new Error('installationId is required to generate an installation Octokit client.');
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: Number(installationId),
    },
  });
}

/**
 * Creates an app-level Octokit instance (used to list installations, verify app status, etc.)
 * @returns {Octokit}
 */
export function getAppOctokit() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = getPrivateKey();

  if (!appId || !privateKey) {
    throw new Error('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY in environment.');
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });
}
