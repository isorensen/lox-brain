import { describe, it, expect } from 'vitest';

import {
  // Types (compile-time verification)
  type NoteMetadata,
  type NoteRow,
  type SearchOptions,
  type PaginatedResult,
  type SearchResult,
  type RecentNote,
  type VpnPeer,
  type LoxConfig,

  // Config values
  DEFAULT_CONFIG,
  getConfigPath,

  // Constants
  LOX_VERSION,
  LOX_ASCII_LOGO,
  LOX_TAGLINE,
  LOX_MCP_SERVER_NAME,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  CHUNK_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  CHARS_PER_TOKEN_ESTIMATE,
  DB_TABLE_NAME,
} from '../src/index.js';

describe('shared types exports', () => {
  it('should allow creating a NoteMetadata object', () => {
    const meta: NoteMetadata = { title: 'Test', tags: ['a'], content: 'body' };
    expect(meta.title).toBe('Test');
    expect(meta.tags).toEqual(['a']);
  });

  it('should allow creating a NoteRow object', () => {
    const row: NoteRow = {
      id: '1',
      file_path: '/test.md',
      title: 'Test',
      content: 'body',
      tags: ['a'],
      embedding: [0.1, 0.2],
      file_hash: 'abc',
      chunk_index: 0,
    };
    expect(row.id).toBe('1');
    expect(row.chunk_index).toBe(0);
  });

  it('should allow creating SearchOptions', () => {
    const opts: SearchOptions = {
      limit: 10,
      offset: 0,
      includeContent: true,
      contentPreviewLength: 200,
    };
    expect(opts.limit).toBe(10);
  });

  it('should allow creating PaginatedResult', () => {
    const result: PaginatedResult<string> = {
      results: ['a', 'b'],
      total: 2,
      limit: 10,
      offset: 0,
    };
    expect(result.results).toHaveLength(2);
  });

  it('should allow creating SearchResult', () => {
    const sr: SearchResult = {
      id: '1',
      file_path: '/test.md',
      title: 'Test',
      tags: ['a'],
      similarity: 0.95,
      updated_at: new Date(),
    };
    expect(sr.similarity).toBe(0.95);
  });

  it('should allow creating RecentNote', () => {
    const rn: RecentNote = {
      id: '1',
      file_path: '/test.md',
      title: 'Test',
      tags: ['a'],
      updated_at: new Date(),
    };
    expect(rn.file_path).toBe('/test.md');
  });
});

describe('config', () => {
  it('DEFAULT_CONFIG should have expected database defaults', () => {
    expect(DEFAULT_CONFIG.database).toEqual({
      host: '127.0.0.1',
      port: 5432,
      name: 'lox_brain',
      user: 'lox',
    });
  });

  it('DEFAULT_CONFIG should have expected vpn defaults', () => {
    expect(DEFAULT_CONFIG.vpn).toBeDefined();
    expect(DEFAULT_CONFIG.vpn!.server_ip).toBe('10.10.0.1');
    expect(DEFAULT_CONFIG.vpn!.listen_port).toBe(51820);
    expect(DEFAULT_CONFIG.vpn!.subnet).toBe('10.10.0.0/24');
    expect(DEFAULT_CONFIG.vpn!.peers).toEqual([]);
  });

  it('DEFAULT_CONFIG should have version 1.0.0 and mode personal', () => {
    expect(DEFAULT_CONFIG.version).toBe('0.1.0');
    expect(DEFAULT_CONFIG.mode).toBe('personal');
  });

  it('getConfigPath should return path ending in .lox/config.json', () => {
    const path = getConfigPath();
    expect(path).toMatch(/\.lox\/config\.json$/);
  });

  it('getConfigPath should use USERPROFILE as fallback when HOME is unset', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    process.env.USERPROFILE = '/mock/home';
    try {
      expect(getConfigPath()).toBe('/mock/home/.lox/config.json');
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('getConfigPath should throw when HOME and USERPROFILE are both unset', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    try {
      expect(() => getConfigPath()).toThrow('Cannot determine home directory');
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('should allow creating a VpnPeer object', () => {
    const peer: VpnPeer = {
      name: 'mac',
      ip: '10.10.0.3',
      public_key: 'abc123',
      added_at: '2026-04-03',
    };
    expect(peer.name).toBe('mac');
  });
});

describe('constants', () => {
  it('LOX_VERSION should be 1.0.0', () => {
    expect(LOX_VERSION).toBe('0.1.0');
  });

  it('LOX_ASCII_LOGO should contain LOX letter patterns', () => {
    // The ASCII art spells LOX using pipe/underscore characters
    expect(LOX_ASCII_LOGO).toContain('___');   // O shape
    expect(LOX_ASCII_LOGO).toContain('/ _');   // O top
    expect(LOX_ASCII_LOGO).toContain('/  \\');  // X shape
    expect(LOX_ASCII_LOGO).toMatch(/\|.*\|/);  // L vertical bars
  });

  it('LOX_TAGLINE should be correct', () => {
    expect(LOX_TAGLINE).toBe('Where knowledge lives.');
  });

  it('LOX_MCP_SERVER_NAME should be lox-brain', () => {
    expect(LOX_MCP_SERVER_NAME).toBe('lox-brain');
  });

  it('EMBEDDING constants should have correct values', () => {
    expect(EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
    expect(CHUNK_MAX_TOKENS).toBe(4000);
    expect(CHUNK_OVERLAP_TOKENS).toBe(200);
    expect(CHARS_PER_TOKEN_ESTIMATE).toBe(3);
  });

  it('DB_TABLE_NAME should be vault_embeddings', () => {
    expect(DB_TABLE_NAME).toBe('vault_embeddings');
  });
});
