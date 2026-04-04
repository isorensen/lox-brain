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

// Mock execSync from node:child_process
const execSyncMock = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: (...args: unknown[]) => execSyncMock(...args),
  };
});

// Mock shell utility (still used for Secret Manager calls)
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
    vm_ssh_warmup: 'Establishing SSH connection to VM',
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

// --------------------------------------------------------------------------
// Helpers to classify execSync calls
// --------------------------------------------------------------------------

/** Check if an execSync call is the SSH warm-up. */
function isWarmupCall(cmd: string): boolean {
  return cmd.includes('compute ssh') && cmd.includes('--command=true');
}

/** Check if an execSync call is an SCP upload. */
function isScpCall(cmd: string): boolean {
  return cmd.includes('compute scp');
}

/** Check if an execSync call is an SSH execution (phase script or simple command). */
function isSshExecCall(cmd: string): boolean {
  return cmd.includes('compute ssh') && !isWarmupCall(cmd);
}

/** Check if an execSync call is a fetchVmLogs SSH call. */
function isFetchLogsCall(cmd: string): boolean {
  return isSshExecCall(cmd) && cmd.includes('tail -20');
}

/** Get all execSync calls that are SCP uploads. */
function getScpCalls(): Array<[string, Record<string, unknown>]> {
  return execSyncMock.mock.calls.filter(
    (call: unknown[]) => isScpCall(call[0] as string),
  ) as Array<[string, Record<string, unknown>]>;
}

/** Get all execSync calls that are SSH executions (excluding warm-up). */
function getSshExecCalls(): Array<[string, Record<string, unknown>]> {
  return execSyncMock.mock.calls.filter(
    (call: unknown[]) => isSshExecCall(call[0] as string),
  ) as Array<[string, Record<string, unknown>]>;
}

/**
 * Mock all phases to succeed.
 * Pattern per phase: SCP upload (returns undefined) + SSH exec (returns '').
 * Plus warm-up at the start and Secret Manager at the end.
 */
function mockAllPhasesSuccess(): void {
  // Warm-up call (stdio: inherit, returns undefined)
  execSyncMock.mockReturnValueOnce(undefined);

  // 7 phases: each needs SCP + SSH exec
  for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
    execSyncMock.mockReturnValueOnce(undefined); // SCP upload
    execSyncMock.mockReturnValueOnce('');         // SSH exec
  }

  // Secret Manager (still uses shell())
  shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // create
  shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // version add
}

/**
 * Mock warm-up success + N phase successes.
 */
function mockWarmupAndPhases(n: number): void {
  // Warm-up
  execSyncMock.mockReturnValueOnce(undefined);
  // N phases
  for (let i = 0; i < n; i++) {
    execSyncMock.mockReturnValueOnce(undefined); // SCP
    execSyncMock.mockReturnValueOnce('');         // SSH exec
  }
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

describe('stepVmSetup -- SSH warm-up', () => {
  it('calls sshWarmup with stdio inherit before phases', async () => {
    mockAllPhasesSuccess();

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    // First execSync call should be the warm-up
    const firstCall = execSyncMock.mock.calls[0];
    const cmd = firstCall[0] as string;
    expect(isWarmupCall(cmd)).toBe(true);
    expect(cmd).toContain('--quiet');
    expect(cmd).toContain('strict-host-key-checking=no');

    // Warm-up uses inherited stdin/stdout + piped stderr for error capture
    const opts = firstCall[1] as Record<string, unknown>;
    expect(opts.stdio).toEqual(['inherit', 'inherit', 'pipe']);
  });

  it('returns failure when warm-up fails', async () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('SSH key generation failed');
    });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('SSH warm-up failed');
    expect(result.message).toContain('SSH key generation failed');
  });

  it('extracts gcloud stderr from warm-up error when available', async () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: Buffer.from('ERROR: (gcloud.compute.ssh) unrecognized arguments: ok\n'),
    });
    execSyncMock.mockImplementationOnce(() => { throw err; });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('SSH warm-up failed');
    expect(result.message).toContain('ERROR: (gcloud.compute.ssh) unrecognized arguments: ok');
    // Should NOT contain the generic Node wrapper
    expect(result.message).not.toContain('Command failed');
  });

  it('falls back to err.message when stderr is empty', async () => {
    const err = Object.assign(new Error('Connection reset by peer'), {
      stderr: Buffer.from(''),
    });
    execSyncMock.mockImplementationOnce(() => { throw err; });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection reset by peer');
  });

  it('falls back to first stderr line when no ERROR: prefix', async () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: Buffer.from('WARNING: something went wrong\ndetail line'),
    });
    execSyncMock.mockImplementationOnce(() => { throw err; });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('WARNING: something went wrong');
    expect(result.message).not.toContain('detail line');
  });
});

