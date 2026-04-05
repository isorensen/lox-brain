import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isMcpServerRegistered } from '../../src/steps/step-mcp.js';
import { shell } from '../../src/utils/shell.js';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

describe('isMcpServerRegistered', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns true when the server name appears in claude mcp list', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'lox-brain: ssh lox-vm cd /home/lox/lox-brain && node ...\nother: node foo.js',
      stderr: '',
    });
    expect(await isMcpServerRegistered('lox-brain')).toBe(true);
  });

  it('returns false when the server name is not present', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'other-server: node foo.js\nanother: node bar.js',
      stderr: '',
    });
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });

  it('returns false when claude mcp list is empty', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });

  it('does not false-positive on a name that contains the target as a substring', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'lox-brain-staging: node foo.js',
      stderr: '',
    });
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });

  it('returns false when claude mcp list throws', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('claude: command not found'));
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });
});
