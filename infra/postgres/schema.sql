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

-- Full-text search indexes (dual-language: Portuguese + English)
-- Two separate GIN indexes allow PostgreSQL to combine them via BitmapOr,
-- applying language-specific stemming and stop words for each language.
CREATE INDEX IF NOT EXISTS idx_vault_embeddings_fulltext_pt
  ON vault_embeddings USING GIN(to_tsvector('portuguese', content));

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_fulltext_en
  ON vault_embeddings USING GIN(to_tsvector('english', content));

-- Optional metadata columns for domain filtering
ALTER TABLE vault_embeddings ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE vault_embeddings ADD COLUMN IF NOT EXISTS source_type TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_area
  ON vault_embeddings(area) WHERE area IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vault_embeddings_source_type
  ON vault_embeddings(source_type) WHERE source_type IS NOT NULL;

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date DATE,
  tags TEXT[] DEFAULT '{}',
  project_context TEXT,
  created_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON tasks(due_date) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_tasks_project_context ON tasks(project_context);
