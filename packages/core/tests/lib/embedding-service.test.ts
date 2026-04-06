import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '../../src/lib/embedding-service.js';
import type { NoteMetadata } from '@lox-brain/shared';

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let mockOpenAI: any;

  beforeEach(() => {
    mockOpenAI = {
      embeddings: {
        create: vi.fn(),
      },
    };
    service = new EmbeddingService(mockOpenAI);
  });

  describe('generateEmbedding', () => {
    it('should throw when OpenAI returns empty data array', async () => {
      mockOpenAI.embeddings.create.mockResolvedValue({
        data: [],
      });

      await expect(service.generateEmbedding('test text')).rejects.toThrow(
        'OpenAI embeddings API returned no data',
      );
    });

    it('should propagate OpenAI API errors', async () => {
      mockOpenAI.embeddings.create.mockRejectedValue(new Error('API rate limit exceeded'));

      await expect(service.generateEmbedding('test text')).rejects.toThrow(
        'API rate limit exceeded',
      );
    });

    it('should generate embedding vector from text', async () => {
      const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      mockOpenAI.embeddings.create.mockResolvedValue({
        data: [{ embedding: fakeEmbedding }],
      });

      const result = await service.generateEmbedding('test text');

      expect(result).toEqual(fakeEmbedding);
      expect(result).toHaveLength(1536);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
    });
  });

  describe('parseNote', () => {
    it('should extract title from frontmatter and tags from tags field', () => {
      const rawContent = `---
title: My Note Title
tags: [tag1, tag2, tag3]
---

# Some Heading

This is the note content.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.title).toBe('My Note Title');
      expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
      expect(result.content).toContain('This is the note content.');
      expect(result.content).not.toContain('---');
    });

    it('should extract title from first H1 if no frontmatter title', () => {
      const rawContent = `# First Heading

Some content here.

## Second Heading

More content.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.title).toBe('First Heading');
      expect(result.tags).toEqual([]);
      expect(result.content).toContain('Some content here.');
    });

    it('should extract tags from YAML list format', () => {
      const rawContent = `---
title: YAML Tags Note
tags:
  - alpha
  - beta
  - gamma
---

Content with YAML list tags.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.title).toBe('YAML Tags Note');
      expect(result.tags).toEqual(['alpha', 'beta', 'gamma']);
      expect(result.content).toContain('Content with YAML list tags.');
    });

    it('should strip quotes from frontmatter title', () => {
      const rawContent = `---
title: "My Quoted Note"
tags: [tag1]
---

Content here.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.title).toBe('My Quoted Note');
    });

    it('should strip single quotes from frontmatter title', () => {
      const rawContent = `---
title: 'Single Quoted'
---

Content here.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.title).toBe('Single Quoted');
    });

    it('should return null title and empty tags when no frontmatter or H1', () => {
      const rawContent = `Just some plain text without any headings or frontmatter.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.title).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.content).toBe('Just some plain text without any headings or frontmatter.');
    });

    it('should extract created_by from frontmatter when present', () => {
      const rawContent = `---
title: Meeting Note
tags: [meeting, credifit]
created_by: matheus
---

Meeting content here.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.created_by).toBe('matheus');
    });

    it('should return undefined created_by when field not in frontmatter', () => {
      const rawContent = `---
title: Regular Note
tags: [tag1]
---

Content without created_by.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.created_by).toBeUndefined();
    });

    it('should return undefined created_by when no frontmatter at all', () => {
      const rawContent = `# Just a Heading

Plain content with no frontmatter.`;

      const result: NoteMetadata = service.parseNote(rawContent);

      expect(result.created_by).toBeUndefined();
    });
  });

  describe('chunkText', () => {
    it('should return single chunk for text within token limit', () => {
      const shortText = 'This is a short note.';
      const chunks = service.chunkText(shortText);
      expect(chunks).toEqual([shortText]);
      expect(chunks).toHaveLength(1);
    });

    it('should split long text into multiple chunks', () => {
      const paragraph = 'A'.repeat(5000) + '\n\n';
      const longText = paragraph.repeat(6);
      const chunks = service.chunkText(longText);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.trim().length).toBeGreaterThan(0);
      }
    });

    it('should split on paragraph boundaries (\\n\\n)', () => {
      // Each paragraph ~3334 tokens at chars/3. Two = 6668 (exceeds 4000).
      const para = 'B'.repeat(10000);
      const text = `${para}\n\n${para}\n\n${para}`;
      const chunks = service.chunkText(text);
      expect(chunks.length).toBe(3);
    });

    it('should include overlap from previous chunk', () => {
      // Each paragraph ~1867 tokens at chars/3 (5600 chars). Two fit in 4000 tokens,
      // three don't, so chunks split after every 2 paragraphs.
      const paraA = 'AAAA '.repeat(1120); // 5600 chars
      const paraB = 'BBBB '.repeat(1120);
      const paraC = 'CCCC '.repeat(1120);
      const paraD = 'DDDD '.repeat(1120);
      const text = [paraA, paraB, paraC, paraD].join('\n\n');
      const chunks = service.chunkText(text);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      if (chunks.length >= 2) {
        // Last paragraph of chunk 0 should appear as overlap in chunk 1
        expect(chunks[1]).toContain('BBBB');
      }
    });

    it('should handle text without \\n\\n separators (single long paragraph)', () => {
      // 30000 chars / 3 = 10000 tokens, exceeds 4000 maxTokens
      const longParagraph = 'X'.repeat(30000);
      const chunks = service.chunkText(longParagraph);
      expect(chunks.length).toBeGreaterThan(1);
      // maxTokens=4000, chars/3 → max chars per chunk = 12000
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(12000);
      }
      expect(chunks.join('')).toBe(longParagraph);
    });

    it('should force-split a single long paragraph that exceeds maxTokens', () => {
      const longParagraph = 'X'.repeat(30000);
      const chunks = service.chunkText(longParagraph);

      expect(chunks.length).toBeGreaterThan(1);
      // maxTokens=4000, chars/3 → max chars per chunk = 12000
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(12000);
      }
      expect(chunks.join('')).toBe(longParagraph);
    });

    it('should return single empty chunk for empty text', () => {
      const chunks = service.chunkText('');
      expect(chunks).toEqual(['']);
    });
  });

  describe('computeHash', () => {
    it('should compute deterministic SHA256 hash', () => {
      const content = 'Hello, World!';
      const hash1 = service.computeHash(content);
      const hash2 = service.computeHash(content);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      // Different content should produce different hash
      const hash3 = service.computeHash('Different content');
      expect(hash3).not.toBe(hash1);
    });
  });
});
