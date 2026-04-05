import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildActivationCommand,
  renderActivationResult,
  isWindowsAdmin,
  resolveWireguardExe,
  activateWireGuard,
  WINDOWS_WIREGUARD_CANDIDATES,
  type ActivationResult,
} from '../../src/utils/wireguard-activate.js';
import { shell } from '../../src/utils/shell.js';
import { probeTcp } from '../../src/utils/net-probe.js';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));
vi.mock('../../src/utils/net-probe.js', () => ({
  probeTcp: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// Import after mocks so the mocked `spawn` is what activateWireGuard closes over.
const { spawn: mockedSpawn } = await import('node:child_process');

describe('buildActivationCommand', () => {
  it('emits the Windows service command with a quoted path', () => {
    const cmd = buildActivationCommand('C:\\Users\\alice\\.config\\lox\\wireguard\\wg0.conf', 'win32');
    expect(cmd).toBe('wireguard /installtunnelservice "C:\\Users\\alice\\.config\\lox\\wireguard\\wg0.conf"');
  });

  it('emits sudo wg-quick on macOS', () => {
    const cmd = buildActivationCommand('/Users/alice/.config/lox/wireguard/wg0.conf', 'darwin');
    expect(cmd).toBe('sudo wg-quick up /Users/alice/.config/lox/wireguard/wg0.conf');
  });

  it('emits sudo wg-quick on Linux', () => {
    const cmd = buildActivationCommand('/home/alice/.config/lox/wireguard/wg0.conf', 'linux');
    expect(cmd).toBe('sudo wg-quick up /home/alice/.config/lox/wireguard/wg0.conf');
  });

  it('falls back to sudo wg-quick on unknown Unix platforms', () => {
    // freebsd/openbsd/etc. all ship wg-quick — default to the Unix branch
    // rather than accidentally emitting a Windows command.
    const cmd = buildActivationCommand('/home/alice/wg0.conf', 'freebsd' as NodeJS.Platform);
    expect(cmd).toBe('sudo wg-quick up /home/alice/wg0.conf');
  });
});

describe('isWindowsAdmin', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns false on non-Windows platforms without invoking net.exe', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(await isWindowsAdmin()).toBe(false);
    expect(shell).not.toHaveBeenCalled();
  });

  it('returns true when `net session` succeeds (elevated prompt)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(shell).mockResolvedValue({ stdout: 'There are no entries in the list.', stderr: '' });
    expect(await isWindowsAdmin()).toBe(true);
    expect(shell).toHaveBeenCalledWith('net', ['session'], expect.any(Object));
  });

  it('returns false when `net session` errors (non-elevated prompt)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // net.exe exits non-zero with "Access is denied." when not elevated.
    vi.mocked(shell).mockRejectedValue(new Error('Access is denied.'));
    expect(await isWindowsAdmin()).toBe(false);
  });
});

describe('resolveWireguardExe', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns "wireguard" when `where wireguard` finds the command on PATH', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'C:\\Program Files\\WireGuard\\wireguard.exe',
      stderr: '',
    });
    const resolved = await resolveWireguardExe(WINDOWS_WIREGUARD_CANDIDATES, () => false);
    expect(resolved).toBe('wireguard');
    expect(shell).toHaveBeenCalledWith('where', ['wireguard'], expect.any(Object));
  });

  it('falls back to the Program Files path when `where` fails but the file exists', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('not found'));
    const target = 'C:\\Program Files\\WireGuard\\wireguard.exe';
    const resolved = await resolveWireguardExe([target], (p) => p === target);
    expect(resolved).toBe(target);
  });

  it('returns null when `where` fails and no candidate path exists on disk', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('not found'));
    const resolved = await resolveWireguardExe(
      ['C:\\Program Files\\WireGuard\\wireguard.exe'],
      () => false,
    );
    expect(resolved).toBeNull();
  });

  it('returns null when `where` yields an empty stdout and no candidates exist', async () => {
    // `where` occasionally exits 0 with empty stdout on mismatched locales;
    // treat that as "not found" and fall through to disk probing.
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    const resolved = await resolveWireguardExe([], () => false);
    expect(resolved).toBeNull();
  });
});

