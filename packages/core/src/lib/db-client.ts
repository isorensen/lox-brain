import type { Pool } from 'pg';
import type { NoteRow, SearchResult, RecentNote, SearchOptions, PaginatedResult } from '@lox-brain/shared';

const SEMANTIC_DEFAULTS: SearchOptions = {
  limit: 5,
  offset: 0,
  includeContent: false,
  contentPreviewLength: 300,
};

const TEXT_DEFAULTS: SearchOptions = {
  limit: 20,
  offset: 0,
  includeContent: false,
  contentPreviewLength: 300,
};

const RECENT_DEFAULTS: SearchOptions = {
  limit: 10,
  offset: 0,
  includeContent: false,
  contentPreviewLength: 300,
};

export class DbClient {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private buildSearchOptions(
    limitOrOptions: number | Partial<SearchOptions> | undefined,
    defaults: SearchOptions,
  ): SearchOptions {
    if (typeof limitOrOptions === 'number') {
      return { ...defaults, limit: limitOrOptions };
    }
    return { ...defaults, ...limitOrOptions };
  }

  /**
   * Builds the SQL content column expression based on search options.
   * Returns the SQL fragment and any parameter values needed.
   */
  private buildContentColumn(
    opts: SearchOptions,
    paramIndex: number,
  ): { sql: string; params: unknown[]; nextParamIndex: number } {
    if (!opts.includeContent) {
      return { sql: 'NULL AS content', params: [], nextParamIndex: paramIndex };
    }
    if (opts.contentPreviewLength > 0) {
      return {
        sql: `LEFT(content, $${paramIndex}) AS content`,
        params: [opts.contentPreviewLength],
        nextParamIndex: paramIndex + 1,
      };
    }
    return { sql: 'content', params: [], nextParamIndex: paramIndex };
  }

  private buildPaginatedResult<T>(
    rows: Array<T & { total_count?: string }>,
    opts: SearchOptions,
  ): PaginatedResult<T> {
    const total = rows.length > 0 ? parseInt(rows[0].total_count ?? '0', 10) : 0;
    const results = rows.map(({ total_count: _, ...rest }) => rest) as T[];
    return { results, total, limit: opts.limit, offset: opts.offset };
  }

  async upsertNote(note: NoteRow): Promise<void> {
    const sql = `
      INSERT INTO vault_embeddings (id, file_path, title, content, tags, embedding, file_hash, chunk_index, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (file_path, chunk_index) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        embedding = EXCLUDED.embedding,
        file_hash = EXCLUDED.file_hash,
        created_by = COALESCE(vault_embeddings.created_by, EXCLUDED.created_by),
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
      note.created_by ?? null,
    ]);
  }

  async deleteNote(filePath: string): Promise<void> {
    const sql = 'DELETE FROM vault_embeddings WHERE file_path = $1';
    await this.pool.query(sql, [filePath]);
  }

  async searchSemantic(
    embedding: number[],
    limitOrOptions: number | Partial<SearchOptions> = {},
  ): Promise<PaginatedResult<SearchResult>> {
    const opts = this.buildSearchOptions(limitOrOptions, SEMANTIC_DEFAULTS);
    if (opts.limit <= 0) throw new RangeError('limit must be a positive integer');

    // $1 = embedding (vector), then dynamic params follow
    let paramIdx = 2;
    const contentCol = this.buildContentColumn(opts, paramIdx);
    paramIdx = contentCol.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags,
             1 - (embedding <=> $1::vector) AS similarity,
             updated_at, created_by,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      ORDER BY embedding <=> $1::vector
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params = [
      JSON.stringify(embedding),
      ...contentCol.params,
      opts.limit,
      opts.offset,
    ];

    const result = await this.pool.query(sql, params);
    return this.buildPaginatedResult(result.rows, opts);
  }

  async getFileHash(filePath: string): Promise<string | null> {
    const sql = 'SELECT file_hash FROM vault_embeddings WHERE file_path = $1 LIMIT 1';
    const result = await this.pool.query(sql, [filePath]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].file_hash;
  }

  async deleteChunksAbove(filePath: string, maxChunkIndex: number): Promise<void> {
    const sql = 'DELETE FROM vault_embeddings WHERE file_path = $1 AND chunk_index > $2';
    await this.pool.query(sql, [filePath, maxChunkIndex]);
  }

  async listRecent(
    limitOrOptions: number | Partial<SearchOptions> = {},
  ): Promise<PaginatedResult<RecentNote>> {
    const opts = this.buildSearchOptions(limitOrOptions, RECENT_DEFAULTS);
    if (opts.limit <= 0) throw new RangeError('limit must be a positive integer');

    let paramIdx = 1;
    const contentCol = this.buildContentColumn(opts, paramIdx);
    paramIdx = contentCol.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      ORDER BY updated_at DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params = [...contentCol.params, opts.limit, opts.offset];

    const result = await this.pool.query(sql, params);
    return this.buildPaginatedResult(result.rows, opts);
  }

  async searchByAuthor(
    author: string,
    query?: string,
    options?: Partial<SearchOptions>,
  ): Promise<PaginatedResult<RecentNote>> {
    const opts = this.buildSearchOptions(options, TEXT_DEFAULTS);

    let paramIdx = 1;
    const authorParamIdx = paramIdx++;

    let queryClause = '';
    let queryParamIdx = 0;
    if (query) {
      queryParamIdx = paramIdx++;
      queryClause = ` AND content ILIKE $${queryParamIdx}`;
    }

    const contentCol = this.buildContentColumn(opts, paramIdx);
    paramIdx = contentCol.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      WHERE created_by = $${authorParamIdx}${queryClause}
      ORDER BY updated_at DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params: unknown[] = [author];
    if (query) params.push(`%${query}%`);
    params.push(...contentCol.params, opts.limit, opts.offset);

    const result = await this.pool.query(sql, params);
    return this.buildPaginatedResult(result.rows, opts);
  }

  async searchText(
    query: string,
    tags?: string[],
    options?: Partial<SearchOptions>,
  ): Promise<PaginatedResult<RecentNote>> {
    const opts = this.buildSearchOptions(options, TEXT_DEFAULTS);

    let paramIdx = 1;

    // $1 = query pattern
    const queryParamIdx = paramIdx++;

    let tagsClause = '';
    let tagsParamIdx = 0;
    if (tags && tags.length > 0) {
      tagsParamIdx = paramIdx++;
      tagsClause = ` AND tags @> $${tagsParamIdx}`;
    }

    const contentCol = this.buildContentColumn(opts, paramIdx);
    paramIdx = contentCol.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      WHERE content ILIKE $${queryParamIdx}${tagsClause}
      ORDER BY updated_at DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params: unknown[] = [`%${query}%`];
    if (tags && tags.length > 0) {
      params.push(tags);
    }
    params.push(...contentCol.params, opts.limit, opts.offset);

    const result = await this.pool.query(sql, params);
    return this.buildPaginatedResult(result.rows, opts);
  }
}
