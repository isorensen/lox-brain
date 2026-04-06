import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultWatcher } from '../../src/watcher/vault-watcher.js';
import type { EmbeddingService } from '../../src/lib/embedding-service.js';
import type { DbClient } from '../../src/lib/db-client.js';

function createMockEmbeddingService(): {
  [K in keyof Pick<EmbeddingService, 'parseNote' | 'generateEmbedding' | 'computeHash' | 'chunkText'>]: ReturnType<typeof vi.fn>;
} {
  return {
    parseNote: vi.fn().mockReturnValue({
      title: 'Test Note',
      tags: ['tag1', 'tag2'],
      content: 'Some content',
    }),
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    computeHash: vi.fn().mockReturnValue('abc123hash'),
    chunkText: vi.fn().mockReturnValue(['Some content']),
  };
}

function createMockDbClient(): {
  [K in keyof Pick<DbClient, 'getFileHash' | 'upsertNote' | 'deleteNote' | 'deleteChunksAbove'>]: ReturnType<typeof vi.fn>;
} {
  return {
    getFileHash: vi.fn().mockResolvedValue(null),
    upsertNote: vi.fn().mockResolvedValue(undefined),
    deleteNote: vi.fn().mockResolvedValue(undefined),
    deleteChunksAbove: vi.fn().mockResolvedValue(undefined),
  };
}

const VAULT_PATH = '/home/user/vault';

