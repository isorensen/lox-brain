import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isObsidianInstalled } from '../../src/steps/step-obsidian.js';
import { shell } from '../../src/utils/shell.js';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
  getPlatform: vi.fn(),
}));

describe('isObsidianInstalled', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns true when brew list --cask obsidian succeeds (macos)', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: 'obsidian', stderr: '' });
    expect(await isObsidianInstalled('macos')).toBe(true);
    expect(shell).toHaveBeenCalledWith('brew', ['list', '--cask', 'obsidian']);
  });

  it('returns false when brew list --cask obsidian fails (macos)', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('No such cask: obsidian'));
    expect(await isObsidianInstalled('macos')).toBe(false);
  });

  it('returns true when winget list contains Obsidian.Obsidian (windows)', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'Name                        Id                 Version\nObsidian                    Obsidian.Obsidian  1.5.12',
      stderr: '',
    });
    expect(await isObsidianInstalled('windows')).toBe(true);
    expect(shell).toHaveBeenCalledWith('winget', ['list', '--id', 'Obsidian.Obsidian', '-e']);
  });

  it('returns false when winget list does not contain the id (windows)', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'No installed package found matching input criteria.',
      stderr: '',
    });
    expect(await isObsidianInstalled('windows')).toBe(false);
  });

  it('returns false when winget throws (windows)', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('Command not found: winget'));
    expect(await isObsidianInstalled('windows')).toBe(false);
  });

  it('returns true when obsidian is on PATH (linux — AUR/pacman/flatpak)', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: '/usr/bin/obsidian', stderr: '' });
    expect(await isObsidianInstalled('linux')).toBe(true);
    expect(shell).toHaveBeenCalledWith('which', ['obsidian']);
  });

  it('returns true when snap list contains obsidian (linux — snap fallback)', async () => {
    vi.mocked(shell)
      .mockRejectedValueOnce(new Error('not found'))  // which fails
      .mockResolvedValueOnce({
        stdout: 'Name      Version  Rev   Tracking  Publisher  Notes\nobsidian  1.5.12   42    latest/stable  obsidianmd  classic',
        stderr: '',
      });
    expect(await isObsidianInstalled('linux')).toBe(true);
    expect(shell).toHaveBeenCalledWith('snap', ['list', 'obsidian']);
  });

  it('returns false when both which and snap fail (linux)', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('not found'));
    expect(await isObsidianInstalled('linux')).toBe(false);
  });
});
