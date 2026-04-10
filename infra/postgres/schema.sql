-- Lox Brain — PostgreSQL schema
-- Requires: pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vault_embeddings (
  id UUID PRIMARY KEY,
  file_path TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  file_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_embedding
  ON vault_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_tags
  ON vault_embeddings USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_updated_at
  ON vault_embeddings (updated_at DESC);

-- Optional metadata columns for domain filtering
ALTER TABLE vault_embeddings ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE vault_embeddings ADD COLUMN IF NOT EXISTS source_type TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_area
  ON vault_embeddings(area) WHERE area IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_source_type
  ON vault_embeddings(source_type) WHERE source_type IS NOT NULL;