describe('VaultWatcher', () => {
  let mockEmbedding: ReturnType<typeof createMockEmbeddingService>;
  let mockDb: ReturnType<typeof createMockDbClient>;
  let watcher: VaultWatcher;

  beforeEach(() => {
    mockEmbedding = createMockEmbeddingService();
    mockDb = createMockDbClient();
    watcher = new VaultWatcher(
      VAULT_PATH,
      mockEmbedding as unknown as EmbeddingService,
      mockDb as unknown as DbClient,
    );
  });

  describe('shouldProcess', () => {
    it('should accept markdown files', () => {
      expect(watcher.shouldProcess(`${VAULT_PATH}/notes/my-note.md`)).toBe(true);
    });

    it('should ignore non-markdown files', () => {
      expect(watcher.shouldProcess(`${VAULT_PATH}/image.png`)).toBe(false);
      expect(watcher.shouldProcess(`${VAULT_PATH}/photo.jpg`)).toBe(false);
      expect(watcher.shouldProcess(`${VAULT_PATH}/data.json`)).toBe(false);
      expect(watcher.shouldProcess(`${VAULT_PATH}/style.css`)).toBe(false);
    });

    it('should ignore .obsidian directory', () => {
      expect(watcher.shouldProcess(`${VAULT_PATH}/.obsidian/config.md`)).toBe(false);
      expect(watcher.shouldProcess(`${VAULT_PATH}/.obsidian/plugins/note.md`)).toBe(false);
    });

    it('should ignore .git directory', () => {
      expect(watcher.shouldProcess(`${VAULT_PATH}/.git/HEAD.md`)).toBe(false);
      expect(watcher.shouldProcess(`${VAULT_PATH}/.git/hooks/pre-commit.md`)).toBe(false);
    });
  });

  describe('handleFileChange', () => {
    const filePath = `${VAULT_PATH}/notes/my-note.md`;
    const content = '---\ntitle: Test Note\ntags: [tag1, tag2]\n---\nSome content';

    it('should index a new file with correct data including UUID', async () => {
      mockDb.getFileHash.mockResolvedValue(null); // file not in DB yet

      await watcher.handleFileChange(filePath, content);

      // computeHash should be called with the raw content
      expect(mockEmbedding.computeHash).toHaveBeenCalledWith(content);

      // getFileHash should be called with relative path
      expect(mockDb.getFileHash).toHaveBeenCalledWith('notes/my-note.md');

      // parseNote and generateEmbedding should be called
      expect(mockEmbedding.parseNote).toHaveBeenCalledWith(content);
      expect(mockEmbedding.generateEmbedding).toHaveBeenCalledWith('Test Note\nSome content');

      // chunkText should be called with parsed content
      expect(mockEmbedding.chunkText).toHaveBeenCalledWith('Some content');

      // upsertNote should be called with correct data
      expect(mockDb.upsertNote).toHaveBeenCalledTimes(1);
      const upsertArg = mockDb.upsertNote.mock.calls[0][0];
      expect(upsertArg).toMatchObject({
        file_path: 'notes/my-note.md',
        title: 'Test Note',
        content: 'Some content',
        tags: ['tag1', 'tag2'],
        embedding: new Array(1536).fill(0.1),
        file_hash: 'abc123hash',
        chunk_index: 0,
      });
      // id should be a valid UUID
      expect(upsertArg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // orphan cleanup should be called
      expect(mockDb.deleteChunksAbove).toHaveBeenCalledWith('notes/my-note.md', 0);
    });

    it('should skip indexing if hash is unchanged', async () => {
      mockEmbedding.computeHash.mockReturnValue('same-hash');
      mockDb.getFileHash.mockResolvedValue('same-hash');

      await watcher.handleFileChange(filePath, content);

      expect(mockEmbedding.computeHash).toHaveBeenCalledWith(content);
      expect(mockDb.getFileHash).toHaveBeenCalledWith('notes/my-note.md');

      // Should NOT call parseNote, generateEmbedding, or upsertNote
      expect(mockEmbedding.parseNote).not.toHaveBeenCalled();
      expect(mockEmbedding.generateEmbedding).not.toHaveBeenCalled();
      expect(mockDb.upsertNote).not.toHaveBeenCalled();
    });

    it('should re-index if hash has changed', async () => {
      mockEmbedding.computeHash.mockReturnValue('new-hash');
      mockDb.getFileHash.mockResolvedValue('old-hash');

      await watcher.handleFileChange(filePath, content);

      expect(mockEmbedding.generateEmbedding).toHaveBeenCalledTimes(1);
      expect(mockDb.upsertNote).toHaveBeenCalledTimes(1);
      expect(mockDb.upsertNote.mock.calls[0][0].file_hash).toBe('new-hash');
    });

    it('should handle errors gracefully without crashing', async () => {
      mockEmbedding.generateEmbedding.mockRejectedValue(
        new Error('OpenAI API rate limit exceeded'),
      );

      // Should not throw — error is handled internally
      await expect(
        watcher.handleFileChange(filePath, content),
      ).resolves.toBeUndefined();

      // upsertNote should NOT have been called since embedding failed
      expect(mockDb.upsertNote).not.toHaveBeenCalled();
    });

    it('should generate embedding per chunk and upsert each with chunk_index', async () => {
      mockEmbedding.chunkText.mockReturnValue(['chunk zero', 'chunk one', 'chunk two']);
      const embeddings = [
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2),
        new Array(1536).fill(0.3),
      ];
      mockEmbedding.generateEmbedding
        .mockResolvedValueOnce(embeddings[0])
        .mockResolvedValueOnce(embeddings[1])
        .mockResolvedValueOnce(embeddings[2]);

      await watcher.handleFileChange(`${VAULT_PATH}/notes/large.md`, 'raw content');

      expect(mockEmbedding.generateEmbedding).toHaveBeenCalledTimes(3);
      expect(mockDb.upsertNote).toHaveBeenCalledTimes(3);
      expect(mockDb.upsertNote.mock.calls[0][0].chunk_index).toBe(0);
      expect(mockDb.upsertNote.mock.calls[1][0].chunk_index).toBe(1);
      expect(mockDb.upsertNote.mock.calls[2][0].chunk_index).toBe(2);
      expect(mockDb.upsertNote.mock.calls[0][0].content).toBe('chunk zero');
      expect(mockDb.upsertNote.mock.calls[1][0].content).toBe('chunk one');
      expect(mockDb.upsertNote.mock.calls[2][0].content).toBe('chunk two');
      expect(mockDb.deleteChunksAbove).toHaveBeenCalledWith('notes/large.md', 2);
    });

    it('should delete orphan chunks when note shrinks', async () => {
      mockEmbedding.chunkText.mockReturnValue(['chunk A', 'chunk B']);

      await watcher.handleFileChange(`${VAULT_PATH}/notes/shrunk.md`, 'raw content');

      expect(mockDb.upsertNote).toHaveBeenCalledTimes(2);
      expect(mockDb.deleteChunksAbove).toHaveBeenCalledWith('notes/shrunk.md', 1);
    });

    it('should not upsert any chunks if embedding fails mid-pipeline', async () => {
      mockEmbedding.chunkText.mockReturnValue(['chunk zero', 'chunk one', 'chunk two']);
      mockEmbedding.generateEmbedding
        .mockResolvedValueOnce(new Array(1536).fill(0.1))
        .mockRejectedValueOnce(new Error('OpenAI API rate limit exceeded'));

      await watcher.handleFileChange(`${VAULT_PATH}/notes/failing.md`, 'raw content');

      // No upserts should have happened since embedding failed on chunk 1
      expect(mockDb.upsertNote).not.toHaveBeenCalled();
      // No orphan cleanup either
      expect(mockDb.deleteChunksAbove).not.toHaveBeenCalled();
    });

    it('should pass created_by from parsed metadata to upsertNote', async () => {
      mockEmbedding.parseNote.mockReturnValue({
        title: 'Team Note',
        tags: [],
        content: 'Content here.',
        created_by: 'lucas',
      });
      mockEmbedding.chunkText.mockReturnValue(['Content here.']);

      await watcher.handleFileChange(`${VAULT_PATH}/notes/team.md`, 'raw');

      expect(mockDb.upsertNote).toHaveBeenCalledTimes(1);
      expect(mockDb.upsertNote.mock.calls[0][0].created_by).toBe('lucas');
    });

    it('should pass undefined created_by when not in metadata', async () => {
      await watcher.handleFileChange(filePath, content);

      expect(mockDb.upsertNote.mock.calls[0][0].created_by).toBeUndefined();
    });

    it('should handle title being null in embedding text', async () => {
      mockEmbedding.parseNote.mockReturnValue({
        title: null,
        tags: [],
        content: 'No title content',
      });
      mockEmbedding.chunkText.mockReturnValue(['No title content']);

      await watcher.handleFileChange(filePath, content);

      expect(mockEmbedding.generateEmbedding).toHaveBeenCalledWith('No title content');
    });
  });

  describe('handleFileDelete', () => {
    it('should propagate deleteNote errors to the caller', async () => {
      mockDb.deleteNote.mockRejectedValueOnce(new Error('DB connection lost'));
      await expect(
        watcher.handleFileDelete(`${VAULT_PATH}/notes/old.md`)
      ).rejects.toThrow('DB connection lost');
    });

    it('should call deleteNote with relative path', async () => {
      const filePath = `${VAULT_PATH}/notes/old-note.md`;

      await watcher.handleFileDelete(filePath);

      expect(mockDb.deleteNote).toHaveBeenCalledWith('notes/old-note.md');
    });

    it('should handle nested paths correctly', async () => {
      const filePath = `${VAULT_PATH}/projects/2024/research/deep-note.md`;

      await watcher.handleFileDelete(filePath);

      expect(mockDb.deleteNote).toHaveBeenCalledWith('projects/2024/research/deep-note.md');
    });
  });
});
