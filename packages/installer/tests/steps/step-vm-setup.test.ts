import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { existsSync } from 'node:fs';

// Track writeFileSync/unlinkSync calls
const writeFileSyncMock = vi.fn();
const unlinkSyncMock = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
    unlinkSync: (...args: unknown[]) => unlinkSyncMock(...args),
    existsSync: actual.existsSync,
  };
});

// Mock shell utility
vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

// Mock UI modules
vi.mock('../../src/ui/box.js', () => ({
  renderStepHeader: vi.fn(() => ''),
}));

vi.mock('../../src/ui/spinner.js', () => ({
  withSpinner: vi.fn((_msg: string, fn: () => Promise<unknown>) => fn()),
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    yellow: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

// Mock i18n
vi.mock('../../src/i18n/index.js', () => ({
  t: () => ({
    step_postgresql: 'PostgreSQL Setup',
    installing: 'Installing',
    vm_setup_timeout: 'VM setup is taking longer than expected. Continue waiting?',
  }),
}));

// Mock @inquirer/prompts so tests control the confirm response
const confirmMock = vi.fn();
vi.mock('@inquirer/prompts', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

import { shell } from '../../src/utils/shell.js';
import { stepVmSetup } from '../../src/steps/step-vm-setup.js';
import type { InstallerContext } from '../../src/steps/types.js';

const shellMock = shell as Mock;

function makeCtx(overrides: Partial<InstallerContext> = {}): InstallerContext {
  return {
    config: { gcp: { zone: 'us-central1-a' } },
    locale: 'en' as const,
    gcpProjectId: 'test-project',
    gcpUsername: 'test-user',
    ...overrides,
  } as InstallerContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stepVmSetup — early exit', () => {
  it('returns failure when project is not set', async () => {
    const ctx = makeCtx({ gcpProjectId: undefined });
    const result = await stepVmSetup(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('GCP project or zone not set');
  });

  it('returns failure when zone is not set', async () => {
    const ctx = makeCtx({ config: { gcp: { zone: undefined } } } as unknown as Partial<InstallerContext>);
    const result = await stepVmSetup(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('GCP project or zone not set');
  });
});

describe('stepVmSetup — sshExec timeout', () => {
  it('passes 600_000 timeout to shell for the VM setup script', async () => {
    // SSH setup script — succeeds with marker
    shellMock.mockResolvedValueOnce({ stdout: 'VM_SETUP_COMPLETE', stderr: '' });
    // Secret create
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    // First shell call is the SSH setup — verify timeout
    const sshCall = shellMock.mock.calls[0];
    expect(sshCall[0]).toBe('gcloud');
    const args = sshCall[1] as string[];
    expect(args).toContain('--command');
    expect(sshCall[2]).toMatchObject({ timeout: 600_000 });
  });
});

describe('stepVmSetup — Secret Manager uses temp file (no bash)', () => {
  it('writes password to temp file and uses --data-file flag', async () => {
    // SSH setup script — succeeds
    shellMock.mockResolvedValueOnce({ stdout: 'VM_SETUP_COMPLETE', stderr: '' });
    // Secret create
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    // writeFileSync should have been called with a temp file path and mode 0o600
    expect(writeFileSyncMock).toHaveBeenCalledOnce();
    const [tmpPath, content, opts] = writeFileSyncMock.mock.calls[0];
    expect(typeof tmpPath).toBe('string');
    expect(tmpPath).toMatch(/lox-db-pw-/);
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    expect(opts).toMatchObject({ mode: 0o600 });

    // unlinkSync should have been called to clean up
    expect(unlinkSyncMock).toHaveBeenCalledOnce();
    expect(unlinkSyncMock).toHaveBeenCalledWith(tmpPath);

    // The secret version add call should use --data-file, NOT bash
    const secretAddCall = shellMock.mock.calls[2];
    expect(secretAddCall[0]).toBe('gcloud');
    const secretArgs = secretAddCall[1] as string[];
    expect(secretArgs).toContain('secrets');
    expect(secretArgs).toContain('versions');
    expect(secretArgs).toContain('add');
    const dataFileArg = secretArgs.find((a: string) => a.startsWith('--data-file='));
    expect(dataFileArg).toBeDefined();
    expect(dataFileArg).toContain('lox-db-pw-');

    // bash should NEVER be called
    const bashCalls = shellMock.mock.calls.filter(
      (call: unknown[]) => call[0] === 'bash',
    );
    expect(bashCalls).toHaveLength(0);
  });

  it('deletes temp file even when gcloud fails', async () => {
    // SSH setup script — succeeds
    shellMock.mockResolvedValueOnce({ stdout: 'VM_SETUP_COMPLETE', stderr: '' });
    // Secret create — succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add — fails
    shellMock.mockRejectedValueOnce(new Error('gcloud secrets error'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to store DB password in Secret Manager');

    // Temp file must still be cleaned up
    expect(unlinkSyncMock).toHaveBeenCalledOnce();
  });
});

describe('stepVmSetup — error handling', () => {
  it('returns clean error on SSH setup failure', async () => {
    shellMock.mockRejectedValueOnce(new Error('Connection refused\nstack trace line'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('VM setup failed');
    expect(result.message).toContain('Connection refused');
    // No stack trace leakage
    expect(result.message).not.toContain('stack trace line');
  });

  it('returns clean error when setup script does not emit marker', async () => {
    shellMock.mockResolvedValueOnce({ stdout: 'some partial output', stderr: '' });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('VM setup failed');
    expect(result.message).toContain('did not complete successfully');
  });

  it('returns clean error on secret storage failure', async () => {
    // SSH setup — succeeds
    shellMock.mockResolvedValueOnce({ stdout: 'VM_SETUP_COMPLETE', stderr: '' });
    // Secret create — fails with non-ignorable error path
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add — fails
    shellMock.mockRejectedValueOnce(new Error('PERMISSION_DENIED: caller lacks permission\ndetails'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to store DB password');
    expect(result.message).toContain('PERMISSION_DENIED');
    expect(result.message).not.toContain('details');
  });
});

describe('stepVmSetup — full success path', () => {
  it('sets database config on context after success', async () => {
    // SSH setup — succeeds
    shellMock.mockResolvedValueOnce({ stdout: 'VM_SETUP_COMPLETE', stderr: '' });
    // Secret create
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const ctx = makeCtx();
    const result = await stepVmSetup(ctx);

    expect(result.success).toBe(true);
    expect(ctx.config.database).toEqual({
      host: '127.0.0.1',
      port: 5432,
      name: 'lox_brain',
      user: 'lox',
    });
  });
});

describe('stepVmSetup — timeout retry', () => {
  it('prompts user on timeout, retries with doubled timeout, and succeeds', async () => {
    // First SSH call — times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    // Second SSH call — succeeds
    shellMock.mockResolvedValueOnce({ stdout: 'VM_SETUP_COMPLETE', stderr: '' });
    // Secret create
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    confirmMock.mockResolvedValueOnce(true);

    const result = await stepVmSetup(makeCtx());

    expect(result.success).toBe(true);
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ default: true }),
    );

    // Second SSH shell call should use doubled timeout (1_200_000)
    const secondSshCall = shellMock.mock.calls[1];
    expect(secondSshCall[2]).toMatchObject({ timeout: 1_200_000 });
  });

  it('returns clean error when user declines to retry after timeout', async () => {
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    confirmMock.mockResolvedValueOnce(false);

    const result = await stepVmSetup(makeCtx());

    expect(result.success).toBe(false);
    expect(result.message).toContain('VM setup failed');
    expect(result.message).toContain('timed out');
    expect(confirmMock).toHaveBeenCalledOnce();
    // Shell should only have been called once (no retry)
    expect(shellMock).toHaveBeenCalledOnce();
  });

  it('fails immediately without prompting when already at max timeout', async () => {
    // First call at 600_000 — times out; user says yes → retries at 1_200_000
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    confirmMock.mockResolvedValueOnce(true); // first prompt: yes

    // Second call at 1_200_000 (max) — also times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));

    const result = await stepVmSetup(makeCtx());

    expect(result.success).toBe(false);
    expect(result.message).toContain('VM setup failed');
    // Prompt appeared only once (at 600_000); at max timeout no further prompt
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(shellMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT prompt on non-timeout errors', async () => {
    shellMock.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await stepVmSetup(makeCtx());

    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection refused');
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
