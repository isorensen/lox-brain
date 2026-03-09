-- Migration: Add chunk_index column for text chunking support
-- Date: 2026-03-08
-- Design: docs/plans/2026-03-08-text-chunking-design.md
--
-- Run on VM: psql -U obsidian_brain -d open_brain -f scripts/migrate-chunk-index.sql

BEGIN;

-- Step 1: Add chunk_index column (default 0 for existing single-chunk rows)
ALTER TABLE vault_embeddings ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;

-- Step 2: Drop old unique constraint on file_path alone
ALTER TABLE vault_embeddings DROP CONSTRAINT IF EXISTS vault_embeddings_file_path_key;

-- Step 3: Add new composite unique constraint
ALTER TABLE vault_embeddings ADD CONSTRAINT vault_embeddings_file_path_chunk_idx_key UNIQUE(file_path, chunk_index);

COMMIT;
