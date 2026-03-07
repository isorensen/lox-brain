import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbClient } from '../../src/lib/db-client.js';
import type { NoteRow } from '../../src/lib/types.js';

describe('DbClient', () => {
  let client: DbClient;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    };
    client = new DbClient(mockPool);
  });

  describe('upsertNote', () => {
    it('should INSERT with ON CONFLICT DO UPDATE', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const note: NoteRow = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        file_path: 'notes/test.md',
        title: 'Test Note',
        content: 'Test content',
        tags: ['tag1', 'tag2'],
        embedding: Array.from({ length: 1536 }, () => 0.1),
        file_hash: 'abc123hash',
      };

      await client.upsertNote(note);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vault_embeddings');
      expect(sql).toContain('ON CONFLICT (file_path) DO UPDATE');
      expect(params).toContain(note.id);
      expect(params).toContain(note.file_path);
      expect(params).toContain(note.title);
      expect(params).toContain(note.content);
      expect(params).toContain(note.file_hash);

      // Embedding must be passed as JSON string, not raw array
      const embeddingParam = params[5];
      expect(typeof embeddingParam).toBe('string');
      expect(embeddingParam).toBe(JSON.stringify(note.embedding));
    });

    it('should propagate pool.query rejection', async () => {
      mockPool.query.mockRejectedValue(new Error('connection refused'));

      const note: NoteRow = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        file_path: 'notes/test.md',
        title: 'Test Note',
        content: 'Test content',
        tags: ['tag1'],
        embedding: [0.1, 0.2],
        file_hash: 'abc123hash',
      };

      await expect(client.upsertNote(note)).rejects.toThrow('connection refused');
    });
  });

  describe('deleteNote', () => {
    it('should DELETE by file_path with parameterized query', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      await client.deleteNote('notes/test.md');

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('DELETE FROM vault_embeddings');
      expect(sql).toContain('$1');
      expect(params).toEqual(['notes/test.md']);
    });
  });

  describe('searchSemantic', () => {
    it('should query with cosine distance and return similarity', async () => {
      const fakeRows = [
        {
          id: 'id1',
          file_path: 'notes/a.md',
          title: 'Note A',
          content: 'Content A',
          tags: ['tag1'],
          similarity: 0.92,
          updated_at: new Date('2026-03-07'),
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const embedding = Array.from({ length: 1536 }, () => 0.1);
      const results = await client.searchSemantic(embedding, 5);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('1 - (embedding <=>');
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('LIMIT');
      expect(params[1]).toBe(5);
      expect(results).toEqual(fakeRows);

      // Embedding must be passed as JSON string
      expect(typeof params[0]).toBe('string');
      expect(params[0]).toBe(JSON.stringify(embedding));
    });

    it('should throw RangeError when limit is zero or negative', async () => {
      await expect(() => client.searchSemantic([], 0)).rejects.toThrow(RangeError);
      await expect(() => client.searchSemantic([], -1)).rejects.toThrow(RangeError);
    });
  });

  describe('getFileHash', () => {
    it('should return hash string for known file', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ file_hash: 'abc123hash' }],
      });

      const hash = await client.getFileHash('notes/test.md');

      expect(hash).toBe('abc123hash');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('file_hash');
      expect(sql).toContain('$1');
      expect(params).toEqual(['notes/test.md']);
    });

    it('should return null for unknown file', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const hash = await client.getFileHash('notes/unknown.md');

      expect(hash).toBeNull();
    });
  });

  describe('listRecent', () => {
    it('should ORDER BY updated_at DESC with LIMIT', async () => {
      const fakeRows = [
        {
          id: 'id1',
          file_path: 'notes/recent.md',
          title: 'Recent',
          content: 'Content',
          tags: [],
          updated_at: new Date('2026-03-07'),
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const results = await client.listRecent(10);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ORDER BY updated_at DESC');
      expect(sql).toContain('LIMIT');
      expect(params).toEqual([10]);
      expect(results).toEqual(fakeRows);
    });

    it('should throw RangeError when limit is zero or negative', async () => {
      await expect(() => client.listRecent(0)).rejects.toThrow(RangeError);
      await expect(() => client.listRecent(-5)).rejects.toThrow(RangeError);
    });
  });

  describe('searchText', () => {
    it('should use ILIKE and tags @> filter with parameterized query', async () => {
      const fakeRows = [
        {
          id: 'id1',
          file_path: 'notes/match.md',
          title: 'Match',
          content: 'Matching content',
          tags: ['tag1'],
          updated_at: new Date('2026-03-07'),
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const results = await client.searchText('matching', ['tag1']);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ILIKE');
      expect(sql).toContain('tags @>');
      expect(sql).toContain('LIMIT 50');
      expect(params[0]).toBe('%matching%');
      expect(results).toEqual(fakeRows);
    });

    it('should search without tags filter when tags not provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchText('query');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ILIKE');
      expect(sql).not.toContain('tags @>');
      expect(sql).toContain('LIMIT 50');
      expect(params[0]).toBe('%query%');
    });
  });
});
