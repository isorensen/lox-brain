import type { Pool } from 'pg';
import type { NoteRow, SearchResult, RecentNote } from './types.js';

export class DbClient {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async upsertNote(note: NoteRow): Promise<void> {
    const sql = `
      INSERT INTO vault_embeddings (id, file_path, title, content, tags, embedding, file_hash, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (file_path) DO UPDATE SET
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
    ]);
  }

  async deleteNote(filePath: string): Promise<void> {
    const sql = 'DELETE FROM vault_embeddings WHERE file_path = $1';
    await this.pool.query(sql, [filePath]);
  }

  async searchSemantic(embedding: number[], limit: number): Promise<SearchResult[]> {
    if (limit <= 0) throw new RangeError('limit must be a positive integer');
    const sql = `
      SELECT id, file_path, title, content, tags,
             1 - (embedding <=> $1::vector) AS similarity,
             updated_at
      FROM vault_embeddings
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;

    const result = await this.pool.query(sql, [JSON.stringify(embedding), limit]);
    return result.rows;
  }

  async getFileHash(filePath: string): Promise<string | null> {
    const sql = 'SELECT file_hash FROM vault_embeddings WHERE file_path = $1';
    const result = await this.pool.query(sql, [filePath]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].file_hash;
  }

  async listRecent(limit: number): Promise<RecentNote[]> {
    if (limit <= 0) throw new RangeError('limit must be a positive integer');
    const sql = `
      SELECT id, file_path, title, content, tags, updated_at
      FROM vault_embeddings
      ORDER BY updated_at DESC
      LIMIT $1
    `;

    const result = await this.pool.query(sql, [limit]);
    return result.rows;
  }

  async searchText(query: string, tags?: string[]): Promise<RecentNote[]> {
    if (tags && tags.length > 0) {
      const sql = `
        SELECT id, file_path, title, content, tags, updated_at
        FROM vault_embeddings
        WHERE content ILIKE $1 AND tags @> $2
        ORDER BY updated_at DESC
        LIMIT 50
      `;
      const result = await this.pool.query(sql, [`%${query}%`, tags]);
      return result.rows;
    }

    const sql = `
      SELECT id, file_path, title, content, tags, updated_at
      FROM vault_embeddings
      WHERE content ILIKE $1
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    const result = await this.pool.query(sql, [`%${query}%`]);
    return result.rows;
  }
}
