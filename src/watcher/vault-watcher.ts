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
    return path.relative(this.vaultPath, filePath);
  }

  async handleFileChange(filePath: string, content: string): Promise<void> {
    const relative = this.relativePath(filePath);
    const newHash = this.embeddingService.computeHash(content);
    const existingHash = await this.dbClient.getFileHash(relative);

    if (existingHash === newHash) return;

    try {
      const metadata = this.embeddingService.parseNote(content);
      const embeddingText = [metadata.title, metadata.content]
        .filter(Boolean)
        .join('\n');
      const embedding = await this.embeddingService.generateEmbedding(embeddingText);

      await this.dbClient.upsertNote({
        // id is used only for INSERT; ON CONFLICT (file_path) preserves the existing row's id.
        id: randomUUID(),
        file_path: relative,
        title: metadata.title,
        content: metadata.content,
        tags: metadata.tags,
        embedding,
        file_hash: newHash,
      });
    } catch (err) {
      console.error(`[VaultWatcher] Failed to index ${relative}:`, err);
    }
  }

  async handleFileDelete(filePath: string): Promise<void> {
    await this.dbClient.deleteNote(this.relativePath(filePath));
  }
}
