import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock shell utility
vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

// Mock UI modules (they use terminal features not available in tests)
vi.mock('../../src/ui/box.js', () => ({
  renderStepHeader: vi.fn(() => ''),
}));

vi.mock('../../src/ui/spinner.js', () => ({
  withSpinner: vi.fn((_msg: string, fn: () => Promise<unknown>) => fn()),
}));

// Mock chalk to pass-through
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
    step_vm_instance: 'VM Instance',
    creating: 'Creating',
  }),
}));

import { shell } from '../../src/utils/shell.js';
import { stepVm } from '../../src/steps/step-vm.js';
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
  // Use fake timers so setTimeout resolves instantly
  vi.useFakeTimers();
});

/**
 * Helper: advances all pending timers and microtasks so withRetry delays
 * and the propagation delay resolve immediately.
 */
async function flushTimers(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe('stepVm — early exit', () => {
  it('returns failure when project is not set', async () => {
    vi.useRealTimers();
    const ctx = makeCtx({ gcpProjectId: undefined });
    const result = await stepVm(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('GCP project or zone not set');
  });

  it('returns failure when zone is not set', async () => {
    vi.useRealTimers();
    const ctx = makeCtx({ config: { gcp: { zone: undefined } } } as unknown as Partial<InstallerContext>);
    const result = await stepVm(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('GCP project or zone not set');
  });
});

describe('stepVm — IAM binding args (no --condition=None)', () => {
  it('does not pass --condition=None in gcloud IAM binding args', async () => {
    // saExists — SA already exists
    shellMock.mockResolvedValueOnce({ stdout: 'lox-vm-sa@test-project.iam.gserviceaccount.com', stderr: '' });
    // IAM binding: secretmanager.secretAccessor
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // IAM binding: logging.logWriter
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // vmExists — VM already exists
    shellMock.mockResolvedValueOnce({ stdout: 'lox-vm', stderr: '' });

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(true);

    // Find IAM binding calls
    const iamCalls = shellMock.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('add-iam-policy-binding'),
    );
    expect(iamCalls).toHaveLength(2);

    for (const call of iamCalls) {
      const args = call[1] as string[];
      expect(args).not.toContain('--condition=None');
      expect(args).toContain('--member=serviceAccount:lox-vm-sa@test-project.iam.gserviceaccount.com');
    }

    // Verify the two roles
    expect((iamCalls[0][1] as string[]).find((a: string) => a.startsWith('--role='))).toBe(
      '--role=roles/secretmanager.secretAccessor',
    );
    expect((iamCalls[1][1] as string[]).find((a: string) => a.startsWith('--role='))).toBe(
      '--role=roles/logging.logWriter',
    );
  });
});

describe('stepVm — IAM binding retry on propagation delay', () => {
  it('retries IAM binding when SA "does not exist" and succeeds on retry', async () => {
    // saExists — SA does not exist
    shellMock.mockRejectedValueOnce(new Error('not found'));
    // SA create
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // IAM binding: first attempt fails with "does not exist"
    shellMock.mockRejectedValueOnce(new Error('Service account does not exist'));
    // IAM binding: second attempt succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // IAM binding: logWriter — succeeds first try
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // vmExists — VM already exists
    shellMock.mockResolvedValueOnce({ stdout: 'lox-vm', stderr: '' });

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(true);

    // The IAM binding should have been called 3 times total (1 retry + 1 success + 1 for second role)
    const iamCalls = shellMock.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('add-iam-policy-binding'),
    );
    expect(iamCalls).toHaveLength(3);
  });

  it('returns clean error after max retries on "does not exist"', async () => {
    // saExists — SA already exists
    shellMock.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // IAM binding: all 3 attempts fail with "does not exist"
    shellMock.mockRejectedValueOnce(new Error('Service account does not exist'));
    shellMock.mockRejectedValueOnce(new Error('Service account does not exist'));
    shellMock.mockRejectedValueOnce(new Error('Service account does not exist'));

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to grant IAM role');
    expect(result.message).toContain('does not exist');
    // No raw stack trace — message is single line
    expect(result.message).not.toContain('\n');
  });

  it('does not retry on non-matching errors (e.g. permission denied)', async () => {
    // saExists — SA already exists
    shellMock.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // IAM binding: fails with permission denied (should NOT retry)
    shellMock.mockRejectedValueOnce(new Error('PERMISSION_DENIED: caller lacks permission'));

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to grant IAM role');
    expect(result.message).toContain('PERMISSION_DENIED');

    // Only 1 IAM binding attempt (no retries)
    const iamCalls = shellMock.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('add-iam-policy-binding'),
    );
    expect(iamCalls).toHaveLength(1);
  });
});

describe('stepVm — VM creation error handling', () => {
  it('passes 120s timeout to shell for VM creation', async () => {
    // saExists — SA already exists
    shellMock.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // IAM bindings succeed
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // vmExists — VM does not exist
    shellMock.mockRejectedValueOnce(new Error('not found'));
    // VM create — succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(true);

    // Find the VM creation call (contains both 'instances' and 'create')
    const vmCreateCall = shellMock.mock.calls.find(
      (call: unknown[]) => {
        if (!Array.isArray(call[1])) return false;
        const args = call[1] as string[];
        return args.includes('instances') && args.includes('create');
      },
    );
    expect(vmCreateCall).toBeDefined();
    expect(vmCreateCall![2]).toMatchObject({ timeout: 120_000 });
  });

  it('returns clean error when VM creation fails', async () => {
    // saExists — SA already exists
    shellMock.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // IAM bindings succeed
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // vmExists — VM does not exist
    shellMock.mockRejectedValueOnce(new Error('not found'));
    // VM create — fails with timeout
    shellMock.mockRejectedValueOnce(new Error('Command timed out after 120000ms: gcloud'));

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create VM lox-vm');
    expect(result.message).toContain('timed out');
    expect(result.message).not.toContain('\n');
  });

  it('returns clean error when VM creation fails with quota error', async () => {
    // saExists — SA already exists
    shellMock.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // IAM bindings succeed
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // vmExists — VM does not exist
    shellMock.mockRejectedValueOnce(new Error('not found'));
    // VM create — fails with quota
    shellMock.mockRejectedValueOnce(new Error('QUOTA_EXCEEDED: Insufficient quota\nsome stack trace'));

    const promise = stepVm(makeCtx());
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('QUOTA_EXCEEDED');
    // Only first line, no stack trace
    expect(result.message).not.toContain('some stack trace');
  });
});

describe('stepVm — full success path', () => {
  it('creates SA, grants roles, creates VM, and stores config', async () => {
    // saExists — SA does not exist
    shellMock.mockRejectedValueOnce(new Error('not found'));
    // SA create
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // IAM bindings succeed
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // vmExists — VM does not exist
    shellMock.mockRejectedValueOnce(new Error('not found'));
    // VM create — succeeds
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const ctx = makeCtx();
    const promise = stepVm(ctx);
    await flushTimers();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(ctx.config.gcp?.service_account).toBe('lox-vm-sa@test-project.iam.gserviceaccount.com');
    expect(ctx.config.gcp?.vm_name).toBe('lox-vm');
  });
});