describe('stepVmSetup -- phased execution via SCP', () => {
  it('executes each phase as SCP upload + SSH exec', async () => {
    mockAllPhasesSuccess();

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    const scpCalls = getScpCalls();
    const sshCalls = getSshExecCalls();
    expect(scpCalls.length).toBe(TOTAL_SSH_PHASES);
    expect(sshCalls.length).toBe(TOTAL_SSH_PHASES);
  });

  it('writes script to temp file before SCP upload', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    // writeFileSync is called for each phase script + 1 for Secret Manager temp file
    // 7 phases + 1 secret = 8 calls
    expect(writeFileSyncMock).toHaveBeenCalledTimes(TOTAL_SSH_PHASES + 1);

    // First 7 calls are phase scripts with mode 0o700
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      const call = writeFileSyncMock.mock.calls[i];
      const [path, content, opts] = call;
      expect(path).toContain('lox-ssh-');
      expect(typeof content).toBe('string');
      expect(content).toContain('set -euo pipefail');
      expect(opts).toMatchObject({ mode: 0o700 });
    }
  });

  it('cleans up local temp files after each phase', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    // unlinkSync called for each phase script (7) + 1 for Secret Manager temp file
    expect(unlinkSyncMock).toHaveBeenCalledTimes(TOTAL_SSH_PHASES + 1);
  });

  it('includes --quiet and StrictHostKeyChecking in SSH args', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    const sshCalls = getSshExecCalls();
    for (const call of sshCalls) {
      const cmd = call[0] as string;
      expect(cmd).toContain('--quiet');
      expect(cmd).toContain('strict-host-key-checking=no');
    }
  });

  it('uses phase-specific timeouts for SSH exec calls', async () => {
    mockAllPhasesSuccess();

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    const sshCalls = getSshExecCalls();

    // Expected timeouts: system_update=300k, nodejs=180k, postgresql=180k,
    // pgvector=300k, ssh_hardening=60k, wireguard=120k, db_setup=120k
    const expectedTimeouts = [300_000, 180_000, 180_000, 300_000, 60_000, 120_000, 120_000];
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      const opts = sshCalls[i][1] as { timeout: number };
      expect(opts.timeout).toBe(expectedTimeouts[i]);
    }
  });

  it('stops at the first failing phase and reports which phase failed', async () => {
    // Warm-up succeeds
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 (system update) - SCP + SSH succeed
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockReturnValueOnce('');
    // Phase 2 (nodejs) - SCP + SSH succeed
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockReturnValueOnce('');
    // Phase 3 (postgresql) - SCP succeeds, SSH fails
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('apt-get failed: unable to locate package');
    });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Installing PostgreSQL 16');
    expect(result.message).toContain('failed');
    expect(result.message).toContain('apt-get failed');
  });

  it('wraps --command value in double quotes for shell safety', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    const sshCalls = getSshExecCalls();
    for (const call of sshCalls) {
      const cmd = call[0] as string;
      // --command value must be wrapped in double quotes to prevent shell splitting
      expect(cmd).toMatch(/--command="[^"]+"/);
    }
  });

  it('includes set -euo pipefail in each phase script', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    // Check writeFileSync calls for phase scripts
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      const content = writeFileSyncMock.mock.calls[i][1] as string;
      expect(content).toContain('set -euo pipefail');
    }
  });
});

