# Design: Text Chunking for Large Notes

**Date:** 2026-03-08
**Status:** Approved
**Problem:** 5 notes exceed OpenAI text-embedding-3-small token limit (8192 tokens) and were never indexed.

## Affected Notes

| Note | Tokens |
|------|--------|
| Lei 10820 compilado.md | 13,257 |
| PORTARIA MTE Nº 435.md | 13,062 |
| Resolução BCB n 352.md | 45,576 |
| Resolução CMN n 4966.md | 34,907 |
| Exponential Organizations.md | 9,297 |

## Approach: Chunks as Separate Rows

Store each chunk as its own row in `vault_embeddings` with a `chunk_index` column. This preserves semantic signal — searching "provisão para perdas esperadas" matches the specific article, not a diluted average of the entire law.

## Schema Changes

```sql
ALTER TABLE vault_embeddings ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vault_embeddings DROP CONSTRAINT vault_embeddings_file_path_key;
ALTER TABLE vault_embeddings ADD CONSTRAINT vault_embeddings_file_path_chunk_idx_key UNIQUE(file_path, chunk_index);
```

- Non-chunked notes: 1 row with `chunk_index = 0` (no behavior change)
- Chunked notes: N rows with `chunk_index = 0, 1, 2...`
- `deleteNote` still works (deletes by `file_path`, catches all chunks)

## Chunking Strategy

**New method:** `EmbeddingService.chunkText(text: string): string[]`

- `maxTokens: 6000` — safe margin below 8192 limit
- `overlapTokens: 200` — context continuity between chunks
- Token estimation: `Math.ceil(text.length / 4)` (no tiktoken dependency)
- Split by paragraphs (`\n\n`) to preserve semantic units (articles, sections)
- If ≤ maxTokens: return `[text]` (no chunking)
- If > maxTokens: group paragraphs into chunks respecting maxTokens, with overlap

## Pipeline Changes

### VaultWatcher.handleFileChange
1. Parse note (unchanged)
2. Call `chunkText()` on content
3. If 1 chunk: current flow (upsert with chunk_index=0)
4. If N chunks: generate embedding per chunk, upsert each with chunk_index 0..N-1, delete orphan chunks above N-1

### DbClient
- `upsertNote`: `ON CONFLICT (file_path, chunk_index)` — add `chunk_index` to `NoteRow`
- New: `deleteChunksAbove(filePath, maxChunkIndex)` — cleanup orphans
- `deleteNote`: no change
- Search methods: no change (chunks appear as regular rows)

### NoteRow type
- Add `chunk_index: number` (default 0)

## Search Result Behavior

When a chunk matches, the result shows `file_path` (original note) + chunk content. Client uses `read_note` for full document context.

## Tests (~12 new)

- `EmbeddingService.chunkText`: short text → 1 chunk, long text → N chunks, paragraph-based split, overlap between consecutive chunks, fallback for text without `\n\n`
- `DbClient.upsertNote`: with chunk_index, ON CONFLICT (file_path, chunk_index)
- `DbClient.deleteChunksAbove`: deletes chunks above index
- `VaultWatcher.handleFileChange`: large note → multiple upserts, edited note (fewer chunks) → orphan cleanup

## Re-indexing

After deploy: `npm run index-vault` on VM. The 5 failed notes have no hash in DB, so they will be processed automatically.

## Impact

| Metric | Before | After |
|--------|--------|-------|
| Indexed notes | All except 5 large ones | All notes |
| Search coverage | Missing legal/regulatory docs | Complete |
| Semantic precision | N/A for large docs | Chunk-level matches |
