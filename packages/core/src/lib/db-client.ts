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
   * Runs idempotent ALTER TABLE statements so that columns introduced after
   * the initial CREATE TABLE (e.g. `created_by` from team-mode) exist on
   * databases that were provisioned before those columns were added.
   *
   * Safe to call on every startup — ADD COLUMN IF NOT EXISTS is a no-op
   * when the column already exists.
   */
  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      ALTER TABLE vault_embeddings
        ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''
    `);

    await this.pool.query(`
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
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date
        ON tasks(due_date) WHERE status NOT IN ('done', 'cancelled');
      CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN(tags);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_context ON tasks(project_context);
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_embeddings_fulltext
        ON vault_embeddings USING GIN(to_tsvector('portuguese', content))
    `);
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
      note.title ?? '',
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

    const queryParamIdx = paramIdx++;

    let tagsClause = '';
    if (tags && tags.length > 0) {
      const tagsParamIdx = paramIdx++;
      tagsClause = ` AND tags @> $${tagsParamIdx}`;
    }

    const contentCol = this.buildContentColumn(opts, paramIdx);
    paramIdx = contentCol.nextParamIndex;

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    const sql = `
      SELECT id, file_path, title, ${contentCol.sql}, tags, updated_at, created_by,
             ts_rank(to_tsvector('portuguese', content), plainto_tsquery('portuguese', $${queryParamIdx})) AS rank,
             COUNT(*) OVER() AS total_count
      FROM vault_embeddings
      WHERE to_tsvector('portuguese', content) @@ plainto_tsquery('portuguese', $${queryParamIdx})${tagsClause}
      ORDER BY rank DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const params: unknown[] = [query];
    if (tags && tags.length > 0) {
      params.push(tags);
    }
    params.push(...contentCol.params, opts.limit, opts.offset);

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
