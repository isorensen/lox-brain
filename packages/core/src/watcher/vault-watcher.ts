import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EmbeddingService } from '../lib/embedding-service.js';
import type { DbClient } from '../lib/db-client.js';

export class VaultWatcher {
  constructor(
    private readonly vaultPath: string,
    private readonly embeddingService: EmbeddingService,
    private readonly dbClient: DbClient,
  ) {}

  shouldProcess(filePath: string): boolean {
    if (!filePath.endsWith('.md')) return false;
    const relative = this.relativePath(filePath);
    if (relative.startsWith('.obsidian')) return false;
    if (relative.startsWith('.git')) return false;
    return true;
  }

  private relativePath(filePath: string): string {
    return path.relative(this.vaultPath, filePath).replace(/\\/g, '/');
  }

  deriveArea(relativePath: string): string | null {
    const parts = relativePath.split('/');
    if (parts.length >= 2 && (parts[0] === 'studies' || parts[0] === 'Livros')) {
      const validAreas = ['ia', 'programacao', 'lideranca', 'comunicacao', 'financas'];
      if (validAreas.includes(parts[1])) return parts[1];
    }
    if (parts[0] === 'api-docs') return 'programacao';
    return null;
  }

  deriveSourceType(relativePath: string): string | null {
    const parts = relativePath.split('/');
    if (parts[0] === 'studies') return 'study';
    if (parts[0] === 'Livros' && path.basename(relativePath).startsWith('summary')) return 'book_summary';
    if (parts[0] === 'news') return 'news';
    if (parts[0] === 'daily-logs') return 'daily_log';
    if (parts[0] === 'api-docs') return 'study';
    return 'free_note';
  }

  async handleFileChange(filePath: string, content: string): Promise<void> {
    const relative = this.relativePath(filePath);
    const newHash = this.embeddingService.computeHash(content);
    const existingHash = await this.dbClient.getFileHash(relative);

    if (existingHash === newHash) return;

    try {
      const metadata = this.embeddingService.parseNote(content);
      const chunks = this.embeddingService.chunkText(metadata.content);

      // Phase 1: Generate all embeddings (may fail — no DB writes yet)
      const chunkData: Array<{ content: string; embedding: number[] }> = [];
      for (const chunkContent of chunks) {
        const embeddingText = [metadata.title, chunkContent]
          .filter(Boolean)
          .join('\n');
        const embedding = await this.embeddingService.generateEmbedding(embeddingText);
        chunkData.push({ content: chunkContent, embedding });
      }

      // Phase 2: All embeddings succeeded — now upsert all chunks
      const area = this.deriveArea(relative);
      const sourceType = this.deriveSourceType(relative);

      for (let i = 0; i < chunkData.length; i++) {
        await this.dbClient.upsertNote({
          id: randomUUID(),
          file_path: relative,
          title: metadata.title,
          content: chunkData[i].content,
          tags: metadata.tags,
          embedding: chunkData[i].embedding,
          file_hash: newHash,
          chunk_index: i,
          created_by: metadata.created_by,
          area,
          source_type: sourceType,
        });
      }

      await this.dbClient.deleteChunksAbove(relative, chunkData.length - 1);
    } catch (err) {
      console.error(`[VaultWatcher] Failed to index ${relative}:`, err);
    }
  }

  async handleFileDelete(filePath: string): Promise<void> {
    await this.dbClient.deleteNote(this.relativePath(filePath));
  }
}
