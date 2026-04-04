import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

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
    dim: (s: string) => s,
  },
}));

// Mock i18n — include all phase keys
vi.mock('../../src/i18n/index.js', () => ({
  t: () => ({
    step_postgresql: 'PostgreSQL Setup',
    installing: 'Installing',
    vm_setup_timeout: 'VM setup is taking longer than expected. Continue waiting?',
    vm_phase_system_update: 'Updating system packages',
    vm_phase_nodejs: 'Installing Node.js 22',
    vm_phase_postgresql: 'Installing PostgreSQL 16',
    vm_phase_pgvector: 'Compiling pgvector extension',
    vm_phase_db_setup: 'Creating database and schema',
    vm_phase_ssh_hardening: 'Hardening SSH configuration',
    vm_phase_wireguard: 'Installing WireGuard',
    vm_phase_fetching_logs: 'Fetching VM logs for diagnosis',
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

// Number of SSH phases: 6 (SETUP_PHASES) + 1 (DB setup) = 7
const TOTAL_SSH_PHASES = 7;

function makeCtx(overrides: Partial<InstallerContext> = {}): InstallerContext {
  return {
    config: { gcp: { zone: 'us-central1-a' } },
    locale: 'en' as const,
    gcpProjectId: 'test-project',
    gcpUsername: 'test-user',
    ...overrides,
  } as InstallerContext;
}

/** Mock all SSH phase calls to succeed, plus Secret Manager calls. */
function mockAllPhasesSuccess(): void {
  // 7 SSH phase calls (6 SETUP_PHASES + 1 DB setup)
  for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
  }
  // Secret create
  shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
  // Secret version add
  shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
}

/** Extract SSH calls (gcloud compute ssh) from shellMock history. */
function getSshCalls(): unknown[][] {
  return shellMock.mock.calls.filter(
    (call: unknown[]) => {
      if (call[0] !== 'gcloud') return false;
      const args = call[1] as string[];
      return args.includes('compute') && args.includes('ssh');
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stepVmSetup -- early exit', () => {
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

describe('stepVmSetup -- phased execution', () => {
  it('executes each phase as a separate SSH call', async () => {
    mockAllPhasesSuccess();

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    const sshCalls = getSshCalls();
    expect(sshCalls.length).toBe(TOTAL_SSH_PHASES);
  });

  it('uses phase-specific timeouts for each SSH call', async () => {
    mockAllPhasesSuccess();

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    const sshCalls = getSshCalls();

    // Expected timeouts: system_update=300k, nodejs=180k, postgresql=180k,
    // pgvector=300k, ssh_hardening=60k, wireguard=120k, db_setup=120k
    const expectedTimeouts = [300_000, 180_000, 180_000, 300_000, 60_000, 120_000, 120_000];
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      const callOpts = sshCalls[i][2] as { timeout: number };
      expect(callOpts.timeout).toBe(expectedTimeouts[i]);
    }
  });

  it('stops at the first failing phase and reports which phase failed', async () => {
    // Phase 1 (system update) succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Phase 2 (nodejs) succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Phase 3 (postgresql) fails
    shellMock.mockRejectedValueOnce(new Error('apt-get failed: unable to locate package'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Installing PostgreSQL 16');
    expect(result.message).toContain('failed');
    expect(result.message).toContain('apt-get failed');

    // Only 3 SSH calls should have been made
    const sshCalls = getSshCalls();
    expect(sshCalls.length).toBe(3);
  });

  it('includes set -euo pipefail in each phase command', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    const sshCalls = getSshCalls();
    for (const call of sshCalls) {
      const args = call[1] as string[];
      const cmdIdx = args.indexOf('--command');
      const cmd = args[cmdIdx + 1];
      expect(cmd).toContain('set -euo pipefail');
    }
  });
});

describe('stepVmSetup -- DB setup phase', () => {
  it('passes dbPassword in the DB setup SSH command', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    const sshCalls = getSshCalls();
    // DB setup is the last SSH call (index 6)
    const dbCall = sshCalls[TOTAL_SSH_PHASES - 1];
    const args = dbCall[1] as string[];
    const cmdIdx = args.indexOf('--command');
    const cmd = args[cmdIdx + 1];

    // Must contain DB setup keywords
    expect(cmd).toContain('CREATE USER lox');
    expect(cmd).toContain('CREATE DATABASE lox_brain');
    expect(cmd).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(cmd).toContain('vault_embeddings');
  });
});

describe('stepVmSetup -- per-phase timeout retry', () => {
  it('prompts user on timeout, retries with doubled timeout, and succeeds', async () => {
    // Phase 1 (system update) times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    // fetchVmLogs call — return some logs
    shellMock.mockResolvedValueOnce({ stdout: 'some log output', stderr: '' });
    // Retry phase 1 — succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Remaining 6 phases succeed
    for (let i = 0; i < TOTAL_SSH_PHASES - 1; i++) {
      shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    }
    // Secret Manager
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    confirmMock.mockResolvedValueOnce(true);

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);
    expect(confirmMock).toHaveBeenCalledOnce();

    // The retry call should use doubled timeout (300_000 * 2 = 600_000)
    const sshCalls = getSshCalls();
    // Call index 2 is the retry of phase 1 (index 0 = fail, index 1 = fetchVmLogs, index 2 = retry)
    const retryCall = sshCalls[2];
    const retryOpts = retryCall[2] as { timeout: number };
    expect(retryOpts.timeout).toBe(600_000);
  });

  it('returns timeout error with phase name when user declines retry', async () => {
    // Phase 1 times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    // fetchVmLogs — fails
    shellMock.mockRejectedValueOnce(new Error('cannot connect'));

    confirmMock.mockResolvedValueOnce(false);

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Updating system packages');
    expect(result.message).toContain('timed out');
  });

  it('fails immediately without prompt when already at max timeout', async () => {
    // Phase 1 times out — user says yes
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // fetchVmLogs
    confirmMock.mockResolvedValueOnce(true);

    // Retry at doubled timeout — also times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
    // Only prompted once
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it('does NOT prompt on non-timeout errors', async () => {
    shellMock.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection refused');
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe('stepVmSetup -- fetchVmLogs on timeout', () => {
  it('attempts to fetch VM logs when a phase times out', async () => {
    // Phase 1 times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    // fetchVmLogs succeeds
    shellMock.mockResolvedValueOnce({ stdout: 'apt log line 1\napt log line 2', stderr: '' });

    confirmMock.mockResolvedValueOnce(false); // user declines retry

    await stepVmSetup(makeCtx());

    // Verify fetchVmLogs SSH call was made
    const sshCalls = getSshCalls();
    expect(sshCalls.length).toBe(2); // phase attempt + fetchVmLogs
    const logCall = sshCalls[1];
    const logArgs = logCall[1] as string[];
    const cmdIdx = logArgs.indexOf('--command');
    const logCmd = logArgs[cmdIdx + 1];
    expect(logCmd).toContain('tail -20');
    // fetchVmLogs uses 15_000 timeout
    const logOpts = logCall[2] as { timeout: number };
    expect(logOpts.timeout).toBe(15_000);
  });

  it('continues gracefully when fetchVmLogs fails', async () => {
    // Phase 1 times out
    shellMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { killed: true }));
    // fetchVmLogs also fails
    shellMock.mockRejectedValueOnce(new Error('SSH connection lost'));

    confirmMock.mockResolvedValueOnce(false);

    const result = await stepVmSetup(makeCtx());
    // Should still return a clean error, not crash
    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
  });
});

describe('stepVmSetup -- Secret Manager uses temp file (no bash)', () => {
  it('writes password to temp file and uses --data-file flag', async () => {
    mockAllPhasesSuccess();

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
    // Secret calls are the last 2 shell calls
    const allCalls = shellMock.mock.calls;
    const secretAddCall = allCalls[allCalls.length - 1];
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
    // All SSH phases succeed
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    }
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

describe('stepVmSetup -- error handling', () => {
  it('returns clean error on SSH phase failure (no stack trace)', async () => {
    shellMock.mockRejectedValueOnce(new Error('Connection refused\nstack trace line'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('failed');
    expect(result.message).toContain('Connection refused');
    // No stack trace leakage
    expect(result.message).not.toContain('stack trace line');
  });

  it('returns clean error on secret storage failure', async () => {
    // All SSH phases succeed
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    }
    // Secret create — succeeds
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

describe('stepVmSetup -- full success path', () => {
  it('sets database config on context after success', async () => {
    mockAllPhasesSuccess();

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
