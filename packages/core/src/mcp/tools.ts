import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DbClient } from '../lib/db-client.js';
import type { EmbeddingService } from '../lib/embedding-service.js';
import type { SearchOptions } from '@lox-brain/shared';

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
 * Prepends YAML frontmatter with tags and/or created_by to content, unless the
 * content already contains frontmatter (starts with "---").
 */
export function addFrontmatter(content: string, tags: string[], createdBy?: string): string {
  if (content.startsWith('---')) return content;

  const fields: string[] = [];
  if (tags.length > 0) fields.push(`tags: [${tags.join(', ')}]`);
  if (createdBy) fields.push(`created_by: ${createdBy}`);

  if (fields.length === 0) return content;
  return `---\n${fields.join('\n')}\n---\n${content}`;
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
        const createdBy = typeof args._created_by === 'string' ? args._created_by : undefined;

        const resolved = safePath(normalizedVault, filePath);
        await mkdir(path.dirname(resolved), { recursive: true });

        const finalContent = addFrontmatter(content, tags, createdBy);
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
      description: 'Search notes by semantic similarity. Returns metadata only by default (file_path, title, tags, similarity). Set include_content=true for preview, or use read_note for full content.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          limit: { type: 'number', description: 'Maximum number of results (default: 5)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
          include_content: { type: 'boolean', description: 'Include content in results (default: false)' },
          content_preview_length: { type: 'number', description: 'Truncate content to N chars, 0 for full (default: 300)' },
          area: { type: 'string', description: 'Filter by area (e.g. ia, programacao, lideranca, comunicacao, financas)' },
          source_type: { type: 'string', description: 'Filter by source type (e.g. study, book_summary, news, free_note, daily_log)' },
        },
        required: ['query'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const query = args.query;
        if (typeof query !== 'string' || query.trim() === '') {
          throw new Error('query must be a non-empty string');
        }

        const searchOptions: Partial<SearchOptions> = {
          limit: (args.limit as number | undefined) ?? 5,
          offset: (args.offset as number | undefined) ?? 0,
          includeContent: (args.include_content as boolean | undefined) ?? false,
          contentPreviewLength: (args.content_preview_length as number | undefined) ?? 300,
          area: args.area as string | undefined,
          source_type: args.source_type as string | undefined,
        };

        const embedding = await embeddingService.generateEmbedding(query);
        return dbClient.searchSemantic(embedding, searchOptions);
      },
    },
    {
      name: 'search_text',
      description: 'Search notes by text content (case-insensitive). Returns metadata only by default. Use read_note for full content.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for (case-insensitive)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to filter by' },
          area: { type: 'string', description: 'Filter by area (e.g. ia, programacao, lideranca, comunicacao, financas)' },
          source_type: { type: 'string', description: 'Filter by source type (e.g. study, book_summary, news, free_note, daily_log)' },
          limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
          include_content: { type: 'boolean', description: 'Include content in results (default: false)' },
          content_preview_length: { type: 'number', description: 'Truncate content to N chars, 0 for full (default: 300)' },
        },
        required: ['query'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const query = args.query;
        if (typeof query !== 'string' || query.trim() === '') {
          throw new Error('query must be a non-empty string');
        }
        const tags = args.tags as string[] | undefined;

        const searchOptions: Partial<SearchOptions> = {
          limit: (args.limit as number | undefined) ?? 20,
          offset: (args.offset as number | undefined) ?? 0,
          includeContent: (args.include_content as boolean | undefined) ?? false,
          contentPreviewLength: (args.content_preview_length as number | undefined) ?? 300,
          area: args.area as string | undefined,
          source_type: args.source_type as string | undefined,
        };

        return dbClient.searchText(query, tags, searchOptions);
      },
    },
    {
      name: 'list_recent',
      description: 'List most recently updated notes. Returns metadata only by default. Use read_note for full content.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
          include_content: { type: 'boolean', description: 'Include content in results (default: false)' },
          content_preview_length: { type: 'number', description: 'Truncate content to N chars, 0 for full (default: 300)' },
          area: { type: 'string', description: 'Filter by area' },
          source_type: { type: 'string', description: 'Filter by source type' },
        },
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const searchOptions: Partial<SearchOptions> = {
          limit: (args.limit as number | undefined) ?? 10,
          offset: (args.offset as number | undefined) ?? 0,
          includeContent: (args.include_content as boolean | undefined) ?? false,
          contentPreviewLength: (args.content_preview_length as number | undefined) ?? 300,
          area: args.area as string | undefined,
          source_type: args.source_type as string | undefined,
        };

        return dbClient.listRecent(searchOptions);
      },
    },
  ];
}
