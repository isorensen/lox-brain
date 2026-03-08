import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DbClient } from '../lib/db-client.js';
import type { EmbeddingService } from '../lib/embedding-service.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Resolves a relative file path against the vault root and ensures it does not
 * escape outside of it.  Throws on path-traversal attempts, null-byte injection,
 * and paths that resolve to the vault root itself.
 */
function safePath(basePath: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new Error('Invalid path: null bytes not allowed');
  }
  const resolved = path.resolve(basePath, relativePath);
  // Ensure the resolved path is strictly inside the vault directory.
  // Adding path.sep prevents matching a sibling directory that shares a prefix,
  // and also rejects "." (vault root itself) since "/vault" does not startWith "/vault/".
  if (!resolved.startsWith(basePath + path.sep)) {
    throw new Error('Path traversal detected: path escapes vault directory');
  }
  return resolved;
}

// Known limitation: tags with commas, quotes, or YAML special characters
// may produce invalid frontmatter. Acceptable for personal vault MVP.

/**
 * Prepends YAML frontmatter with tags to content, unless the content already
 * contains frontmatter (starts with "---").
 */
function addFrontmatter(content: string, tags: string[]): string {
  if (tags.length === 0) return content;
  if (content.startsWith('---')) return content;
  return `---\ntags: [${tags.join(', ')}]\n---\n${content}`;
}

export function createTools(
  dbClient: DbClient,
  embeddingService: EmbeddingService,
  vaultPath: string,
): Tool[] {
  // Fix 1: normalize vaultPath to avoid trailing-slash issues.
  const normalizedVault = path.resolve(vaultPath);

  return [
    {
      name: 'write_note',
      description: 'Create or overwrite a Markdown note in the Obsidian vault.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path inside the vault (e.g. "projects/idea.md")' },
          content: { type: 'string', description: 'Markdown content of the note' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to add as frontmatter' },
        },
        required: ['file_path', 'content'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const filePath = args.file_path;
        if (typeof filePath !== 'string' || filePath.trim() === '') {
          throw new Error('file_path must be a non-empty string');
        }
        const content = args.content;
        if (typeof content !== 'string') {
          throw new Error('content must be a string');
        }
        const tags = (args.tags as string[] | undefined) ?? [];

        const resolved = safePath(normalizedVault, filePath);
        await mkdir(path.dirname(resolved), { recursive: true });

        const finalContent = addFrontmatter(content, tags);
        await writeFile(resolved, finalContent, 'utf-8');

        return { written: filePath };
      },
    },
    {
      name: 'read_note',
      description: 'Read the content of a Markdown note from the Obsidian vault.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path inside the vault' },
        },
        required: ['file_path'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const filePath = args.file_path;
        if (typeof filePath !== 'string' || filePath.trim() === '') {
          throw new Error('file_path must be a non-empty string');
        }
        const resolved = safePath(normalizedVault, filePath);
        const content = await readFile(resolved, 'utf-8');
        return { content };
      },
    },
    {
      name: 'delete_note',
      description: 'Delete a Markdown note from the Obsidian vault.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path inside the vault' },
        },
        required: ['file_path'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const filePath = args.file_path;
        if (typeof filePath !== 'string' || filePath.trim() === '') {
          throw new Error('file_path must be a non-empty string');
        }
        const resolved = safePath(normalizedVault, filePath);
        await unlink(resolved);
        return { deleted: filePath };
      },
    },
    {
      name: 'search_semantic',
      description: 'Search notes by semantic similarity using vector embeddings.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          limit: { type: 'number', description: 'Maximum number of results (default: 5)' },
        },
        required: ['query'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const query = args.query;
        if (typeof query !== 'string' || query.trim() === '') {
          throw new Error('query must be a non-empty string');
        }
        const limit = (args.limit as number | undefined) ?? 5;

        const embedding = await embeddingService.generateEmbedding(query);
        return dbClient.searchSemantic(embedding, limit);
      },
    },
    {
      name: 'search_text',
      description: 'Search notes by text content with optional tag filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for (case-insensitive)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to filter by' },
        },
        required: ['query'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const query = args.query;
        if (typeof query !== 'string' || query.trim() === '') {
          throw new Error('query must be a non-empty string');
        }
        const tags = args.tags as string[] | undefined;
        return dbClient.searchText(query, tags);
      },
    },
    {
      name: 'list_recent',
      description: 'List the most recently updated notes.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
        },
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const limit = (args.limit as number | undefined) ?? 10;
        return dbClient.listRecent(limit);
      },
    },
  ];
}