describe('stepVmSetup -- DB setup phase', () => {
  it('passes dbPassword in the DB setup script', async () => {
    mockAllPhasesSuccess();

    await stepVmSetup(makeCtx());

    // DB setup is the 7th phase script (index 6)
    const dbScriptContent = writeFileSyncMock.mock.calls[TOTAL_SSH_PHASES - 1][1] as string;
    expect(dbScriptContent).toContain('CREATE USER lox');
    expect(dbScriptContent).toContain('CREATE DATABASE lox_brain');
    expect(dbScriptContent).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(dbScriptContent).toContain('vault_embeddings');
  });
});

describe('stepVmSetup -- per-phase timeout retry', () => {
  it('prompts user on timeout, retries with doubled timeout, and succeeds', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP succeeds
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SSH exec times out
    execSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('timed out'), { killed: true });
    });
    // fetchVmLogs — sshExec for simple command (no SCP)
    execSyncMock.mockReturnValueOnce('some log output');
    // Retry phase 1 SCP + SSH succeed
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockReturnValueOnce('');
    // Remaining 6 phases (SCP + SSH each)
    for (let i = 0; i < TOTAL_SSH_PHASES - 1; i++) {
      execSyncMock.mockReturnValueOnce(undefined);
      execSyncMock.mockReturnValueOnce('');
    }
    // Secret Manager
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    confirmMock.mockResolvedValueOnce(true);

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);
    expect(confirmMock).toHaveBeenCalledOnce();

    // Verify the retry SSH exec call uses doubled timeout (300_000 * 2 = 600_000)
    // Find the SSH exec calls for phase 1 (the retry)
    const sshExecCalls = getSshExecCalls();
    // First SSH exec is the failed one, second is fetchVmLogs, third is the retry
    const retryCall = sshExecCalls[2];
    const retryOpts = retryCall[1] as { timeout: number };
    expect(retryOpts.timeout).toBe(600_000);
  });

  it('returns timeout error with phase name when user declines retry', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP succeeds
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SSH exec times out
    execSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('timed out'), { killed: true });
    });
    // fetchVmLogs fails
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('cannot connect');
    });

    confirmMock.mockResolvedValueOnce(false);

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Updating system packages');
    expect(result.message).toContain('timed out');
  });

  it('fails immediately without prompt when already at max timeout', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP + SSH timeout
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('timed out'), { killed: true });
    });
    // fetchVmLogs
    execSyncMock.mockReturnValueOnce('');
    confirmMock.mockResolvedValueOnce(true);

    // Retry at doubled timeout — SCP succeeds, SSH also times out
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('timed out'), { killed: true });
    });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
    // Only prompted once
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it('does NOT prompt on non-timeout errors', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP succeeds, SSH fails with non-timeout error
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('Connection refused');
    });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection refused');
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe('stepVmSetup -- fetchVmLogs on timeout', () => {
  it('attempts to fetch VM logs when a phase times out', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP succeeds, SSH times out
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('timed out'), { killed: true });
    });
    // fetchVmLogs succeeds (uses sshExecScript: SCP upload + SSH exec)
    execSyncMock.mockReturnValueOnce(undefined); // SCP upload
    execSyncMock.mockReturnValueOnce('apt log line 1\napt log line 2'); // SSH exec

    confirmMock.mockResolvedValueOnce(false);

    await stepVmSetup(makeCtx());

    // Verify fetchVmLogs used sshExecScript (SCP + SSH exec)
    // The last two execSync calls should be from fetchVmLogs:
    //   [n-2] SCP upload of the log script
    //   [n-1] SSH exec with 15_000 timeout
    const allCalls = execSyncMock.mock.calls;
    const lastSshCall = allCalls[allCalls.length - 1];
    expect(lastSshCall).toBeDefined();
    const logOpts = lastSshCall![1] as { timeout: number };
    expect(logOpts.timeout).toBe(15_000);
  });

  it('continues gracefully when fetchVmLogs fails', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP succeeds, SSH times out
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('timed out'), { killed: true });
    });
    // fetchVmLogs also fails (SCP upload fails)
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('SSH connection lost');
    });
    // Note: SSH exec won't be called since SCP failed

    confirmMock.mockResolvedValueOnce(false);

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
  });
});

