import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbClient } from '../../src/lib/db-client.js';
import type { NoteRow } from '@lox-brain/shared';

describe('DbClient', () => {
  let client: DbClient;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    };
    client = new DbClient(mockPool);
  });

  describe('ensureSchema', () => {
    it('probes information_schema and skips ALTER when created_by already exists', async () => {
      mockPool.query
        // information_schema read returns a row -> created_by already present
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        // read-only schema-currency check -> all owner-applied objects present
        .mockResolvedValueOnce({ rows: [{ metadata_cols: '2', tasks_table: '1' }] });

      await client.ensureSchema();

      // The created_by probe must not issue an ALTER on the no-owner path
      // (issue #169); the only other query is the read-only currency check.
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [probeSql] = mockPool.query.mock.calls[0];
      expect(probeSql).toContain('information_schema.columns');
      expect(probeSql).toContain("table_name = 'vault_embeddings'");
      expect(probeSql).toContain("column_name = 'created_by'");
      expect(probeSql).not.toContain('ALTER TABLE');
      const [checkSql] = mockPool.query.mock.calls[1];
      expect(checkSql).toContain('information_schema');
      expect(checkSql).not.toContain('ALTER TABLE');
      expect(checkSql).not.toContain('CREATE');
    });

    it('issues ALTER TABLE ADD COLUMN when created_by is missing', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // probe -> missing
        .mockResolvedValueOnce({ rowCount: 0 }) // ALTER
        .mockResolvedValueOnce({ rows: [{ metadata_cols: '2', tasks_table: '1' }] }); // currency check

      await client.ensureSchema();

      expect(mockPool.query).toHaveBeenCalledTimes(3);
      const [alterSql] = mockPool.query.mock.calls[1];
      expect(alterSql).toContain('ALTER TABLE vault_embeddings');
      expect(alterSql).toContain('ADD COLUMN IF NOT EXISTS created_by');
      expect(alterSql).toContain('TEXT');
      expect(alterSql).toContain("DEFAULT ''");
    });

    it('fails fast with an actionable message when the owner-applied schema is stale', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // created_by present
        .mockResolvedValueOnce({ rows: [{ metadata_cols: '0', tasks_table: '0' }] }); // stale

      await expect(client.ensureSchema()).rejects.toThrow(/schema is out of date/i);
    });

    it('propagates pool.query rejection from the probe', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('permission denied'));

      await expect(client.ensureSchema()).rejects.toThrow('permission denied');
    });

    it('propagates ALTER TABLE rejection when probe returns empty', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('42501: must be owner of table'));

      await expect(client.ensureSchema()).rejects.toThrow('42501');
    });
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
        chunk_index: 0,
      };

      await client.upsertNote(note);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vault_embeddings');
      expect(sql).toContain('ON CONFLICT (file_path, chunk_index) DO UPDATE');
      expect(params).toContain(note.id);
      expect(params).toContain(note.file_path);
      expect(params).toContain(note.title);
      expect(params).toContain(note.content);
      expect(params).toContain(note.file_hash);
      expect(params).toContain(note.chunk_index);

      // Embedding must be passed as JSON string, not raw array
      const embeddingParam = params[5];
      expect(typeof embeddingParam).toBe('string');
      expect(embeddingParam).toBe(JSON.stringify(note.embedding));
    });

    it('should include created_by in INSERT and preserve it on conflict', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const note: NoteRow = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        file_path: 'notes/team-note.md',
        title: 'Team Note',
        content: 'Written by eduardo',
        tags: ['team'],
        embedding: [0.1, 0.2],
        file_hash: 'hash456',
        chunk_index: 0,
        created_by: 'eduardo',
      };

      await client.upsertNote(note);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by');
      expect(params).toContain('eduardo');
      // On conflict, created_by should NOT be overwritten (preserve original over incoming)
      expect(sql).toContain('COALESCE(vault_embeddings.created_by, EXCLUDED.created_by)');
    });

    it('should pass null created_by when not provided', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const note: NoteRow = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        file_path: 'notes/personal.md',
        title: 'Personal Note',
        content: 'No author',
        tags: [],
        embedding: [0.1],
        file_hash: 'hash789',
        chunk_index: 0,
      };

      await client.upsertNote(note);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by');
      expect(params).toContain(null);
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
        chunk_index: 0,
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
    it('should query with cosine distance and return PaginatedResult', async () => {
      const fakeRows = [
        {
          id: 'id1',
          file_path: 'notes/a.md',
          title: 'Note A',
          content: null,
          tags: ['tag1'],
          similarity: 0.92,
          updated_at: new Date('2026-03-07'),
          total_count: '1',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const embedding = Array.from({ length: 1536 }, () => 0.1);
      const result = await client.searchSemantic(embedding, 5);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('1 - (embedding <=>');
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      expect(sql).toContain('COUNT(*) OVER()');

      // Embedding must be passed as JSON string
      expect(typeof params[0]).toBe('string');
      expect(params[0]).toBe(JSON.stringify(embedding));

      // Should return PaginatedResult
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('offset');
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });

    it('should throw RangeError when limit is zero or negative', async () => {
      await expect(() => client.searchSemantic([], 0)).rejects.toThrow(RangeError);
      await expect(() => client.searchSemantic([], -1)).rejects.toThrow(RangeError);
    });

    it('should SELECT created_by in semantic search results', async () => {
      const fakeRows = [
        {
          id: 'id1', file_path: 'notes/a.md', title: 'Note A', content: null,
          tags: ['tag1'], similarity: 0.92, updated_at: new Date('2026-03-07'),
          created_by: 'eduardo', total_count: '1',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });
      const result = await client.searchSemantic([0.1], { limit: 5 });
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by');
      expect(result.results[0].created_by).toBe('eduardo');
    });
  });

  describe('searchSemantic with SearchOptions', () => {
    it('should accept SearchOptions object', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const embedding = [0.1, 0.2];
      await client.searchSemantic(embedding, { limit: 3, offset: 0, includeContent: false, contentPreviewLength: 0 });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('OFFSET');
      expect(sql).toContain('NULL AS content');
    });

    it('should exclude content when includeContent is false', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { includeContent: false });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('NULL AS content');
      expect(sql).not.toMatch(/(?<!NULL AS )content,/);
    });

    it('should truncate content when contentPreviewLength > 0 and includeContent is true', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { includeContent: true, contentPreviewLength: 200 });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('LEFT(content,');
    });

    it('should return full content when contentPreviewLength is 0 and includeContent is true', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { includeContent: true, contentPreviewLength: 0 });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('NULL AS content');
      expect(sql).not.toContain('LEFT(content,');
    });

    it('should maintain backward compatibility with numeric limit', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await client.searchSemantic([0.1], 5);

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });

    it('should support offset for pagination', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 10 });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('OFFSET');
      // offset should be in the params
      expect(params).toContain(10);
    });

    it('should return PaginatedResult with total count', async () => {
      const fakeRows = [
        {
          id: 'id1', file_path: 'a.md', title: 'A', content: null,
          tags: [], similarity: 0.9, updated_at: new Date(), total_count: '42',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const result = await client.searchSemantic([0.1], { limit: 5, offset: 0 });

      expect(result.total).toBe(42);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).not.toHaveProperty('total_count');
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
      expect(sql).toContain('LIMIT 1');
      expect(params).toEqual(['notes/test.md']);
    });

    it('should return null for unknown file', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const hash = await client.getFileHash('notes/unknown.md');

      expect(hash).toBeNull();
    });
  });

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
      await expect(client.deleteChunksAbove('notes/test.md', 0)).rejects.toThrow('connection refused');
    });
  });

  describe('listRecent', () => {
    it('should ORDER BY updated_at DESC with LIMIT and return PaginatedResult', async () => {
      const fakeRows = [
        {
          id: 'id1',
          file_path: 'notes/recent.md',
          title: 'Recent',
          content: null,
          tags: [],
          updated_at: new Date('2026-03-07'),
          total_count: '1',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const result = await client.listRecent(10);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ORDER BY updated_at DESC');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result.limit).toBe(10);
    });

    it('should throw RangeError when limit is zero or negative', async () => {
      await expect(() => client.listRecent(0)).rejects.toThrow(RangeError);
      await expect(() => client.listRecent(-5)).rejects.toThrow(RangeError);
    });

    it('should SELECT created_by in recent notes', async () => {
      const fakeRows = [
        {
          id: 'id1', file_path: 'notes/c.md', title: 'Note C', content: null,
          tags: [], updated_at: new Date(), created_by: 'igor', total_count: '1',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });
      const result = await client.listRecent(5);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by');
      expect(result.results[0].created_by).toBe('igor');
    });
  });

  describe('listRecent with SearchOptions', () => {
    it('should accept SearchOptions object', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.listRecent({ limit: 5, offset: 10, includeContent: true, contentPreviewLength: 100 });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('OFFSET');
      expect(sql).toContain('LEFT(content,');
    });

    it('should maintain backward compatibility with numeric limit', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await client.listRecent(10);

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result.limit).toBe(10);
    });
  });

  describe('searchText', () => {
    it('should use tsvector with Portuguese and English stemming and tags filter', async () => {
      const fakeRows = [
        {
          id: 'id1',
          file_path: 'notes/match.md',
          title: 'Match',
          content: null,
          tags: ['tag1'],
          updated_at: new Date('2026-03-07'),
          rank: 0.5,
          total_count: '1',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const result = await client.searchText('matching', ['tag1']);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector('portuguese', content)");
      expect(sql).toContain("to_tsvector('english', content)");
      expect(sql).toContain('ts_rank');
      expect(sql).toContain('GREATEST');
      expect(sql).toContain('tags @>');
      expect(sql).toContain('ORDER BY rank DESC');
      expect(params[0]).toBe('matching');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
    });

    it('should search without tags filter when tags not provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchText('query');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector('portuguese', content)");
      expect(sql).toContain("to_tsvector('english', content)");
      expect(sql).not.toContain('tags @>');
      expect(params[0]).toBe('query');
    });

    it('keeps an ILIKE fallback so substring/prefix queries still match', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      // plainto_tsquery only matches whole stemmed words, so "cach" would no
      // longer find "caching". The ILIKE branch preserves the substring recall
      // the previous implementation had, while tsvector adds stemming/ranking.
      await client.searchText('cach');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('content ILIKE');
      expect(sql).toContain('ORDER BY rank DESC, updated_at DESC');
      // single bound param reused across both tsquery and ILIKE branches
      expect(params[0]).toBe('cach');
    });

    it('should SELECT created_by in text search results', async () => {
      const fakeRows = [
        {
          id: 'id1', file_path: 'notes/b.md', title: 'Note B', content: null,
          tags: [], updated_at: new Date(), created_by: 'matheus', total_count: '1',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });
      const result = await client.searchText('query');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by');
      expect(result.results[0].created_by).toBe('matheus');
    });

    it('should default limit to 20', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchText('query');

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('LIMIT');
      // Verify the limit param is 20
      const [, params] = mockPool.query.mock.calls[0];
      // Last numeric param before offset should be 20
      expect(params).toContain(20);
    });
  });

  describe('searchByAuthor', () => {
    it('should filter by created_by with parameterized query', async () => {
      const fakeRows = [{
        id: 'id1', file_path: 'notes/team.md', title: 'Team Note',
        content: null, tags: ['meeting'], updated_at: new Date(),
        created_by: 'eduardo', total_count: '1',
      }];
      mockPool.query.mockResolvedValue({ rows: fakeRows });
      const result = await client.searchByAuthor('eduardo');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by = ');
      expect(params).toContain('eduardo');
      expect(result.results[0].created_by).toBe('eduardo');
    });

    it('should support text query combined with author filter', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await client.searchByAuthor('eduardo', 'meeting');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('created_by = ');
      expect(sql).toContain('ILIKE');
      expect(params).toContain('eduardo');
      expect(params).toContain('%meeting%');
    });

    it('should return PaginatedResult', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await client.searchByAuthor('eduardo');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('offset');
    });
  });

  describe('reindexEmbeddings', () => {
    it('should look up ivfflat index name and reindex it', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ indexname: 'idx_embedding' }] })
        .mockResolvedValueOnce({ rowCount: 0 });

      await client.reindexEmbeddings();

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query.mock.calls[0][0]).toContain('pg_indexes');
      expect(mockPool.query.mock.calls[1][0]).toBe('REINDEX INDEX idx_embedding');
    });

    it('should skip reindex when no ivfflat index exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await client.reindexEmbeddings();

      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should propagate pool.query rejection', async () => {
      mockPool.query.mockRejectedValue(new Error('permission denied'));
      await expect(client.reindexEmbeddings()).rejects.toThrow('permission denied');
    });
  });

  describe('searchText with SearchOptions', () => {
    it('should accept SearchOptions as third parameter', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchText('hello', undefined, { limit: 15, offset: 5, includeContent: true, contentPreviewLength: 100 });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('OFFSET');
      expect(sql).toContain('LEFT(content,');
    });

    it('should support pagination with offset', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchText('hello', undefined, { offset: 10 });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('OFFSET');
      expect(params).toContain(10);
    });

    it('should return PaginatedResult with total count', async () => {
      const fakeRows = [
        {
          id: 'id1', file_path: 'a.md', title: 'A', content: null,
          tags: [], updated_at: new Date(), total_count: '25',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: fakeRows });

      const result = await client.searchText('hello');

      expect(result.total).toBe(25);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).not.toHaveProperty('total_count');
    });
  });

  describe('tasks', () => {
    it('addTask inserts with parameterized values and returns the row', async () => {
      const row = { id: 'u1', title: 'Write tests', status: 'pending', priority: 'high' };
      mockPool.query.mockResolvedValue({ rows: [row] });

      const result = await client.addTask({ title: 'Write tests', priority: 'high' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO tasks');
      expect(sql).toContain('RETURNING *');
      expect(params[0]).toBe('Write tests');
      expect(params).toContain('high');
      expect(result).toEqual(row);
    });

    it('listTasks defaults to pending status and orders by priority then due date', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }] });

      const result = await client.listTasks();

      const [countSql, countParams] = mockPool.query.mock.calls[0];
      const [listSql] = mockPool.query.mock.calls[1];
      expect(countSql).toContain('SELECT COUNT(*)');
      expect(countParams).toContain('pending');
      expect(listSql).toContain('ORDER BY');
      expect(result.total).toBe(2);
      expect(result.results).toHaveLength(2);
    });

    it('updateTask sets completed_at when status becomes done', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'u1', status: 'done' }] });

      await client.updateTask('550e8400-e29b-41d4-a716-446655440000', { status: 'done' });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $');
      expect(sql).toContain('completed_at = NOW()');
    });

    it('updateTask returns null and issues no query when there is nothing to update', async () => {
      const result = await client.updateTask('550e8400-e29b-41d4-a716-446655440000', {});

      expect(result).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('completeTask matches by id when given a UUID', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockPool.query.mockResolvedValue({ rows: [{ id: uuid, status: 'done' }] });

      const result = await client.completeTask(uuid);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([uuid]);
      expect(result?.status).toBe('done');
    });

    it('completeTask falls back to title match without throwing on non-UUID input', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'x', status: 'done' }] });

      const result = await client.completeTask('buy milk');

      // Only the title query runs — the `WHERE id = $1` lookup (which would
      // raise 22P02 for a non-UUID) is skipped entirely.
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('title ILIKE $1');
      expect(params).toEqual(['%buy milk%']);
      expect(result?.status).toBe('done');
    });
  });
});
