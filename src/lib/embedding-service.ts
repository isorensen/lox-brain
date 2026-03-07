import { createHash } from 'node:crypto';
import type OpenAI from 'openai';
import type { NoteMetadata } from './types.js';

export class EmbeddingService {
  private readonly openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    const entry = response.data[0];
    if (!entry) {
      throw new Error('OpenAI embeddings API returned no data');
    }
    return entry.embedding;
  }

  parseNote(rawContent: string): NoteMetadata {
    const frontmatterMatch = rawContent.match(/^---\n([\s\S]*?)\n---/);

    let title: string | null = null;
    let tags: string[] = [];
    let content: string;

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Extract title from frontmatter
      const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      }

      // Extract tags from frontmatter (supports [tag1, tag2] and YAML list formats)
      const tagsInlineMatch = frontmatter.match(/^tags:\s*\[([^\]]*)\]$/m);
      if (tagsInlineMatch) {
        tags = tagsInlineMatch[1]
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
      } else {
        // Support YAML list format: tags:\n  - tag1\n  - tag2
        const tagsListMatch = frontmatter.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
        if (tagsListMatch) {
          tags = tagsListMatch[1]
            .split('\n')
            .map((line) => line.replace(/^\s+-\s+/, '').trim())
            .filter((t) => t.length > 0);
        }
      }

      // Content is everything after the frontmatter block
      content = rawContent.slice(frontmatterMatch[0].length).trim();
    } else {
      content = rawContent;
    }

    // If no title from frontmatter, try first H1
    if (!title) {
      const h1Match = content.match(/^#\s+(.+)$/m);
      if (h1Match) {
        title = h1Match[1].trim();
      }
    }

    return { title, tags, content };
  }

  computeHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }
}
