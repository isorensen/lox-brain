import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbClient, NOTE_DATE_PATTERN } from '../../src/lib/db-client.js';
import type { NoteRow } from '@lox-brain/shared';

describe('DbClient', () => {
  let client: DbClient;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    mockClient = { query: vi.fn(), release: vi.fn() };
    mockPool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    client = new DbClient(mockPool);
  });

  describe('ensureSchema', () => {
    it('probes information_schema and skips ALTER when created_by already exists', async () => {
      mockPool.query
        // information_schema read returns a row -> created_by already present
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        // read-only schema-currency check -> all owner-applied objects present
        .mockResolvedValueOnce({ rows: [{ metadata_cols: '2', tasks_table: '1', tasks_assigned_to: '1' }] });

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
        .mockResolvedValueOnce({ rows: [{ metadata_cols: '2', tasks_table: '1', tasks_assigned_to: '1' }] }); // currency check

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

    it('fails fast when the tasks.assigned_to column is missing', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // created_by present
        // metadata cols + tasks table present, but assigned_to not yet applied
        .mockResolvedValueOnce({ rows: [{ metadata_cols: '2', tasks_table: '1', tasks_assigned_to: '0' }] });

      await expect(client.ensureSchema()).rejects.toThrow(/assigned_to/i);
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
      // On conflict an existing attribution wins, but '' means "unattributed",
      // not "attributed to nobody" — the column is NOT NULL DEFAULT '', so a
      // plain COALESCE on the stored value can never fill it in later (#203).
      expect(sql).toContain(
        "COALESCE(NULLIF(vault_embeddings.created_by, ''), EXCLUDED.created_by)",
      );
    });

    // Regression (#203): created_by is NOT NULL DEFAULT ''. An explicit NULL does
    // not fall back to the column default, so sending null rejected every note
    // whose frontmatter carries no created_by — which is most of them.
    it('should pass empty string created_by when not provided', async () => {
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
      // created_by is $9 — assert by position: area/source_type are genuinely
      // nullable columns and legitimately stay null in this same param list.
      expect(params[8]).toBe('');
      expect(params[9]).toBeNull();
      expect(params[10]).toBeNull();
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

  describe('searchSemantic with sort', () => {
    it('should produce the exact same SQL for sort omitted and sort=similarity', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 0 });
      await client.searchSemantic([0.1], { limit: 5, offset: 0, sort: 'similarity' });

      const [defaultSql, defaultParams] = mockPool.query.mock.calls[0];
      const [explicitSql, explicitParams] = mockPool.query.mock.calls[1];
      expect(explicitSql).toBe(defaultSql);
      expect(explicitParams).toEqual(defaultParams);
      expect(defaultSql).not.toContain('candidates');
    });

    it('should rerank a similarity-selected candidate pool by note date when sort=recency', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 0, sort: 'recency' });

      const [sql] = mockPool.query.mock.calls[0];
      // Inner stage: still selects candidates by cosine distance.
      expect(sql).toContain('WITH candidates AS');
      expect(sql).toContain('ORDER BY embedding <=> $1::vector');
      // Outer stage: reorders that pool by the date the note declares,
      // falling back to index time only for notes that declare none.
      expect(sql).toContain('FROM candidates');
      expect(sql).toMatch(/ORDER BY COALESCE\(/);
      expect(sql).toContain('substring(file_path from');
      expect(sql).toContain("to_char(updated_at, 'YYYY-MM-DD')");
      expect(sql).toMatch(/DESC, updated_at DESC, similarity DESC/);
    });

    it('should never cast the extracted filename date to a date type', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 0, sort: 'recency' });

      // `to_date` raises 22008 on an impossible date, and a single
      // `2026-02-30 x.md` in the vault would take down every recency search.
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('to_date');
      expect(sql).not.toMatch(/::\s*date/);
    });

    it('should compare note dates under the C collation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 0, sort: 'recency' });

      // Text ordering only equals date ordering if the database collation does
      // not reweight the digits and hyphens.
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('COLLATE "C"');
    });

    it('should only admit a plausible calendar date from the last path segment', () => {
      // Postgres ARE and JS agree on every construct this pattern uses
      // (`\d`, `(?:a|b)`, character classes, `$`), so JS can stand in here for
      // the engine that actually runs it.
      const pattern = new RegExp(NOTE_DATE_PATTERN);
      const dateOf = (filePath: string) => filePath.match(pattern)?.[1];

      expect(dateOf('Meetings/2026-08-03 Weekly Meeting.md')).toBe('2026-08-03');
      expect(dateOf('Meetings/Weekly Meeting 2026-08-03.md')).toBe('2026-08-03');
      // A dated folder is not the note's own date.
      expect(dateOf('Journal/2026-08-03/notes.md')).toBeUndefined();
      // The note's own date wins over a dated folder above it.
      expect(dateOf('2026-01-01 Planning/2026-08-03 Weekly.md')).toBe('2026-08-03');
      // Impossible months and days never reach the sort key.
      expect(dateOf('Meetings/2026-13-45 x.md')).toBeUndefined();
      expect(dateOf('Meetings/9999-99-99 x.md')).toBeUndefined();
      expect(dateOf('Meetings/2026-00-00 x.md')).toBeUndefined();
      // Unpadded and unseparated forms are not the vault convention.
      expect(dateOf('Meetings/2026-8-3 x.md')).toBeUndefined();
      expect(dateOf('Meetings/20260803 x.md')).toBeUndefined();
      expect(dateOf('Meetings/no date here.md')).toBeUndefined();
    });

    it('should size the candidate pool from limit+offset with a floor of 100', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 0, sort: 'recency' });
      const [, smallParams] = mockPool.query.mock.calls[0];
      expect(smallParams).toContain(100);

      await client.searchSemantic([0.1], { limit: 50, offset: 200, sort: 'recency' });
      const [, largeParams] = mockPool.query.mock.calls[1];
      expect(largeParams).toContain(2500);
    });

    it('should pass the candidate pool size as a bound parameter, never inlined', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, offset: 0, sort: 'recency' });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('LIMIT 100');
      expect(sql).toMatch(/LIMIT \$\d+/);
    });

    it('should count all filter-matched rows inside the pool CTE, not the pool itself', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'id1', file_path: 'a.md', title: 'A', content: null, tags: [],
          similarity: 0.9, updated_at: new Date(), total_count: '4711',
        }],
      });

      const result = await client.searchSemantic([0.1], { limit: 5, sort: 'recency' });

      // COUNT(*) OVER() must sit in the CTE, where window functions are
      // evaluated before its LIMIT, so it reports the real match count.
      const [sql] = mockPool.query.mock.calls[0];
      const cteBody = sql.slice(sql.indexOf('WITH candidates AS'), sql.indexOf('FROM candidates'));
      expect(cteBody).toContain('COUNT(*) OVER() AS total_count');
      expect(result.total).toBe(4711);
    });

    it('should keep metadata filters inside the candidate pool', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, sort: 'recency', area: 'work', source_type: 'meeting' });

      const [sql, params] = mockPool.query.mock.calls[0];
      const cteBody = sql.slice(0, sql.indexOf('FROM candidates'));
      expect(cteBody).toContain('WHERE area = $2 AND source_type = $3');
      expect(params).toEqual([JSON.stringify([0.1]), 'work', 'meeting', 100, 5, 0]);
    });

    it('should honour includeContent in recency mode', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await client.searchSemantic([0.1], { limit: 5, sort: 'recency', includeContent: true, contentPreviewLength: 200 });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('LEFT(content, $2) AS content');
    });

    it('should reject a sort value outside the two literals without querying', async () => {
      await expect(
        client.searchSemantic([0.1], { limit: 5, sort: 'updated_at DESC --' as never }),
      ).rejects.toThrow(/sort must be 'similarity' or 'recency'/);
      expect(mockPool.query).not.toHaveBeenCalled();
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
    const named = (name: string, lists: number | null, rowCount: number) => ({
      indexname: name,
      database: 'lox_brain',
      indexdef: lists === null
        ? `CREATE INDEX ${name} ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops)`
        : `CREATE INDEX ${name} ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists='${lists}')`,
      row_count: String(rowCount),
    });
    const indexRow = (lists: number | null, rowCount: number) => named('idx_embedding', lists, rowCount);

    /** Statements issued on the pool after the catalog lookup. */
    const poolStatements = () => mockPool.query.mock.calls.slice(1).map((c: any[]) => c[0]);

    it('should reindex in place when the current lists is within the hysteresis band', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [indexRow(1, 812)] })
        .mockResolvedValue({ rowCount: 0 });

      const state = await client.reindexEmbeddings();

      expect(mockPool.query.mock.calls[0][0]).toContain('pg_indexes');
      expect(poolStatements()).toEqual([
        'REINDEX INDEX "idx_embedding"',
        'ALTER DATABASE "lox_brain" SET ivfflat.probes = 1',
        'SET ivfflat.probes = 1',
      ]);
      expect(mockClient.query).not.toHaveBeenCalled();
      expect(state).toEqual({
        rows: 812,
        indexes: [{ name: 'idx_embedding', listsBefore: 1, listsAfter: 1, resized: false }],
        probes: 1,
        probesApplied: true,
      });
    });

    it('should recreate the index when lists is oversized for the row count', async () => {
      // The production bug: 812 rows indexed with lists=100.
      mockPool.query.mockResolvedValueOnce({ rows: [indexRow(100, 812)] }).mockResolvedValue({ rowCount: 0 });
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const state = await client.reindexEmbeddings();

      expect(mockClient.query.mock.calls.map((c: any[]) => c[0])).toEqual([
        'BEGIN',
        'DROP INDEX "idx_embedding"',
        'CREATE INDEX idx_embedding ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1)',
        'COMMIT',
      ]);
      expect(mockClient.release).toHaveBeenCalled();
      expect(state).toEqual({
        rows: 812,
        indexes: [{ name: 'idx_embedding', listsBefore: 100, listsAfter: 1, resized: true }],
        probes: 1,
        probesApplied: true,
      });
    });

    it('should resize EVERY ivfflat index, not just the first one found', async () => {
      // Exactly the deployed VM: schema.sql and the installer each created an
      // ivfflat index over `embedding` under a different name. v0.18.0 took
      // `LIMIT 1`, resized whichever came back, and left the one the planner
      // actually used at lists=100 — reporting success the whole time.
      mockPool.query
        .mockResolvedValueOnce({
          rows: [named('idx_embedding_cosine', 1, 812), named('idx_vault_embeddings_embedding', 100, 812)],
        })
        .mockResolvedValue({ rowCount: 0 });
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const state = await client.reindexEmbeddings();

      // A mock returns both rows no matter what the SQL says, so the catalog
      // query is asserted directly: `LIMIT 1` is the defect itself, and the
      // ordering is what makes the reported list deterministic.
      const catalogSql = mockPool.query.mock.calls[0][0];
      expect(catalogSql).not.toMatch(/LIMIT\s+1/i);
      expect(catalogSql).toMatch(/ORDER BY\s+indexname/i);

      expect(state!.indexes).toEqual([
        { name: 'idx_embedding_cosine', listsBefore: 1, listsAfter: 1, resized: false },
        { name: 'idx_vault_embeddings_embedding', listsBefore: 100, listsAfter: 1, resized: true },
      ]);
      // The already-correct one is reindexed in place; the oversized one rebuilt.
      expect(poolStatements()).toEqual([
        'REINDEX INDEX "idx_embedding_cosine"',
        'ALTER DATABASE "lox_brain" SET ivfflat.probes = 1',
        'SET ivfflat.probes = 1',
      ]);
      expect(mockClient.query.mock.calls.map((c: any[]) => c[0])).toEqual([
        'BEGIN',
        'DROP INDEX "idx_vault_embeddings_embedding"',
        'CREATE INDEX idx_vault_embeddings_embedding ON public.vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1)',
        'COMMIT',
      ]);
    });

    it('should derive probes from the widest index when they end up disagreeing', async () => {
      // 60k rows -> target 60. An index at 100 is inside the hysteresis band
      // (100/60 < 2) so it keeps lists=100, while one at 1 is rebuilt to 60.
      // probes must serve whichever the planner picks: ceil(sqrt(100)) = 10,
      // not ceil(sqrt(60)) = 8. Under-probing is the silent failure.
      mockPool.query
        .mockResolvedValueOnce({ rows: [named('a_wide', 100, 60_000), named('b_narrow', 1, 60_000)] })
        .mockResolvedValue({ rowCount: 0 });
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const state = await client.reindexEmbeddings();

      expect(state!.indexes.map((i) => i.listsAfter)).toEqual([100, 60]);
      expect(state!.probes).toBe(10);
      expect(poolStatements()).toContain('ALTER DATABASE "lox_brain" SET ivfflat.probes = 10');
    });

    it('should grow lists and probes together as the vault grows', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [indexRow(1, 40_000)] }).mockResolvedValue({ rowCount: 0 });
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const state = await client.reindexEmbeddings();

      expect(mockClient.query.mock.calls[2][0]).toContain('WITH (lists = 40)');
      expect(poolStatements()).toEqual([
        'ALTER DATABASE "lox_brain" SET ivfflat.probes = 7',
        'SET ivfflat.probes = 7',
      ]);
      expect(state).toMatchObject({ probes: 7, indexes: [{ listsAfter: 40, resized: true }] });
    });

    it('should assume pgvector\'s default lists when the index carries no reloption', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [indexRow(null, 812)] }).mockResolvedValue({ rowCount: 0 });
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const state = await client.reindexEmbeddings();

      expect(mockClient.query.mock.calls[2][0]).toMatch(/WITH \(lists = 1\)$/);
      expect(state).toMatchObject({ indexes: [{ listsBefore: 100, resized: true }] });
    });

    it('should roll back and rethrow when the rebuild fails', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [indexRow(100, 812)] }).mockResolvedValue({ rowCount: 0 });
      mockClient.query.mockImplementation((sql: string) =>
        sql.startsWith('CREATE INDEX')
          ? Promise.reject(new Error('out of memory'))
          : Promise.resolve({ rowCount: 0 }));

      await expect(client.reindexEmbeddings()).rejects.toThrow('out of memory');
      expect(mockClient.query.mock.calls.map((c: any[]) => c[0])).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should report, not throw, when the role does not own the database', async () => {
      // `ALTER DATABASE` needs database ownership; the index rebuild needs only
      // table ownership. A role holding the latter must not lose the resize.
      mockPool.query
        .mockResolvedValueOnce({ rows: [indexRow(1, 812)] })
        .mockImplementation((sql: string) =>
          sql.startsWith('ALTER DATABASE')
            ? Promise.reject(new Error('must be owner of database lox_brain'))
            : Promise.resolve({ rowCount: 0 }));

      const state = await client.reindexEmbeddings();

      expect(state).toMatchObject({ probesApplied: false });
      // The session-level SET is pointless once the durable one failed.
      expect(poolStatements()).not.toContain('SET ivfflat.probes = 1');
    });

    it('should skip reindex when no ivfflat index exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      expect(await client.reindexEmbeddings()).toBeNull();
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

    it('addTask includes assigned_to in the INSERT when provided', async () => {
      const row = { id: 'u1', title: 'Review PR', assigned_to: 'matheus' };
      mockPool.query.mockResolvedValue({ rows: [row] });

      await client.addTask({ title: 'Review PR', assigned_to: 'matheus' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('assigned_to');
      expect(params).toContain('matheus');
    });

    it('addTask passes null assigned_to when not provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'u1', title: 'Solo task' }] });

      await client.addTask({ title: 'Solo task' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('assigned_to');
      expect(params).toContain(null);
    });

    it('listTasks filters by assigned_to when provided', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a' }] });

      await client.listTasks({ assigned_to: 'eduardo' });

      const [countSql, countParams] = mockPool.query.mock.calls[0];
      expect(countSql).toContain('assigned_to = $');
      expect(countParams).toContain('eduardo');
    });

    it('updateTask reassigns assigned_to', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'u1', assigned_to: 'igor' }] });

      await client.updateTask('550e8400-e29b-41d4-a716-446655440000', { assigned_to: 'igor' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('assigned_to = $');
      expect(params).toContain('igor');
    });

    it('updateTask clears assigned_to when passed null (unassign)', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'u1', assigned_to: null }] });

      await client.updateTask('550e8400-e29b-41d4-a716-446655440000', { assigned_to: null });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('assigned_to = $');
      expect(params).toContain(null);
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
