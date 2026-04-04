import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    // Mock confirm to say yes
    vi.mock('@inquirer/prompts', () => ({
      confirm: vi.fn().mockResolvedValue(true),
    }));

    // shell will fail because gh is not available in test env — that's fine
    // The function should catch and not throw
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
});
