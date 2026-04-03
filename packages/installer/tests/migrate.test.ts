import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { detectOldInstallation } from '../src/migrate.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('detectOldInstallation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no installation found', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(detectOldInstallation()).toBeNull();
  });

  it('detects old installation by package.json name', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'obsidian_open_brain' }));

    const result = detectOldInstallation();
    expect(result).not.toBeNull();
    expect(result!.dbName).toBe('open_brain');
    expect(result!.dbUser).toBe('obsidian_brain');
  });

  it('returns null if package.json has different name', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'some-other-project' }));

    expect(detectOldInstallation()).toBeNull();
  });

  it('returns null if readFileSync throws', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(detectOldInstallation()).toBeNull();
  });
});
