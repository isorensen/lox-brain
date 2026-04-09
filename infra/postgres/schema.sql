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
