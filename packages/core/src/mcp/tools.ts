import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DbClient } from '../lib/db-client.js';
import type { EmbeddingService } from '../lib/embedding-service.js';
import type { SearchOptions, TaskStatus, TaskPriority, TASK_STATUSES, TASK_PRIORITIES } from '@lox-brain/shared';

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
        };

        const embedding = await embeddingService.generateEmbedding(query);
        return dbClient.searchSemantic(embedding, searchOptions);
      },
    },
    {
      name: 'search_text',
      description: 'Search notes by text content. Returns metadata only by default. Supports pagination via limit/offset. Use read_note for full content.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for (case-insensitive)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to filter by' },
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
        },
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const searchOptions: Partial<SearchOptions> = {
          limit: (args.limit as number | undefined) ?? 10,
          offset: (args.offset as number | undefined) ?? 0,
          includeContent: (args.include_content as boolean | undefined) ?? false,
          contentPreviewLength: (args.content_preview_length as number | undefined) ?? 300,
        };

        return dbClient.listRecent(searchOptions);
      },
    },

    // --- Task Management ---

    {
      name: 'add_task',
      description: 'Create a task with title, priority, due date, and tags. Returns the created task.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          details: { type: 'string', description: 'Optional markdown details' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Priority (default: medium)' },
          due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering' },
          project_context: { type: 'string', description: 'Which project this task relates to' },
        },
        required: ['title'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const title = args.title;
        if (typeof title !== 'string' || title.trim() === '') {
          throw new Error('title must be a non-empty string');
        }
        const createdBy = typeof args._created_by === 'string' ? args._created_by : undefined;
        return dbClient.addTask({
          title,
          details: args.details as string | undefined,
          priority: args.priority as TaskPriority | undefined,
          due_date: args.due_date as string | undefined,
          tags: args.tags as string[] | undefined,
          project_context: args.project_context as string | undefined,
          created_by: createdBy,
        });
      },
    },
    {
      name: 'list_tasks',
      description: 'List tasks sorted by priority and due date. Defaults to pending tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'], description: 'Filter by status (default: pending)' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Filter by priority' },
          project_context: { type: 'string', description: 'Filter by project' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (overlap)' },
          due_before: { type: 'string', description: 'Show tasks due before this date (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
        },
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        return dbClient.listTasks({
          status: args.status as TaskStatus | undefined,
          priority: args.priority as TaskPriority | undefined,
          project_context: args.project_context as string | undefined,
          tags: args.tags as string[] | undefined,
          due_before: args.due_before as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
      },
    },
    {
      name: 'update_task',
      description: 'Update any field of a task by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task UUID' },
          title: { type: 'string' },
          details: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          due_date: { type: 'string', description: 'YYYY-MM-DD' },
          tags: { type: 'array', items: { type: 'string' } },
          project_context: { type: 'string' },
        },
        required: ['id'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const id = args.id;
        if (typeof id !== 'string' || id.trim() === '') {
          throw new Error('id must be a non-empty string');
        }
        const { id: _, _created_by: __, ...updates } = args;
        const result = await dbClient.updateTask(id, updates as Record<string, unknown>);
        if (!result) throw new Error(`Task not found: ${id}`);
        return result;
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task as done by ID or fuzzy title match. Sets completed_at timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          id_or_title: { type: 'string', description: 'Task UUID or partial title to match' },
        },
        required: ['id_or_title'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const idOrTitle = args.id_or_title;
        if (typeof idOrTitle !== 'string' || idOrTitle.trim() === '') {
          throw new Error('id_or_title must be a non-empty string');
        }
        const result = await dbClient.completeTask(idOrTitle);
        if (!result) throw new Error(`No pending task found matching: ${idOrTitle}`);
        return result;
      },
    },

    // --- Daily Log ---

    {
      name: 'daily_log',
      description: 'Append a timestamped entry to today\'s daily log. Auto-creates if no log exists for today.',
      inputSchema: {
        type: 'object',
        properties: {
          entry: { type: 'string', description: 'What you learned, solved, or observed' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for this entry' },
        },
        required: ['entry'],
      },
      async handler(args: Record<string, unknown>): Promise<unknown> {
        const entry = args.entry;
        if (typeof entry !== 'string' || entry.trim() === '') {
          throw new Error('entry must be a non-empty string');
        }
        const tags = args.tags as string[] | undefined;
        const createdBy = typeof args._created_by === 'string' ? args._created_by : undefined;
        return dbClient.appendDailyLog(entry, tags, createdBy);
      },
    },
  ];
}
