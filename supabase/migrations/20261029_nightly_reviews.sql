-- 1. Assigned Repositories for Nightly Review
CREATE TABLE IF NOT EXISTS assigned_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    installation_id BIGINT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    is_active BOOLEAN NOT NULL DEFAULT true,
    optimization_targets TEXT[] NOT NULL DEFAULT ARRAY['simd', 'openmp', 'algorithmic', 'cache_locality'],
    review_interval_days INTEGER NOT NULL DEFAULT 7,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(owner, repo)
);

-- 2. Nightly Review Runs Log
CREATE TABLE IF NOT EXISTS nightly_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES assigned_repositories(id) ON DELETE CASCADE,
    repo_full_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'scanning', 'analyzing', 'creating_pr', 'completed', 'failed')),
    branch_name TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    files_scanned_count INTEGER NOT NULL DEFAULT 0,
    files_optimized_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 3. File Review History (Tracks file content SHAs to skip unchanged/recently reviewed files)
CREATE TABLE IF NOT EXISTS reviewed_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES assigned_repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    last_blob_sha TEXT NOT NULL,
    last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    has_optimizations BOOLEAN NOT NULL DEFAULT false,
    nightly_run_id UUID REFERENCES nightly_runs(id) ON DELETE SET NULL,
    UNIQUE(repository_id, file_path)
);

-- 4. Granular Optimization Proposals
CREATE TABLE IF NOT EXISTS optimization_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nightly_run_id UUID NOT NULL REFERENCES nightly_runs(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('SIMD', 'OpenMP', 'Algorithmic', 'CacheLocality', 'Refactoring')),
    description TEXT NOT NULL,
    original_code TEXT,
    optimized_code TEXT,
    requires_human_verification BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices for fast lookups
CREATE INDEX IF NOT EXISTS idx_reviewed_files_repo_path ON reviewed_files(repository_id, file_path);
CREATE INDEX IF NOT EXISTS idx_nightly_runs_repo_status ON nightly_runs(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_assigned_repos_active ON assigned_repositories(is_active);
