import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock shell utility
vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
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
    step_gcp_project: 'GCP Project',
    creating: 'Creating',
    configuring: 'Configuring',
    checking: 'Checking',
    billing_checking: 'Checking billing account...',
    billing_not_linked: 'No billing account linked to project',
    billing_select_account: 'Select a billing account:',
    billing_no_accounts: 'No billing accounts found. Create one at:',
    billing_press_enter: 'Press Enter after creating a billing account',
    billing_linked_success: 'Billing account linked successfully',
    billing_required_for_apis: 'Billing is required to enable GCP APIs. Please link a billing account and try again.',
    billing_linking: 'Linking billing account...',
  }),
}));

import { shell } from '../../src/utils/shell.js';
import { select, input } from '@inquirer/prompts';
import {
  checkBillingEnabled,
  listBillingAccounts,
  linkBillingAccount,
  ensureBilling,
} from '../../src/steps/step-gcp-project.js';
import { t } from '../../src/i18n/index.js';

const shellMock = shell as Mock;
const selectMock = select as Mock;
const inputMock = input as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkBillingEnabled', () => {
  it('returns billing account name when linked', async () => {
    shellMock.mockResolvedValueOnce({ stdout: 'billingAccounts/012345-6789AB-CDEF01', stderr: '' });

    const result = await checkBillingEnabled('my-project');

    expect(result).toBe('billingAccounts/012345-6789AB-CDEF01');
    expect(shellMock).toHaveBeenCalledWith('gcloud', [
      'billing', 'projects', 'describe', 'my-project',
      '--format=value(billingAccountName)',
    ]);
  });

  it('returns empty string when no billing linked', async () => {
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await checkBillingEnabled('my-project');

    expect(result).toBe('');
  });

  it('returns empty string when command fails', async () => {
    shellMock.mockRejectedValueOnce(new Error('command failed'));

    const result = await checkBillingEnabled('my-project');

    expect(result).toBe('');
  });
});

describe('listBillingAccounts', () => {
  it('parses billing accounts list correctly', async () => {
    shellMock.mockResolvedValueOnce({
      stdout: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC\tMy Billing Account',
      stderr: '',
    });

    const accounts = await listBillingAccounts();

    expect(accounts).toEqual([
      { id: 'AAAAAA-BBBBBB-CCCCCC', displayName: 'My Billing Account' },
    ]);
  });

  it('handles multiple accounts', async () => {
    shellMock.mockResolvedValueOnce({
      stdout: 'billingAccounts/AAA-BBB-CCC\tAccount One\nbillingAccounts/DDD-EEE-FFF\tAccount Two',
      stderr: '',
    });

    const accounts = await listBillingAccounts();

    expect(accounts).toHaveLength(2);
    expect(accounts[0].id).toBe('AAA-BBB-CCC');
    expect(accounts[1].id).toBe('DDD-EEE-FFF');
  });

  it('returns empty array when no accounts', async () => {
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const accounts = await listBillingAccounts();

    expect(accounts).toEqual([]);
  });

  it('returns empty array on command failure', async () => {
    shellMock.mockRejectedValueOnce(new Error('failed'));

    const accounts = await listBillingAccounts();

    expect(accounts).toEqual([]);
  });
});

describe('linkBillingAccount', () => {
  it('calls gcloud with correct arguments', async () => {
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await linkBillingAccount('my-project', 'AAAAAA-BBBBBB-CCCCCC');

    expect(shellMock).toHaveBeenCalledWith('gcloud', [
      'billing', 'projects', 'link', 'my-project',
      '--billing-account=AAAAAA-BBBBBB-CCCCCC',
    ]);
  });

  it('propagates error when gcloud link fails (e.g. insufficient IAM permissions)', async () => {
    const iamError = new Error(
      'ERROR: (gcloud.billing.projects.link) PERMISSION_DENIED: ' +
      'The caller does not have permission',
    );
    shellMock.mockRejectedValueOnce(iamError);

    await expect(linkBillingAccount('my-project', 'AAAAAA-BBBBBB-CCCCCC')).rejects.toThrow(
      'PERMISSION_DENIED',
    );
  });
});

