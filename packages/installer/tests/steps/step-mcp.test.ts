import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isMcpServerRegistered, buildMcpLauncherScript } from '../../src/steps/step-mcp.js';
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

describe('buildMcpLauncherScript', () => {
  it('starts with a bash shebang and fail-fast flags', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    const lines = script.split('\n');
    expect(lines[0]).toBe('#!/bin/bash');
    expect(lines[1]).toBe('set -euo pipefail');
  });

  it('cds into the provided install dir verbatim', () => {
    expect(buildMcpLauncherScript('/opt/lox')).toContain('cd /opt/lox\n');
    expect(buildMcpLauncherScript('/home/alice/lox-brain')).toContain('cd /home/alice/lox-brain\n');
  });

  it('loads secrets.env with set -a / set +a', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    expect(script).toContain('set -a');
    expect(script).toContain('source /etc/lox/secrets.env');
    expect(script).toContain('set +a');
  });

  it('execs node on the MCP entrypoint (replaces the shell)', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    expect(script).toContain('exec node packages/core/dist/mcp/index.js');
  });

  it('ends with a trailing newline', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    expect(script.endsWith('\n')).toBe(true);
  });
});
