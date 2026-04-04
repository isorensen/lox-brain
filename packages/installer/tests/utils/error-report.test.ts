import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sanitize, offerErrorReport, type ErrorReportContext } from '../../src/utils/error-report.js';

describe('sanitize', () => {
  it('redacts GCP project IDs with --project <id>', () => {
    const input = 'gcloud compute instances list --project my-secret-project';
    const result = sanitize(input);
    expect(result).toBe('gcloud compute instances list --project <REDACTED>');
    expect(result).not.toContain('my-secret-project');
  });

  it('redacts GCP project IDs with --project=<id>', () => {
    const input = 'gcloud compute instances list --project=my-secret-project';
    const result = sanitize(input);
    expect(result).toBe('gcloud compute instances list --project <REDACTED>');
    expect(result).not.toContain('my-secret-project');
  });

  it('redacts service account emails', () => {
    const input = 'Permission denied for lox-sa@my-project.iam.gserviceaccount.com';
    const result = sanitize(input);
    expect(result).toBe('Permission denied for <REDACTED>@<REDACTED>.iam.gserviceaccount.com');
    expect(result).not.toContain('lox-sa');
    expect(result).not.toContain('my-project');
  });

  it('redacts Windows user paths', () => {
    const input = 'Error reading C:\\Users\\Eduardo\\AppData\\Local\\lox\\config.json';
    const result = sanitize(input);
    expect(result).toBe('Error reading C:\\Users\\<REDACTED>\\AppData\\Local\\lox\\config.json');
    expect(result).not.toContain('Eduardo');
  });

  it('redacts Windows user paths case-insensitively', () => {
    const input = 'c:\\users\\Lara\\Documents\\vault';
    const result = sanitize(input);
    expect(result).toContain('<REDACTED>');
    expect(result).not.toContain('Lara');
  });

  it('redacts billing account IDs', () => {
    const input = 'Billing account AB12CD-EF34GH-IJ56KL not found';
    const result = sanitize(input);
    expect(result).toBe('Billing account <REDACTED> not found');
    expect(result).not.toContain('AB12CD');
  });

  it('redacts GCP project numbers after project/', () => {
    const input = 'projects/project/123456789012/zones/us-central1-a';
    const result = sanitize(input);
    expect(result).toContain('project/<REDACTED>');
    expect(result).not.toContain('123456789012');
  });

  it('handles text with multiple sensitive values', () => {
    const input = [
      'Error in --project my-proj',
      'sa@my-proj.iam.gserviceaccount.com',
      'C:\\Users\\John\\path',
      'billing AAAAAA-BBBBBB-CCCCCC',
    ].join(' | ');

    const result = sanitize(input);
    expect(result).not.toContain('my-proj');
    expect(result).not.toContain('John');
    expect(result).not.toContain('AAAAAA');
  });

  it('returns unchanged text when nothing to redact', () => {
    const input = 'Connection timeout after 30000ms';
    expect(sanitize(input)).toBe(input);
  });
});

// Mock shell at module level so we can inspect calls
vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn().mockResolvedValue({ stdout: 'https://github.com/isorensen/lox-brain/issues/99', stderr: '' }),
}));

describe('offerErrorReport', () => {
  const baseCtx: ErrorReportContext = {
    stepName: 'VM Setup',
    errorMessage: 'SSH connection failed --project my-proj',
    loxVersion: '0.2.3',
    os: 'darwin arm64',
    nodeVersion: 'v22.0.0',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw when gh is not available', async () => {
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockResolvedValue(true),
    }));

    // Re-mock shell to simulate gh not found
    const { shell } = await import('../../src/utils/shell.js');
    vi.mocked(shell).mockRejectedValueOnce(new Error('Command not found: gh'));

    await expect(offerErrorReport(baseCtx)).resolves.toBeUndefined();
  });

  it('does not throw when user declines', async () => {
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockResolvedValue(false),
    }));

    await expect(offerErrorReport(baseCtx)).resolves.toBeUndefined();
  });

  it('does not throw on any unexpected error', async () => {
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockRejectedValue(new Error('stdin closed')),
    }));

    await expect(offerErrorReport(baseCtx)).resolves.toBeUndefined();
  });

  it('uses --body-file instead of --body to avoid Windows truncation', async () => {
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockResolvedValue(true),
    }));

    const { shell } = await import('../../src/utils/shell.js');
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'https://github.com/isorensen/lox-brain/issues/42', stderr: '' });

    await offerErrorReport(baseCtx);

    expect(shell).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--body-file', expect.stringMatching(/lox-error-report-[0-9a-f]{8}\.md/)]),
      expect.anything(),
    );
    // Must NOT contain --body (without -file)
    const callArgs = vi.mocked(shell).mock.calls[0]?.[1] ?? [];
    expect(callArgs).not.toContain('--body');
  });

  it('cleans up the temp file after creating the report', async () => {
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockResolvedValue(true),
    }));

    const { shell } = await import('../../src/utils/shell.js');
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'https://github.com/isorensen/lox-brain/issues/50', stderr: '' });

    await offerErrorReport(baseCtx);

    // Extract the temp file path from the shell call args
    const callArgs = vi.mocked(shell).mock.calls[0]?.[1] ?? [];
    const bodyFileIdx = callArgs.indexOf('--body-file');
    const tempFile = callArgs[bodyFileIdx + 1] as string;
    expect(existsSync(tempFile)).toBe(false);
  });

  it('cleans up the temp file even when shell() fails', async () => {
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockResolvedValue(true),
    }));

    const { shell } = await import('../../src/utils/shell.js');
    vi.mocked(shell).mockRejectedValueOnce(new Error('network error'));

    await offerErrorReport(baseCtx);

    // Verify no temp files with our prefix remain in tmpdir
    const { readdirSync } = await import('node:fs');
    const remaining = readdirSync(tmpdir()).filter(f => f.startsWith('lox-error-report-'));
    expect(remaining).toHaveLength(0);
  });
});

