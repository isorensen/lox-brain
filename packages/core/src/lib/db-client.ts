import type { Pool } from 'pg';
import type {
  NoteRow, SearchResult, RecentNote, SearchOptions, PaginatedResult,
  TaskRow, TaskStatus, TaskPriority, TaskListOptions,
} from '@lox-brain/shared';

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

  /**
   * Ensure the database schema is up-to-date.
   *
   * Probes `information_schema.columns` first and only issues `ALTER TABLE`
   * when a missing column is detected. Postgres runs the ownership check
   * before evaluating `IF NOT EXISTS`, so a plain `ALTER TABLE ADD COLUMN
   * IF NOT EXISTS` fails with 42501 for any connection role that holds
   * full DML grants but is not the table owner — even on the no-op path.
   * See issue #169.
   */
  async ensureSchema(): Promise<void> {
    const { rows } = await this.pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'vault_embeddings'
        AND column_name = 'created_by'
      LIMIT 1
    `);
    if (rows.length === 0) {
      // IF NOT EXISTS kept as a guard against a race between concurrent
      // owner-privileged startups probing and ALTERing at the same time.
      // Non-owner callers never reach this branch in normal operation
      // (the probe sees the column on an already-migrated DB), so the
      // 42501 path from #169 is not reintroduced.
      await this.pool.query(`
        ALTER TABLE vault_embeddings
          ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''
      `);
    }
    // NOTE: all other schema objects — the area/source_type columns and their
    // partial indexes, the dual-language full-text GIN indexes, and the tasks
    // table with its indexes — live in infra/postgres/schema.sql (applied by
    // the table owner at setup). They are intentionally NOT created here: a
    // non-owner runtime role cannot run ALTER TABLE / CREATE TABLE / CREATE
    // INDEX (even a no-op IF NOT EXISTS) without hitting the 42501 permission
    // error described in issue #169. Existing deployments pick them up by
    // re-applying schema.sql.
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

  private buildMetadataFilters(
    opts: SearchOptions,
    startParamIdx: number,
  ): { clauses: string[]; params: unknown[]; nextParamIndex: number } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = startParamIdx;

    if (opts.area) {
      clauses.push(`area = $${paramIdx++}`);
      params.push(opts.area);
    }
    if (opts.source_type) {
      clauses.push(`source_type = $${paramIdx++}`);
      params.push(opts.source_type);
    }
    return { clauses, params, nextParamIndex: paramIdx };
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
      INSERT INTO vault_embeddings (id, file_path, title, content, tags, embedding, file_hash, chunk_index, created_by, area, source_type, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (file_path, chunk_index) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        embedding = EXCLUDED.embedding,
        file_hash = EXCLUDED.file_hash,
        created_by = COALESCE(vault_embeddings.created_by, EXCLUDED.created_by),
        area = COALESCE(EXCLUDED.area, vault_embeddings.area),
        source_type = COALESCE(EXCLUDED.source_type, vault_embeddings.source_type),
        updated_at = NOW()
    `;

    await this.pool.query(sql, [
      note.id,
      note.file_path,
      note.title ?? '',
      note.content,
      note.tags,
      JSON.stringify(note.embedding),
      note.file_hash,
      note.chunk_index,
      note.created_by ?? null,
      note.area ?? null,
      note.source_type ?? null,
    ]);
  }

  async deleteNote(filePath: string): Promise<void> {
    const sql = 'DELETE FROM vault_embeddings WHERE file_path = $1';
    await this.pool.query(sql, [filePath]);
  }

  async reindexEmbeddings(): Promise<void> {
    const result = await this.pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'vault_embeddings'
        AND indexdef LIKE '%ivfflat%'
      LIMIT 1
    `);
    if (result.rows.length > 0) {
      const indexName = result.rows[0].indexname;
      await this.pool.query(`REINDEX INDEX ${indexName}`);
    }
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

    const filters = this.buildMetadataFilters(opts, paramIdx);
    paramIdx = filters.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const whereClause = filters.clauses.length > 0 ? `WHERE ${filters.clauses.join(' AND ')}` : '';

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags,
             1 - (embedding <=> $1::vector) AS similarity,
             updated_at, created_by, area, source_type,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      ${whereClause}
      ORDER BY embedding <=> $1::vector
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params = [
      JSON.stringify(embedding),
      ...contentCol.params,
      ...filters.params,
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

    const filters = this.buildMetadataFilters(opts, paramIdx);
    paramIdx = filters.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const whereClause = filters.clauses.length > 0 ? `WHERE ${filters.clauses.join(' AND ')}` : '';

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by, area, source_type,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params = [...contentCol.params, ...filters.params, opts.limit, opts.offset];

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

    const queryParamIdx = paramIdx++;

    let tagsClause = '';
    if (tags && tags.length > 0) {
      const tagsParamIdx = paramIdx++;
      tagsClause = ` AND tags @> $${tagsParamIdx}`;
    }

    const filters = this.buildMetadataFilters(opts, paramIdx);
    paramIdx = filters.nextParamIndex;
    const metadataClause = filters.clauses.length > 0 ? ` AND ${filters.clauses.join(' AND ')}` : '';

    const contentCol = this.buildContentColumn(opts, paramIdx);
    paramIdx = contentCol.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const q = `$${queryParamIdx}`;
    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by, area, source_type,
             GREATEST(
               ts_rank(to_tsvector('portuguese', content), plainto_tsquery('portuguese', ${q})),
               ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${q}))
             ) AS rank,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      WHERE (to_tsvector('portuguese', content) @@ plainto_tsquery('portuguese', ${q})
         OR to_tsvector('english', content) @@ plainto_tsquery('english', ${q})
         OR content ILIKE '%' || ${q} || '%')${tagsClause}${metadataClause}
      ORDER BY rank DESC, updated_at DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params: unknown[] = [query];
    if (tags && tags.length > 0) {
      params.push(tags);
    }
    params.push(...filters.params, ...contentCol.params, opts.limit, opts.offset);

    const result = await this.pool.query(sql, params);
    return this.buildPaginatedResult(result.rows, opts);
  }

  // --- Tasks ---

  async addTask(params: {
    title: string;
    details?: string;
    priority?: TaskPriority;
    due_date?: string;
    tags?: string[];
    project_context?: string;
    created_by?: string;
  }): Promise<TaskRow> {
    const result = await this.pool.query<TaskRow>(
      `INSERT INTO tasks (title, details, priority, due_date, tags, project_context, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.title,
        params.details ?? null,
        params.priority ?? 'medium',
        params.due_date ?? null,
        params.tags ?? [],
        params.project_context ?? null,
        params.created_by ?? null,
      ],
    );
    return result.rows[0];
  }

  async listTasks(options: TaskListOptions = {}): Promise<{ results: TaskRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const status = options.status ?? 'pending';
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(status);
    }
    if (options.priority) {
      conditions.push(`priority = $${paramIdx++}`);
      values.push(options.priority);
    }
    if (options.project_context) {
      conditions.push(`project_context = $${paramIdx++}`);
      values.push(options.project_context);
    }
    if (options.tags && options.tags.length > 0) {
      conditions.push(`tags && $${paramIdx++}`);
      values.push(options.tags);
    }
    if (options.due_before) {
      conditions.push(`due_date <= $${paramIdx++}`);
      values.push(options.due_before);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM tasks ${where}`, values,
    );
    const total = Number(countResult.rows[0].count);

    const result = await this.pool.query<TaskRow>(
      `SELECT * FROM tasks ${where}
       ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
         due_date ASC NULLS LAST,
         created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...values, limit, offset],
    );

    return { results: result.rows, total };
  }

  async updateTask(id: string, updates: Partial<{
    title: string;
    details: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_date: string;
    tags: string[];
    project_context: string;
  }>): Promise<TaskRow | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const idIdx = paramIdx++;
    if (updates.title !== undefined) { setClauses.push(`title = $${paramIdx++}`); values.push(updates.title); }
    if (updates.details !== undefined) { setClauses.push(`details = $${paramIdx++}`); values.push(updates.details); }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIdx++}`);
      values.push(updates.status);
      if (updates.status === 'done') {
        setClauses.push(`completed_at = NOW()`);
      }
    }
    if (updates.priority !== undefined) { setClauses.push(`priority = $${paramIdx++}`); values.push(updates.priority); }
    if (updates.due_date !== undefined) { setClauses.push(`due_date = $${paramIdx++}`); values.push(updates.due_date); }
    if (updates.tags !== undefined) { setClauses.push(`tags = $${paramIdx++}`); values.push(updates.tags); }
    if (updates.project_context !== undefined) { setClauses.push(`project_context = $${paramIdx++}`); values.push(updates.project_context); }

    if (setClauses.length === 0) return null;

    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<TaskRow>(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${idIdx} RETURNING *`,
      [id, ...values],
    );
    return result.rows[0] ?? null;
  }

  async completeTask(idOrTitle: string): Promise<TaskRow | null> {
    // Try by ID first
    let result = await this.pool.query<TaskRow>(
      `UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [idOrTitle],
    );
    if (result.rows[0]) return result.rows[0];

    // Fallback to fuzzy title match
    result = await this.pool.query<TaskRow>(
      `UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
       WHERE id = (SELECT id FROM tasks WHERE title ILIKE $1 AND status != 'done' ORDER BY created_at DESC LIMIT 1)
       RETURNING *`,
      [`%${idOrTitle}%`],
    );
    return result.rows[0] ?? null;
  }

  // --- Daily Log ---

  async appendDailyLog(entry: string, tags?: string[], createdBy?: string): Promise<{ id: string; date: string; entries_count: number }> {
    const today = new Date().toISOString().split('T')[0];
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const formattedEntry = `\n### ${timestamp}\n${entry}`;

    // Try to find existing daily log for today
    const existing = await this.pool.query<{ id: string; content: string; tags: string[] }>(
      `SELECT id, content, tags FROM vault_embeddings
       WHERE file_path = $1 AND chunk_index = 0`,
      [`daily-logs/${today}.md`],
    );

    if (existing.rows[0]) {
      const updatedContent = existing.rows[0].content + formattedEntry;
      const mergedTags = [...new Set([...existing.rows[0].tags, ...(tags ?? [])])];
      await this.pool.query(
        `UPDATE vault_embeddings SET content = $1, tags = $2, updated_at = NOW()
         WHERE id = $3`,
        [updatedContent, mergedTags, existing.rows[0].id],
      );
      const entriesCount = (updatedContent.match(/^### \d{2}:\d{2}/gm) ?? []).length;
      return { id: existing.rows[0].id, date: today, entries_count: entriesCount };
    }

    // Create new daily log
    const content = `# Daily Log - ${today}${formattedEntry}`;
    const allTags = ['daily_log', ...(tags ?? [])];
    const { randomUUID } = await import('node:crypto');
    const id = randomUUID();

    await this.pool.query(
      `INSERT INTO vault_embeddings (id, file_path, title, content, tags, embedding, file_hash, chunk_index, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
      [id, `daily-logs/${today}.md`, today, content, allTags, null, '', createdBy ?? ''],
    );

    return { id, date: today, entries_count: 1 };
  }
}