describe('ensureBilling', () => {
  const strings = t();

  it('skips linking when billing is already enabled', async () => {
    shellMock.mockResolvedValueOnce({ stdout: 'billingAccounts/XXX-YYY-ZZZ', stderr: '' });

    const result = await ensureBilling('my-project', strings);

    expect(result.success).toBe(true);
    // Should not prompt user
    expect(selectMock).not.toHaveBeenCalled();
    expect(inputMock).not.toHaveBeenCalled();
  });

  it('lets user select and link when accounts are available', async () => {
    // checkBillingEnabled returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // listBillingAccounts
    shellMock.mockResolvedValueOnce({
      stdout: 'billingAccounts/AAA-BBB-CCC\tTest Account',
      stderr: '',
    });
    // linkBillingAccount
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    selectMock.mockResolvedValueOnce('AAA-BBB-CCC');

    const result = await ensureBilling('my-project', strings);

    expect(result.success).toBe(true);
    expect(selectMock).toHaveBeenCalledTimes(1);
    // Verify link was called
    expect(shellMock).toHaveBeenCalledWith('gcloud', [
      'billing', 'projects', 'link', 'my-project',
      '--billing-account=AAA-BBB-CCC',
    ]);
  });

  it('guides user to create billing account when none exist, then re-checks', async () => {
    // checkBillingEnabled returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // listBillingAccounts returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    inputMock.mockResolvedValueOnce('');

    // After user confirms, re-check billing — now it's linked
    shellMock.mockResolvedValueOnce({ stdout: 'billingAccounts/NEW-ACC-123', stderr: '' });

    const result = await ensureBilling('my-project', strings);

    expect(result.success).toBe(true);
    expect(inputMock).toHaveBeenCalledTimes(1);
  });

  it('returns failure when no billing after user creates account', async () => {
    // checkBillingEnabled returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // listBillingAccounts returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    inputMock.mockResolvedValueOnce('');

    // Re-check billing — still empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Re-list accounts — still empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await ensureBilling('my-project', strings);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Billing is required');
  });

  it('propagates linkBillingAccount error through ensureBilling', async () => {
    // checkBillingEnabled returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // listBillingAccounts returns one account
    shellMock.mockResolvedValueOnce({
      stdout: 'billingAccounts/AAA-BBB-CCC\tTest Account',
      stderr: '',
    });

    selectMock.mockResolvedValueOnce('AAA-BBB-CCC');

    // linkBillingAccount throws permission denied
    const iamError = new Error(
      'ERROR: (gcloud.billing.projects.link) PERMISSION_DENIED: ' +
      'The caller does not have permission',
    );
    shellMock.mockRejectedValueOnce(iamError);

    await expect(ensureBilling('my-project', strings)).rejects.toThrow('PERMISSION_DENIED');
  });

  it('lets user select newly created account after re-check', async () => {
    // checkBillingEnabled returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // listBillingAccounts returns empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    inputMock.mockResolvedValueOnce('');

    // Re-check billing — still empty
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // Re-list accounts — now has one
    shellMock.mockResolvedValueOnce({
      stdout: 'billingAccounts/NEW-ACC-456\tNew Account',
      stderr: '',
    });

    selectMock.mockResolvedValueOnce('NEW-ACC-456');

    // linkBillingAccount
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await ensureBilling('my-project', strings);

    expect(result.success).toBe(true);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});

describe('stepGcpProject — API enable error handling', () => {
  it('returns clean error when gcloud services enable fails with billing error', async () => {
    const { stepGcpProject } = await import('../../src/steps/step-gcp-project.js');
    const { input } = await import('@inquirer/prompts');
    const inputMock = input as Mock;

    inputMock.mockResolvedValueOnce('test-project-id');

    // projectExists — project exists
    shellMock.mockResolvedValueOnce({ stdout: 'test-project-id', stderr: '' });
    // config set project
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // checkBillingEnabled — billing is linked (pass the billing check)
    shellMock.mockResolvedValueOnce({ stdout: 'billingAccounts/XXX', stderr: '' });
    // gcloud services enable (first API) — fails with billing error
    const billingErr = new Error('FAILED_PRECONDITION: Billing account not found');
    shellMock.mockRejectedValueOnce(billingErr);

    const ctx = {
      config: {},
      locale: 'en' as const,
      gcpUsername: 'test',
    };

    const result = await stepGcpProject(ctx);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Billing is required');
  });

  it('returns clean error (not stack trace) when API enable fails with non-billing error', async () => {
    const { stepGcpProject } = await import('../../src/steps/step-gcp-project.js');
    const { input } = await import('@inquirer/prompts');
    const inputMock = input as Mock;

    inputMock.mockResolvedValueOnce('test-project-id');

    // projectExists — project exists
    shellMock.mockResolvedValueOnce({ stdout: 'test-project-id', stderr: '' });
    // config set project
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // checkBillingEnabled — billing is linked
    shellMock.mockResolvedValueOnce({ stdout: 'billingAccounts/XXX', stderr: '' });
    // gcloud services enable (first API) — fails with timeout/generic error
    const timeoutErr = new Error('Command timed out after 120000ms');
    shellMock.mockRejectedValueOnce(timeoutErr);

    const ctx = {
      config: {},
      locale: 'en' as const,
      gcpUsername: 'test',
    };

    const result = await stepGcpProject(ctx);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to enable API: compute');
    expect(result.message).toContain('Command timed out');
  });

  it('enables APIs one at a time with 120s timeout', async () => {
    const { stepGcpProject } = await import('../../src/steps/step-gcp-project.js');
    const { input } = await import('@inquirer/prompts');
    const inputMock = input as Mock;

    inputMock.mockResolvedValueOnce('test-project-id');

    // projectExists — project exists
    shellMock.mockResolvedValueOnce({ stdout: 'test-project-id', stderr: '' });
    // config set project
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // checkBillingEnabled — billing is linked
    shellMock.mockResolvedValueOnce({ stdout: 'billingAccounts/XXX', stderr: '' });
    // 3 individual API enable calls
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // config set region
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // config set zone
    shellMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const ctx = {
      config: {},
      locale: 'en' as const,
      gcpUsername: 'test',
    };

    const result = await stepGcpProject(ctx);

    expect(result.success).toBe(true);

    // Verify each API was enabled individually with 120s timeout
    const apiCalls = shellMock.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[])[0] === 'services',
    );
    expect(apiCalls).toHaveLength(3);

    for (const call of apiCalls) {
      expect(call[1][0]).toBe('services');
      expect(call[1][1]).toBe('enable');
      // Each call should have a single API: ['services', 'enable', 'x.googleapis.com', '--project', 'id']
      expect(call[1]).toHaveLength(5);
    }

    // Verify timeout option was passed
    for (const call of apiCalls) {
      expect(call[2]).toMatchObject({ timeout: 120_000 });
    }
  });
});
