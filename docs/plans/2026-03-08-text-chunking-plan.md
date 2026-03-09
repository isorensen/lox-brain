# Implementation Plan: Text Chunking for Large Notes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Date:** 2026-03-08
**Design:** `docs/plans/2026-03-08-text-chunking-design.md`
**Branch:** `feat/v0_2`

## Overview

Add text chunking to handle notes exceeding the 8192-token OpenAI embedding limit. 5 notes are currently unindexed. Changes span 4 source files, 1 migration script, and 3 test files.

## Prerequisites

- Ensure tests pass before starting: `npm test`

---

## Phase 1: Types (NoteRow)

### Task 1.1 — Test: NoteRow should accept chunk_index

**File:** `tests/lib/db-client.test.ts`

Add a test inside the existing `upsertNote` describe block that verifies `NoteRow` accepts `chunk_index`:

```typescript
it('should accept chunk_index in NoteRow', async () => {
  mockPool.query.mockResolvedValue({ rowCount: 1 });

  const note: NoteRow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    file_path: 'notes/test.md',
    title: 'Test Note',
    content: 'Test content',
    tags: ['tag1'],
    embedding: [0.1, 0.2],
    file_hash: 'abc123hash',
    chunk_index: 0,
  };

  await client.upsertNote(note);
  expect(mockPool.query).toHaveBeenCalledTimes(1);
});
```

**Verify it fails:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

Expected: TypeScript compilation error — `chunk_index` does not exist on `NoteRow`.

### Task 1.2 — Implement: Add chunk_index to NoteRow

**File:** `src/lib/types.ts`

Add `chunk_index: number;` to the `NoteRow` interface, after `file_hash`:

```typescript
export interface NoteRow {
  id: string;
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  embedding: number[];
  file_hash: string;
  chunk_index: number;
}
```

**Verify it passes:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

### Task 1.3 — Fix: Add chunk_index to all existing NoteRow usages

The following files construct `NoteRow` objects and need `chunk_index: 0` added:

- `tests/lib/db-client.test.ts` — both `NoteRow` literals in the `upsertNote` describe
- `tests/watcher/vault-watcher.test.ts` — the `upsertArg` assertion in `handleFileChange`
- `src/watcher/vault-watcher.ts` — the `upsertNote` call in `handleFileChange`

**Verify all tests pass:**
```bash
npm test
```

---

## Phase 2: EmbeddingService.chunkText()

### Task 2.1 — Test: chunkText returns single chunk for short text

**File:** `tests/lib/embedding-service.test.ts`

Add a new `describe('chunkText', ...)` block after the existing `computeHash` describe:

```typescript
describe('chunkText', () => {
  it('should return single chunk for text within token limit', () => {
    const shortText = 'This is a short note.';
    const chunks = service.chunkText(shortText);

    expect(chunks).toEqual([shortText]);
    expect(chunks).toHaveLength(1);
  });
});
```

**Verify it fails:**
```bash
npx vitest run tests/lib/embedding-service.test.ts
```

Expected: `service.chunkText is not a function`.

### Task 2.2 — Test: chunkText returns multiple chunks for long text

**File:** `tests/lib/embedding-service.test.ts`

Inside the `chunkText` describe block, add:

```typescript
it('should split long text into multiple chunks', () => {
  // 6000 tokens ~ 24000 chars. Create text > 24000 chars.
  const paragraph = 'A'.repeat(5000) + '\n\n';
  const longText = paragraph.repeat(6); // 6 paragraphs x ~5002 chars = ~30012 chars (~7503 tokens)

  const chunks = service.chunkText(longText);

  expect(chunks.length).toBeGreaterThan(1);
  // All chunks should be non-empty
  for (const chunk of chunks) {
    expect(chunk.trim().length).toBeGreaterThan(0);
  }
});
```

### Task 2.3 — Test: chunkText respects paragraph boundaries

**File:** `tests/lib/embedding-service.test.ts`

```typescript
it('should split on paragraph boundaries (\\n\\n)', () => {
  // Each paragraph ~2500 tokens (10000 chars). Three paragraphs = 7500 tokens (exceeds 6000).
  const para = 'B'.repeat(10000);
  const text = `${para}\n\n${para}\n\n${para}`;

  const chunks = service.chunkText(text);

  expect(chunks.length).toBe(2);
});
```

### Task 2.4 — Test: chunkText adds overlap between consecutive chunks

**File:** `tests/lib/embedding-service.test.ts`

