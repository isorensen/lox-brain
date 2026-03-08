import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTools } from '../../src/mcp/tools.js';
import type { DbClient } from '../../src/lib/db-client.js';
import type { EmbeddingService } from '../../src/lib/embedding-service.js';

function createMockDbClient(): DbClient {
  return {
    upsertNote: vi.fn(),
    deleteNote: vi.fn(),
    searchSemantic: vi.fn().mockResolvedValue([]),
    searchText: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
    getFileHash: vi.fn().mockResolvedValue(null),
  } as unknown as DbClient;
}

function createMockEmbeddingService(): EmbeddingService {
  return {
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    parseNote: vi.fn().mockReturnValue({ title: null, tags: [], content: '' }),
    computeHash: vi.fn().mockReturnValue('abc123'),
  } as unknown as EmbeddingService;
}

describe('createTools', () => {
  let tempVaultPath: string;
  let dbClient: ReturnType<typeof createMockDbClient>;
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;

  beforeEach(async () => {
    tempVaultPath = await mkdtemp(path.join(tmpdir(), 'vault-test-'));
    dbClient = createMockDbClient();
    embeddingService = createMockEmbeddingService();
  });

  afterEach(async () => {
    await rm(tempVaultPath, { recursive: true, force: true });
  });

  describe('tool definitions', () => {
    it('should define exactly 6 tools', () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      expect(tools).toHaveLength(6);
    });

    it('should define tools with correct names', () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const names = tools.map((t) => t.name);
      expect(names).toContain('write_note');
      expect(names).toContain('read_note');
      expect(names).toContain('delete_note');
      expect(names).toContain('search_semantic');
      expect(names).toContain('search_text');
      expect(names).toContain('list_recent');
    });

    it('each tool should have name, description, inputSchema, and handler', () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
        expect(typeof tool.handler).toBe('function');
      }
    });
  });

  describe('search_semantic handler', () => {
    it('should call embeddingService.generateEmbedding and dbClient.searchSemantic', async () => {
      const mockResults = [
        { id: '1', file_path: 'note.md', title: 'Note', content: 'content', tags: [], similarity: 0.9, updated_at: new Date() },
      ];
      vi.mocked(dbClient.searchSemantic).mockResolvedValue(mockResults);

      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'search_semantic')!;

      const result = await tool.handler({ query: 'test query' });

      expect(embeddingService.generateEmbedding).toHaveBeenCalledWith('test query');
      expect(dbClient.searchSemantic).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5);
      expect(result).toEqual(mockResults);
    });

    it('should use custom limit when provided', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'search_semantic')!;

      await tool.handler({ query: 'test', limit: 3 });

      expect(dbClient.searchSemantic).toHaveBeenCalledWith([0.1, 0.2, 0.3], 3);
    });

    it('should default limit to 5', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'search_semantic')!;

      await tool.handler({ query: 'test' });

      expect(dbClient.searchSemantic).toHaveBeenCalledWith(expect.any(Array), 5);
    });
  });

  describe('search_text handler', () => {
    it('should call dbClient.searchText with query', async () => {
      const mockResults = [
        { id: '1', file_path: 'note.md', title: 'Note', content: 'content', tags: [], updated_at: new Date() },
      ];
      vi.mocked(dbClient.searchText).mockResolvedValue(mockResults);

      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'search_text')!;

      const result = await tool.handler({ query: 'hello' });

      expect(dbClient.searchText).toHaveBeenCalledWith('hello', undefined);
      expect(result).toEqual(mockResults);
    });

    it('should pass tags when provided', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'search_text')!;

      await tool.handler({ query: 'hello', tags: ['project', 'idea'] });

      expect(dbClient.searchText).toHaveBeenCalledWith('hello', ['project', 'idea']);
    });
  });

  describe('list_recent handler', () => {
    it('should call dbClient.listRecent with default limit 10', async () => {
      const mockResults = [
        { id: '1', file_path: 'note.md', title: 'Note', content: 'content', tags: [], updated_at: new Date() },
      ];
      vi.mocked(dbClient.listRecent).mockResolvedValue(mockResults);

      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'list_recent')!;

      const result = await tool.handler({});

      expect(dbClient.listRecent).toHaveBeenCalledWith(10);
      expect(result).toEqual(mockResults);
    });

    it('should use custom limit when provided', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'list_recent')!;

      await tool.handler({ limit: 20 });

      expect(dbClient.listRecent).toHaveBeenCalledWith(20);
    });
  });

  describe('write_note handler', () => {
    it('should write file to disk', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'write_note')!;

      await tool.handler({ file_path: 'test.md', content: '# Hello\n\nWorld' });

      const written = await readFile(path.join(tempVaultPath, 'test.md'), 'utf-8');
      expect(written).toBe('# Hello\n\nWorld');
    });

    it('should create parent directories if needed', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'write_note')!;

      await tool.handler({ file_path: 'deep/nested/dir/test.md', content: 'content' });

      const written = await readFile(path.join(tempVaultPath, 'deep/nested/dir/test.md'), 'utf-8');
      expect(written).toBe('content');
    });

    it('should add frontmatter for tags when provided', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'write_note')!;

      await tool.handler({ file_path: 'tagged.md', content: '# Note', tags: ['project', 'idea'] });

      const written = await readFile(path.join(tempVaultPath, 'tagged.md'), 'utf-8');
      expect(written).toContain('---');
      expect(written).toContain('tags: [project, idea]');
      expect(written).toContain('# Note');
    });

    it('should not add frontmatter if content already has frontmatter', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'write_note')!;

      const content = '---\ntitle: Existing\n---\n# Note';
      await tool.handler({ file_path: 'existing-fm.md', content, tags: ['extra'] });

      const written = await readFile(path.join(tempVaultPath, 'existing-fm.md'), 'utf-8');
      // Should write the content as-is since it already has frontmatter
      expect(written).toBe(content);
    });

    it('should not add frontmatter if no tags provided', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'write_note')!;

      await tool.handler({ file_path: 'no-tags.md', content: '# Simple Note' });

      const written = await readFile(path.join(tempVaultPath, 'no-tags.md'), 'utf-8');
      expect(written).toBe('# Simple Note');
      expect(written).not.toContain('---');
    });

    it('should reject path traversal', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'write_note')!;

      await expect(
        tool.handler({ file_path: '../../../etc/passwd', content: 'malicious' }),
      ).rejects.toThrow(/path traversal/i);
    });

    it('should reject null-byte path injection in write_note', async () => {
      const tool = createTools(dbClient, embeddingService, tempVaultPath).find((t) => t.name === 'write_note')!;
      await expect(
        tool.handler({ file_path: 'legit.md\0../../../etc/passwd', content: 'x' }),
      ).rejects.toThrow();
    });

    it('should reject dot path in write_note', async () => {
      const tool = createTools(dbClient, embeddingService, tempVaultPath).find((t) => t.name === 'write_note')!;
      await expect(
        tool.handler({ file_path: '.', content: 'x' }),
      ).rejects.toThrow();
    });
  });

  describe('read_note handler', () => {
    it('should read file from disk', async () => {
      await writeFile(path.join(tempVaultPath, 'existing.md'), 'Hello world');

      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'read_note')!;

      const result = await tool.handler({ file_path: 'existing.md' });

      expect(result).toEqual({ content: 'Hello world' });
    });

    it('should reject path traversal', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'read_note')!;

      await expect(
        tool.handler({ file_path: '../../../etc/passwd' }),
      ).rejects.toThrow(/path traversal/i);
    });

    it('should reject null-byte path injection in read_note', async () => {
      const tool = createTools(dbClient, embeddingService, tempVaultPath).find((t) => t.name === 'read_note')!;
      await expect(
        tool.handler({ file_path: 'legit.md\0../../../etc/passwd' }),
      ).rejects.toThrow();
    });

    it('should throw if file does not exist', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'read_note')!;

      await expect(
        tool.handler({ file_path: 'nonexistent.md' }),
      ).rejects.toThrow();
    });
  });

  describe('delete_note handler', () => {
    it('should delete file from disk', async () => {
      const filePath = path.join(tempVaultPath, 'to-delete.md');
      await writeFile(filePath, 'delete me');

      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'delete_note')!;

      await tool.handler({ file_path: 'to-delete.md' });

      await expect(readFile(filePath, 'utf-8')).rejects.toThrow();
    });

    it('should reject path traversal', async () => {
      const tools = createTools(dbClient, embeddingService, tempVaultPath);
      const tool = tools.find((t) => t.name === 'delete_note')!;

      await expect(
        tool.handler({ file_path: '../../../etc/passwd' }),
      ).rejects.toThrow(/path traversal/i);
    });

    it('should reject null-byte path injection in delete_note', async () => {
      const tool = createTools(dbClient, embeddingService, tempVaultPath).find((t) => t.name === 'delete_note')!;
      await expect(
        tool.handler({ file_path: 'legit.md\0../../../etc/passwd' }),
      ).rejects.toThrow();
    });

    it('should throw when deleting nonexistent file', async () => {
      const tool = createTools(dbClient, embeddingService, tempVaultPath).find((t) => t.name === 'delete_note')!;
      await expect(
        tool.handler({ file_path: 'nonexistent.md' }),
      ).rejects.toThrow();
    });
  });
});
