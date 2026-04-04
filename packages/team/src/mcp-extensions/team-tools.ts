import type { SearchOptions } from '@lox-brain/shared';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface DbClientLike {
  listRecent(options?: Partial<SearchOptions>): Promise<unknown>;
  searchByAuthor(author: string, query?: string, options?: Partial<SearchOptions>): Promise<unknown>;
}

export function createTeamTools(dbClient: DbClientLike): Tool[] {
  return [
    {
      name: 'list_team_activity',
      description: 'List recent notes with author attribution.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default: 20)' },
          offset: { type: 'number', description: 'Pagination offset (default: 0)' },
          include_content: { type: 'boolean', description: 'Include content (default: false)' },
          content_preview_length: { type: 'number', description: 'Truncate content (default: 300)' },
        },
      },
      async handler(args: Record<string, unknown>) {
        return dbClient.listRecent({
          limit: (args.limit as number) ?? 20,
          offset: (args.offset as number) ?? 0,
          includeContent: (args.include_content as boolean) ?? false,
          contentPreviewLength: (args.content_preview_length as number) ?? 300,
        });
      },
    },
    {
      name: 'search_by_author',
      description: 'Search notes by a specific team member.',
      inputSchema: {
        type: 'object',
        properties: {
          author: { type: 'string', description: 'Author name' },
          query: { type: 'string', description: 'Optional text filter' },
          limit: { type: 'number' },
          offset: { type: 'number' },
          include_content: { type: 'boolean' },
          content_preview_length: { type: 'number' },
        },
        required: ['author'],
      },
      async handler(args: Record<string, unknown>) {
        const author = args.author;
        if (typeof author !== 'string' || author.trim() === '') {
          throw new Error('author must be a non-empty string');
        }
        return dbClient.searchByAuthor(author, args.query as string | undefined, {
          limit: (args.limit as number) ?? 20,
          offset: (args.offset as number) ?? 0,
          includeContent: (args.include_content as boolean) ?? false,
          contentPreviewLength: (args.content_preview_length as number) ?? 300,
        });
      },
    },
  ];
}