import { extractSubPhase, sourceFileForStep, buildIssueBody } from '../../src/utils/error-report.js';

describe('extractSubPhase', () => {
  it('extracts sub-phase from "<phase> failed: <error>" format', () => {
    expect(extractSubPhase('Creating database and schema failed: ERROR: role lox already exists'))
      .toBe('Creating database and schema');
  });

  it('extracts multi-word sub-phase with spaces', () => {
    expect(extractSubPhase('SSH warm-up failed: Connection reset'))
      .toBe('SSH warm-up');
  });

  it('uses non-greedy match to capture shortest prefix before "failed:"', () => {
    expect(extractSubPhase('Phase A failed: something failed: deeper'))
      .toBe('Phase A');
  });

  it('returns undefined when message has no "failed:" marker', () => {
    expect(extractSubPhase('Unknown error')).toBeUndefined();
  });

  it('returns undefined on empty string', () => {
    expect(extractSubPhase('')).toBeUndefined();
  });
});

describe('sourceFileForStep', () => {
  it('maps known step names to source files', () => {
    expect(sourceFileForStep('VM Setup')).toBe('packages/installer/src/steps/step-vm-setup.ts');
    expect(sourceFileForStep('GCP Auth')).toBe('packages/installer/src/steps/step-gcp-auth.ts');
    expect(sourceFileForStep('WireGuard VPN')).toBe('packages/installer/src/steps/step-vpn.ts');
    expect(sourceFileForStep('MCP Server')).toBe('packages/installer/src/steps/step-mcp.ts');
  });

  it('returns undefined for unknown step names', () => {
    expect(sourceFileForStep('NonExistent')).toBeUndefined();
    expect(sourceFileForStep('')).toBeUndefined();
  });

  it('covers every step name used in index.ts handleStepFailure calls', () => {
    // These must match the stepName strings in packages/installer/src/index.ts.
    // If a step is renamed or added, update this list AND STEP_SOURCE_FILES.
    const EXPECTED_STEPS = [
      'Prerequisites',
      'GCP Auth',
      'GCP Project',
      'Billing',
      'VPC Network',
      'VM Instance',
      'VM Setup',
      'WireGuard VPN',
      'Vault Setup',
      'Obsidian',
      'Deploy',
      'MCP Server',
    ];
    for (const step of EXPECTED_STEPS) {
      expect(sourceFileForStep(step), `missing mapping for "${step}"`).toBeDefined();
    }
  });
});

describe('buildIssueBody', () => {
  const baseCtx = {
    stepName: 'VM Setup',
    errorMessage: 'Creating database and schema failed: ERROR: role lox already exists',
    loxVersion: '0.3.4',
    os: 'darwin arm64',
    nodeVersion: 'v22.16.0',
  };

  it('includes sub-phase line when subPhase is provided', () => {
    const body = buildIssueBody({ ...baseCtx, subPhase: 'Creating database and schema' });
    expect(body).toContain('**Sub-phase:** Creating database and schema');
  });

  it('includes source file line when sourceFile is provided', () => {
    const body = buildIssueBody({
      ...baseCtx,
      sourceFile: 'packages/installer/src/steps/step-vm-setup.ts',
    });
    expect(body).toContain('**Source:** `packages/installer/src/steps/step-vm-setup.ts`');
  });

  it('omits sub-phase line when subPhase is undefined', () => {
    const body = buildIssueBody(baseCtx);
    expect(body).not.toContain('**Sub-phase:**');
  });

  it('omits source file line when sourceFile is undefined', () => {
    const body = buildIssueBody(baseCtx);
    expect(body).not.toContain('**Source:**');
  });

  it('still includes all original fields', () => {
    const body = buildIssueBody({
      ...baseCtx,
      subPhase: 'x',
      sourceFile: 'y',
    });
    expect(body).toContain('**Step:** VM Setup');
    expect(body).toContain('**OS:** darwin arm64');
    expect(body).toContain('**Node.js:** v22.16.0');
    expect(body).toContain('**Lox version:** 0.3.4');
  });
});