describe('renderActivationResult', () => {
  it('renders already-active as a success with the IP', () => {
    const out = renderActivationResult({ kind: 'already-active' }, '10.10.0.1');
    expect(out.level).toBe('success');
    expect(out.lines.join('\n')).toContain('10.10.0.1:22');
    expect(out.lines.join('\n')).toContain('already active');
  });

  it('renders activated as a success', () => {
    const out = renderActivationResult({ kind: 'activated' }, '10.10.0.1');
    expect(out.level).toBe('success');
    expect(out.lines.join('\n')).toContain('VPN activated');
  });

  it('renders needs-admin as a warning including the literal command', () => {
    const result: ActivationResult = {
      kind: 'needs-admin',
      command: 'wireguard /installtunnelservice "C:\\Users\\alice\\wg0.conf"',
    };
    const out = renderActivationResult(result, '10.10.0.1');
    expect(out.level).toBe('warning');
    expect(out.lines.join('\n')).toContain('Administrator');
    expect(out.lines.join('\n')).toContain('wireguard /installtunnelservice');
    expect(out.lines.join('\n')).toContain('C:\\Users\\alice\\wg0.conf');
  });

  it('renders needs-admin with resume-prompt hint so the user knows recovery is supported', () => {
    const result: ActivationResult = { kind: 'needs-admin', command: 'wireguard /installtunnelservice "x"' };
    const out = renderActivationResult(result, '10.10.0.1');
    expect(out.lines.join('\n')).toMatch(/re-run the installer/i);
  });

  it('renders command-failed as a warning with the error and fallback command', () => {
    const result: ActivationResult = {
      kind: 'command-failed',
      command: 'sudo wg-quick up /home/alice/wg0.conf',
      error: 'Operation not permitted',
    };
    const out = renderActivationResult(result, '10.10.0.1');
    expect(out.level).toBe('warning');
    expect(out.lines.join('\n')).toContain('Operation not permitted');
    expect(out.lines.join('\n')).toContain('sudo wg-quick up');
  });

  it('renders activated-but-unreachable as a warning pointing at tunnel diagnostics', () => {
    const result: ActivationResult = {
      kind: 'activated-but-unreachable',
      command: 'sudo wg-quick up /x',
    };
    const out = renderActivationResult(result, '10.10.0.1');
    expect(out.level).toBe('warning');
    expect(out.lines.join('\n')).toMatch(/wg show|tunnel status/i);
  });
});

describe('activateWireGuard', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.mocked(probeTcp).mockReset();
    vi.mocked(shell).mockReset();
    vi.mocked(mockedSpawn).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns already-active when the initial probe succeeds (no activation attempted)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.mocked(probeTcp).mockResolvedValueOnce(true);
    const result = await activateWireGuard('/tmp/wg0.conf', '10.10.0.1');
    expect(result).toEqual({ kind: 'already-active' });
    // Exactly one probe (the initial fast check); no shell invocations.
    expect(probeTcp).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
  });

  it('returns needs-admin on Windows when not elevated (no wireguard binary invoked)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(probeTcp).mockResolvedValueOnce(false); // initial probe: VPN down
    // net session fails → isWindowsAdmin() returns false
    vi.mocked(shell).mockRejectedValueOnce(new Error('Access is denied.'));

    const result = await activateWireGuard('C:\\Users\\alice\\wg0.conf', '10.10.0.1');

    expect(result.kind).toBe('needs-admin');
    if (result.kind === 'needs-admin') {
      expect(result.command).toContain('wireguard /installtunnelservice');
      expect(result.command).toContain('C:\\Users\\alice\\wg0.conf');
    }
    // Only `net session` should have been called — never `wireguard` itself.
    expect(shell).toHaveBeenCalledTimes(1);
    expect(shell).toHaveBeenCalledWith('net', ['session'], expect.any(Object));
  });

  it('returns activated when initial probe fails, unix activation succeeds, and post-probe succeeds', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    // Initial probe: down. Post-activate probe: up on first attempt.
    vi.mocked(probeTcp).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    // Stub out the Unix activation spawn: return a fake child that
    // synchronously emits 'exit 0' once a handler is attached.
    vi.mocked(mockedSpawn).mockImplementation(() => {
      const fakeChild = {
        on: (event: string, cb: (arg: number | Error) => void) => {
          // Defer the exit(0) callback to the next microtask so both
          // `.on('error')` and `.on('exit')` registrations complete first.
          if (event === 'exit') queueMicrotask(() => cb(0));
          return fakeChild;
        },
      } as unknown as ReturnType<typeof mockedSpawn>;
      return fakeChild;
    });

    const result = await activateWireGuard('/home/alice/wg0.conf', '10.10.0.1');
    expect(result).toEqual({ kind: 'activated' });
    expect(mockedSpawn).toHaveBeenCalledWith(
      'sudo',
      ['wg-quick', 'up', '/home/alice/wg0.conf'],
      expect.any(Object),
    );
    expect(probeTcp).toHaveBeenCalledTimes(2);
  });
});