```typescript
it('should include overlap from previous chunk', () => {
  // Create 4 distinct paragraphs, each ~2000 tokens (8000 chars)
  const paraA = 'AAAA '.repeat(1600); // 8000 chars = ~2000 tokens
  const paraB = 'BBBB '.repeat(1600);
  const paraC = 'CCCC '.repeat(1600);
  const paraD = 'DDDD '.repeat(1600);
  const text = [paraA, paraB, paraC, paraD].join('\n\n');

  const chunks = service.chunkText(text);

  expect(chunks.length).toBeGreaterThanOrEqual(2);
  // The second chunk should contain content from the end of the first chunk (overlap)
  if (chunks.length >= 2) {
    expect(chunks[1]).toContain('CCCC');
  }
});
```

### Task 2.5 — Test: chunkText handles text without paragraph separators

**File:** `tests/lib/embedding-service.test.ts`

```typescript
it('should handle text without \\n\\n separators (single long paragraph)', () => {
  // Single paragraph > 6000 tokens. Must still return it.
  const longParagraph = 'X'.repeat(30000); // ~7500 tokens, no \n\n

  const chunks = service.chunkText(longParagraph);

  expect(chunks.length).toBeGreaterThanOrEqual(1);
  expect(chunks.join('')).toContain('X');
});
```

### Task 2.6 — Test: chunkText returns empty array for empty text

**File:** `tests/lib/embedding-service.test.ts`

```typescript
it('should return single empty chunk for empty text', () => {
  const chunks = service.chunkText('');
  expect(chunks).toEqual(['']);
});
```

### Task 2.7 — Implement: chunkText method

**File:** `src/lib/embedding-service.ts`

Add method to the `EmbeddingService` class:

```typescript
chunkText(text: string, maxTokens = 6000, overlapTokens = 200): string[] {
  const estimateTokens = (t: string): number => Math.ceil(t.length / 4);

  if (estimateTokens(text) <= maxTokens) {
    return [text];
  }

  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let currentParagraphs: string[] = [];
  let currentTokens = 0;
  let overlapParagraphs: string[] = [];

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (currentTokens + paraTokens > maxTokens && currentParagraphs.length > 0) {
      // Save current chunk
      chunks.push(currentParagraphs.join('\n\n'));

      // Build overlap: take paragraphs from end of current chunk
      overlapParagraphs = [];
      let overlapCount = 0;
      for (let i = currentParagraphs.length - 1; i >= 0; i--) {
        const pTokens = estimateTokens(currentParagraphs[i]);
        if (overlapCount + pTokens > overlapTokens) break;
        overlapParagraphs.unshift(currentParagraphs[i]);
        overlapCount += pTokens;
      }

      // Start new chunk with overlap
      currentParagraphs = [...overlapParagraphs, para];
      currentTokens = overlapCount + paraTokens;
    } else {
      currentParagraphs.push(para);
      currentTokens += paraTokens;
    }
  }

  // Flush remaining
  if (currentParagraphs.length > 0) {
    chunks.push(currentParagraphs.join('\n\n'));
  }

  return chunks.length > 0 ? chunks : [text];
}
```

**Verify all chunkText tests pass:**
```bash
npx vitest run tests/lib/embedding-service.test.ts
```

---

## Phase 3: DbClient Changes

### Task 3.1 — Test: upsertNote uses ON CONFLICT (file_path, chunk_index)

**File:** `tests/lib/db-client.test.ts`

Update the existing `'should INSERT with ON CONFLICT DO UPDATE'` test assertion from:

```typescript
expect(sql).toContain('ON CONFLICT (file_path) DO UPDATE');
```

to:

```typescript
expect(sql).toContain('ON CONFLICT (file_path, chunk_index) DO UPDATE');
```

Also verify `chunk_index` appears in SQL params.

**Verify it fails:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

Expected: `ON CONFLICT (file_path, chunk_index)` not found in SQL.

### Task 3.2 — Implement: Update upsertNote SQL

**File:** `src/lib/db-client.ts`

Update `upsertNote` method:

