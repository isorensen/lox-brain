import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTeamTools } from '../../src/mcp-extensions/team-tools.js';

describe('createTeamTools', () => {
  const mockDbClient = {
    listRecent: vi.fn(),
    searchByAuthor: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return two tools: list_team_activity and search_by_author', () => {
    const tools = createTeamTools(mockDbClient as any);
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toEqual(['list_team_activity', 'search_by_author']);
  });

  describe('list_team_activity', () => {
    it('should call listRecent and return results', async () => {
      mockDbClient.listRecent.mockResolvedValue({
        results: [
          { id: '1', file_path: 'a.md', title: 'A', tags: [], updated_at: new Date(), created_by: 'eduardo' },
        ],
        total: 1, limit: 20, offset: 0,
      });
      const tools = createTeamTools(mockDbClient as any);
      const listTool = tools.find(t => t.name === 'list_team_activity')!;
      const result = await listTool.handler({ limit: 20 });
      expect(mockDbClient.listRecent).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('results');
    });
  });

  describe('search_by_author', () => {
    it('should call searchByAuthor with author and optional query', async () => {
      mockDbClient.searchByAuthor.mockResolvedValue({
        results: [], total: 0, limit: 20, offset: 0,
      });
      const tools = createTeamTools(mockDbClient as any);
      const searchTool = tools.find(t => t.name === 'search_by_author')!;
      await searchTool.handler({ author: 'eduardo', query: 'meeting' });
      expect(mockDbClient.searchByAuthor).toHaveBeenCalledWith(
        'eduardo', 'meeting',
        expect.objectContaining({ limit: 20, offset: 0 }),
      );
    });

    it('should throw when author is missing', async () => {
      const tools = createTeamTools(mockDbClient as any);
      const searchTool = tools.find(t => t.name === 'search_by_author')!;
      await expect(searchTool.handler({})).rejects.toThrow('author must be a non-empty string');
    });

    it('should throw when author is empty string', async () => {
      const tools = createTeamTools(mockDbClient as any);
      const searchTool = tools.find(t => t.name === 'search_by_author')!;
      await expect(searchTool.handler({ author: '  ' })).rejects.toThrow('author must be a non-empty string');
    });
  });
});