describe('stepVmSetup -- Secret Manager uses temp file (no bash)', () => {
  it('writes password to temp file and uses --data-file flag', async () => {
    mockAllPhasesSuccess();

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(true);

    // The last writeFileSync call is for the Secret Manager temp file
    const secretCall = writeFileSyncMock.mock.calls[TOTAL_SSH_PHASES];
    const [tmpPath, content, opts] = secretCall;
    expect(typeof tmpPath).toBe('string');
    expect(tmpPath).toMatch(/lox-db-pw-/);
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    expect(opts).toMatchObject({ mode: 0o600 });

    // unlinkSync should clean up the secret temp file
    const secretUnlinkCall = unlinkSyncMock.mock.calls[TOTAL_SSH_PHASES];
    expect(secretUnlinkCall[0]).toBe(tmpPath);

    // The secret version add call should use --data-file, NOT bash
    const allShellCalls = shellMock.mock.calls;
    const secretAddCall = allShellCalls[allShellCalls.length - 1];
    expect(secretAddCall[0]).toBe('gcloud');
    const secretArgs = secretAddCall[1] as string[];
    expect(secretArgs).toContain('secrets');
    expect(secretArgs).toContain('versions');
    expect(secretArgs).toContain('add');
    const dataFileArg = secretArgs.find((a: string) => a.startsWith('--data-file='));
    expect(dataFileArg).toBeDefined();
    expect(dataFileArg).toContain('lox-db-pw-');

    // bash should NEVER be called via shell()
    const bashCalls = shellMock.mock.calls.filter(
      (call: unknown[]) => call[0] === 'bash',
    );
    expect(bashCalls).toHaveLength(0);
  });

  it('deletes temp file even when gcloud fails', async () => {
    // Warm-up + all phases succeed
    execSyncMock.mockReturnValueOnce(undefined);
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      execSyncMock.mockReturnValueOnce(undefined);
      execSyncMock.mockReturnValueOnce('');
    }
    // Secret create — succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Secret version add — fails
    shellMock.mockRejectedValueOnce(new Error('gcloud secrets error'));

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to store DB password in Secret Manager');

    // Secret Manager temp file must still be cleaned up
    // It's the last unlinkSync call
    const secretUnlinks = unlinkSyncMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes('lox-db-pw-'),
    );
    expect(secretUnlinks.length).toBe(1);
  });
});

describe('stepVmSetup -- error handling', () => {
  it('returns clean error on SSH phase failure (no stack trace)', async () => {
    // Warm-up
    execSyncMock.mockReturnValueOnce(undefined);
    // Phase 1 SCP + SSH fail
    execSyncMock.mockReturnValueOnce(undefined);
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('Connection refused\nstack trace line');
    });

    const result = await stepVmSetup(makeCtx());
    expect(result.success).toBe(false);
    expect(result.message).toContain('failed');
    expect(result.message).toContain('Connection refused');
    // No stack trace leakage
    expect(result.message).not.toContain('stack trace line');
  });

  it('returns clean error on secret storage failure', async () => {
    // Warm-up + all phases
    execSyncMock.mockReturnValueOnce(undefined);
    for (let i = 0; i < TOTAL_SSH_PHASES; i++) {
      execSyncMock.mockReturnValueOnce(undefined);
      execSyncMock.mockReturnValueOnce('');
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