```typescript
async upsertNote(note: NoteRow): Promise<void> {
  const sql = `
    INSERT INTO vault_embeddings (id, file_path, title, content, tags, embedding, file_hash, chunk_index, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (file_path, chunk_index) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      tags = EXCLUDED.tags,
      embedding = EXCLUDED.embedding,
      file_hash = EXCLUDED.file_hash,
      updated_at = NOW()
  `;

  await this.pool.query(sql, [
    note.id,
    note.file_path,
    note.title,
    note.content,
    note.tags,
    JSON.stringify(note.embedding),
    note.file_hash,
    note.chunk_index,
  ]);
}
```

**Verify it passes:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

### Task 3.3 — Test: deleteChunksAbove deletes chunks above given index

**File:** `tests/lib/db-client.test.ts`

Add a new `describe('deleteChunksAbove', ...)` block:

```typescript
describe('deleteChunksAbove', () => {
  it('should DELETE chunks with chunk_index > maxChunkIndex for given file_path', async () => {
    mockPool.query.mockResolvedValue({ rowCount: 3 });

    await client.deleteChunksAbove('notes/large.md', 2);

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM vault_embeddings');
    expect(sql).toContain('file_path = $1');
    expect(sql).toContain('chunk_index > $2');
    expect(params).toEqual(['notes/large.md', 2]);
  });

  it('should propagate pool.query rejection', async () => {
    mockPool.query.mockRejectedValue(new Error('connection refused'));

    await expect(client.deleteChunksAbove('notes/test.md', 0)).rejects.toThrow(
      'connection refused',
    );
  });
});
```

**Verify it fails:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

Expected: `client.deleteChunksAbove is not a function`.

### Task 3.4 — Implement: deleteChunksAbove method

**File:** `src/lib/db-client.ts`

Add method to `DbClient` class:

```typescript
async deleteChunksAbove(filePath: string, maxChunkIndex: number): Promise<void> {
  const sql = 'DELETE FROM vault_embeddings WHERE file_path = $1 AND chunk_index > $2';
  await this.pool.query(sql, [filePath, maxChunkIndex]);
}
```

**Verify it passes:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

### Task 3.5 — Update getFileHash to use LIMIT 1

**File:** `tests/lib/db-client.test.ts`

In the existing `getFileHash` describe, update the `'should return hash string for known file'` test to also assert:

```typescript
expect(sql).toContain('LIMIT 1');
```

**Verify it fails**, then update `getFileHash` in `src/lib/db-client.ts`:

```typescript
async getFileHash(filePath: string): Promise<string | null> {
  const sql = 'SELECT file_hash FROM vault_embeddings WHERE file_path = $1 LIMIT 1';
  const result = await this.pool.query(sql, [filePath]);
  if (result.rows.length === 0) return null;
  return result.rows[0].file_hash;
}
```

**Verify it passes:**
```bash
npx vitest run tests/lib/db-client.test.ts
```

---

## Phase 4: VaultWatcher Multi-Chunk Pipeline

### Task 4.1 — Update mock factories

**File:** `tests/watcher/vault-watcher.test.ts`

Update `createMockEmbeddingService` to include `chunkText`:

```typescript
chunkText: vi.fn().mockReturnValue(['Some content']),
```

Update `createMockDbClient` to include `deleteChunksAbove`:

```typescript
deleteChunksAbove: vi.fn().mockResolvedValue(undefined),
```

**Verify existing tests still pass:**
```bash
npx vitest run tests/watcher/vault-watcher.test.ts
```

### Task 4.2 — Test: handleFileChange calls chunkText and upserts single chunk with chunk_index=0

**File:** `tests/watcher/vault-watcher.test.ts`

Update the existing `'should index a new file with correct data including UUID'` test to also verify:

```typescript
expect(mockEmbedding.chunkText).toHaveBeenCalledWith('Some content');
const upsertArg = mockDb.upsertNote.mock.calls[0][0];
expect(upsertArg.chunk_index).toBe(0);
expect(mockDb.deleteChunksAbove).toHaveBeenCalledWith('notes/my-note.md', 0);
```

**Verify it fails.**

### Task 4.3 — Test: handleFileChange with multi-chunk note

**File:** `tests/watcher/vault-watcher.test.ts`

```typescript
it('should generate embedding per chunk and upsert each with chunk_index', async () => {
  mockEmbedding.chunkText.mockReturnValue(['chunk zero', 'chunk one', 'chunk two']);
  const embeddings = [
    new Array(1536).fill(0.1),
    new Array(1536).fill(0.2),
    new Array(1536).fill(0.3),
  ];
  mockEmbedding.generateEmbedding
    .mockResolvedValueOnce(embeddings[0])
    .mockResolvedValueOnce(embeddings[1])
    .mockResolvedValueOnce(embeddings[2]);

  await watcher.handleFileChange(`${VAULT_PATH}/notes/large.md`, 'raw content');

  expect(mockEmbedding.generateEmbedding).toHaveBeenCalledTimes(3);
  expect(mockDb.upsertNote).toHaveBeenCalledTimes(3);
  expect(mockDb.upsertNote.mock.calls[0][0].chunk_index).toBe(0);
  expect(mockDb.upsertNote.mock.calls[1][0].chunk_index).toBe(1);
  expect(mockDb.upsertNote.mock.calls[2][0].chunk_index).toBe(2);
  expect(mockDb.upsertNote.mock.calls[0][0].content).toBe('chunk zero');
  expect(mockDb.upsertNote.mock.calls[1][0].content).toBe('chunk one');
  expect(mockDb.upsertNote.mock.calls[2][0].content).toBe('chunk two');
  expect(mockDb.deleteChunksAbove).toHaveBeenCalledWith('notes/large.md', 2);
});
```

### Task 4.4 — Test: handleFileChange cleans orphans when note shrinks

**File:** `tests/watcher/vault-watcher.test.ts`

```typescript
it('should delete orphan chunks when note shrinks', async () => {
  mockEmbedding.chunkText.mockReturnValue(['chunk A', 'chunk B']);

  await watcher.handleFileChange(`${VAULT_PATH}/notes/shrunk.md`, 'raw content');

  expect(mockDb.upsertNote).toHaveBeenCalledTimes(2);
  expect(mockDb.deleteChunksAbove).toHaveBeenCalledWith('notes/shrunk.md', 1);
});
```

### Task 4.5 — Implement: Update VaultWatcher.handleFileChange

**File:** `src/watcher/vault-watcher.ts`

Replace the `handleFileChange` method:

```typescript
async handleFileChange(filePath: string, content: string): Promise<void> {
  const relative = this.relativePath(filePath);
  const newHash = this.embeddingService.computeHash(content);
  const existingHash = await this.dbClient.getFileHash(relative);

  if (existingHash === newHash) return;

  try {
    const metadata = this.embeddingService.parseNote(content);
    const chunks = this.embeddingService.chunkText(metadata.content);

    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const embeddingText = [metadata.title, chunkContent]
        .filter(Boolean)
        .join('\n');
      const embedding = await this.embeddingService.generateEmbedding(embeddingText);

      await this.dbClient.upsertNote({
        id: randomUUID(),
        file_path: relative,
        title: metadata.title,
        content: chunkContent,
        tags: metadata.tags,
        embedding,
        file_hash: newHash,
        chunk_index: i,
      });
    }

    await this.dbClient.deleteChunksAbove(relative, chunks.length - 1);
  } catch (err) {
    console.error(`[VaultWatcher] Failed to index ${relative}:`, err);
  }
}
```

**Verify all tests pass:**
```bash
npm test
```

---

## Phase 5: SQL Migration Script

### Task 5.1 — Create migration script

**File:** `scripts/migrate-chunk-index.sql`

```sql
-- Migration: Add chunk_index column for text chunking support
-- Date: 2026-03-08
-- Run on VM: psql -U obsidian_brain -d open_brain -f scripts/migrate-chunk-index.sql

BEGIN;

ALTER TABLE vault_embeddings ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vault_embeddings DROP CONSTRAINT IF EXISTS vault_embeddings_file_path_key;
ALTER TABLE vault_embeddings ADD CONSTRAINT vault_embeddings_file_path_chunk_idx_key UNIQUE(file_path, chunk_index);

COMMIT;
```

---

## Phase 6: Verification

### Task 6.1 — Type check

```bash
npx tsc --noEmit
```

### Task 6.2 — Full test suite

```bash
npm test
```

### Task 6.3 — Update mcp-tools.test.ts mock if needed

**File:** `tests/mcp/mcp-tools.test.ts`

Add `deleteChunksAbove` to `createMockDbClient` if it references `DbClient` type.

---

## Deployment Steps (post-implementation)

1. SSH into VM
2. Run migration: `psql -U obsidian_brain -d open_brain -f scripts/migrate-chunk-index.sql`
3. Deploy new code: `git pull origin main && npm run build`
4. Restart watcher: `sudo systemctl restart obsidian-watcher`
5. Re-index vault: `npm run index-vault`
6. Verify the 5 previously-failed notes are now indexed
7. Reconnect MCP in Claude Code: `/mcp`

---

## Test Summary

| # | Test | File |
|---|------|------|
| 1 | NoteRow accepts chunk_index | `tests/lib/db-client.test.ts` |
| 2 | chunkText: short text → 1 chunk | `tests/lib/embedding-service.test.ts` |
| 3 | chunkText: long text → N chunks | `tests/lib/embedding-service.test.ts` |
| 4 | chunkText: paragraph boundaries | `tests/lib/embedding-service.test.ts` |
| 5 | chunkText: overlap between chunks | `tests/lib/embedding-service.test.ts` |
| 6 | chunkText: no \n\n separators | `tests/lib/embedding-service.test.ts` |
| 7 | chunkText: empty text | `tests/lib/embedding-service.test.ts` |
| 8 | upsertNote: ON CONFLICT (file_path, chunk_index) | `tests/lib/db-client.test.ts` |
| 9 | deleteChunksAbove: correct SQL | `tests/lib/db-client.test.ts` |
| 10 | deleteChunksAbove: propagates errors | `tests/lib/db-client.test.ts` |
| 11 | getFileHash: LIMIT 1 | `tests/lib/db-client.test.ts` |
| 12 | handleFileChange: single chunk with chunk_index=0 | `tests/watcher/vault-watcher.test.ts` |
| 13 | handleFileChange: multi-chunk upserts | `tests/watcher/vault-watcher.test.ts` |
| 14 | handleFileChange: orphan cleanup | `tests/watcher/vault-watcher.test.ts` |
