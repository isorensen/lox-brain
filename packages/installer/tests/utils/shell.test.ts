import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track calls to execFile so we can assert cmd/args without ESM spy issues
const execFileCalls: Array<{ cmd: string; args: string[] }> = [];

// Allows individual tests to override the default success behaviour
type ExecFileCallback = (err: unknown, result?: { stdout: string; stderr: string }) => void;
let execFileImpl: ((cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => void) | null = null;

vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
    execFileCalls.push({ cmd, args });
    if (execFileImpl) {
      execFileImpl(cmd, args, _opts, cb);
    } else {
      cb(null, { stdout: 'mocked output', stderr: '' });
    }
  },
}));

describe('shell() Windows cmd.exe wrapping', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    execFileCalls.length = 0;
    execFileImpl = null;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    vi.resetModules();
  });

  it('wraps commands with cmd.exe /c on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { shell } = await import('../../src/utils/shell.js');
    await shell('gcloud', ['--version']);

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe('cmd.exe');
    expect(execFileCalls[0].args).toEqual(['/c', 'gcloud', '--version']);
  });

  it('does not wrap on darwin', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const { shell } = await import('../../src/utils/shell.js');
    await shell('gcloud', ['--version']);

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe('gcloud');
    expect(execFileCalls[0].args).toEqual(['--version']);
  });

  it('does not wrap on linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const { shell } = await import('../../src/utils/shell.js');
    await shell('node', ['--version']);

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe('node');
    expect(execFileCalls[0].args).toEqual(['--version']);
  });

  it('preserves all arguments when wrapping for Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { shell } = await import('../../src/utils/shell.js');
    await shell('gcloud', ['compute', 'instances', 'list', '--format=json']);

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe('cmd.exe');
    expect(execFileCalls[0].args).toEqual(['/c', 'gcloud', 'compute', 'instances', 'list', '--format=json']);
  });

  it('handles empty args on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { shell } = await import('../../src/utils/shell.js');
    await shell('gcloud');

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe('cmd.exe');
    expect(execFileCalls[0].args).toEqual(['/c', 'gcloud']);
  });

  it('commandExists works through the same wrapping', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { commandExists } = await import('../../src/utils/shell.js');
    const result = await commandExists('gcloud');

    expect(result).toBe(true);
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe('cmd.exe');
    expect(execFileCalls[0].args).toEqual(['/c', 'gcloud', '--version']);
  });

  it('commandExists returns false when cmd.exe stderr contains "is not recognized" on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    execFileImpl = (_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('Command failed'), {
        stderr: "'nonexistent' is not recognized as an internal or external command",
        code: 1,
      });
      cb(err);
    };

    const { commandExists } = await import('../../src/utils/shell.js');
    const result = await commandExists('nonexistent');

    expect(result).toBe(false);
  });

  it('shell() throws "Command not found" when cmd.exe stderr contains "is not recognized" on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    execFileImpl = (_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('Command failed'), {
        stderr: "'missingcmd' is not recognized as an internal or external command",
        code: 1,
      });
      cb(err);
    };

    const { shell } = await import('../../src/utils/shell.js');
    await expect(shell('missingcmd')).rejects.toThrow('Command not found: missingcmd');
  });
});
