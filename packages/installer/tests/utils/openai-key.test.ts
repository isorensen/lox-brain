import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateOpenAiKeyFormat,
  openAiSecretExists,
  fetchOpenAiKey,
  uploadOpenAiKey,
  OPENAI_SECRET_NAME,
} from '../../src/utils/openai-key.js';
import { shell } from '../../src/utils/shell.js';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

describe('validateOpenAiKeyFormat', () => {
  it('accepts a legacy sk-<48-char> key', () => {
    const key = 'sk-' + 'a'.repeat(48);
    expect(validateOpenAiKeyFormat(key)).toBeNull();
  });

  it('accepts a project-scoped sk-proj-... key', () => {
    const key = 'sk-proj-' + 'b'.repeat(48);
    expect(validateOpenAiKeyFormat(key)).toBeNull();
  });

  it('accepts a service-account sk-svcacct-... key', () => {
    const key = 'sk-svcacct-' + 'c'.repeat(48);
    expect(validateOpenAiKeyFormat(key)).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    const key = '   sk-' + 'a'.repeat(48) + '   ';
    expect(validateOpenAiKeyFormat(key)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(validateOpenAiKeyFormat('')).toMatch(/empty/);
    expect(validateOpenAiKeyFormat('   ')).toMatch(/empty/);
  });

  it('rejects keys that do not start with sk-', () => {
    expect(validateOpenAiKeyFormat('pk-' + 'a'.repeat(48))).toMatch(/sk-/);
    expect(validateOpenAiKeyFormat('ghp_' + 'a'.repeat(40))).toMatch(/sk-/);
  });

  it('rejects keys that are too short', () => {
    expect(validateOpenAiKeyFormat('sk-short')).toMatch(/too short/);
    expect(validateOpenAiKeyFormat('sk-' + 'a'.repeat(36))).toMatch(/too short/);
  });

  it('rejects keys containing internal whitespace (paste accident)', () => {
    // sk- prefix + 48 chars but with a space in the middle
    const key = 'sk-' + 'a'.repeat(20) + ' ' + 'b'.repeat(28);
    expect(validateOpenAiKeyFormat(key)).toMatch(/whitespace/);
  });
});

describe('openAiSecretExists', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns true when gcloud describe succeeds', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: 'projects/p/secrets/openai-api-key', stderr: '' });
    expect(await openAiSecretExists('my-project')).toBe(true);
  });

  it('returns false when gcloud exits with NOT_FOUND', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('ERROR: (gcloud.secrets.describe) NOT_FOUND: ...'));
    expect(await openAiSecretExists('my-project')).toBe(false);
  });

  it('rethrows on unexpected errors (auth, network)', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('PERMISSION_DENIED: caller lacks access'));
    await expect(openAiSecretExists('my-project')).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('calls gcloud with the secret name and project', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    await openAiSecretExists('my-project');
    const call = vi.mocked(shell).mock.calls[0]!;
    expect(call[0]).toBe('gcloud');
    expect(call[1]).toContain(OPENAI_SECRET_NAME);
    expect(call[1]).toContain('my-project');
  });
});

describe('fetchOpenAiKey', () => {
  beforeEach(() => vi.mocked(shell).mockReset());

  it('returns the trimmed stdout of gcloud secrets versions access', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: 'sk-abc123\n', stderr: '' });
    expect(await fetchOpenAiKey('my-project')).toBe('sk-abc123');
  });

  it('passes --secret=<OPENAI_SECRET_NAME> and --project', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: 'sk-x', stderr: '' });
    await fetchOpenAiKey('my-project');
    const call = vi.mocked(shell).mock.calls[0]!;
    expect(call[1]).toEqual(expect.arrayContaining([
      'secrets', 'versions', 'access', 'latest',
      '--secret', OPENAI_SECRET_NAME,
      '--project', 'my-project',
    ]));
  });
});

describe('uploadOpenAiKey', () => {
  beforeEach(() => vi.mocked(shell).mockReset());

  it('creates the secret, then adds a version with the key', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    await uploadOpenAiKey('my-project', 'sk-test');
    const calls = vi.mocked(shell).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]).toEqual(expect.arrayContaining(['secrets', 'create', OPENAI_SECRET_NAME]));
    expect(calls[1]![1]).toEqual(expect.arrayContaining(['secrets', 'versions', 'add', OPENAI_SECRET_NAME]));
  });

  it('swallows the "secret already exists" error and still adds a version', async () => {
    vi.mocked(shell)
      .mockRejectedValueOnce(new Error('ALREADY_EXISTS: secret openai-api-key already exists'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });
    await expect(uploadOpenAiKey('my-project', 'sk-test')).resolves.toBeUndefined();
    expect(vi.mocked(shell).mock.calls).toHaveLength(2);
  });

  it('passes the key via --data-file (temp file) to avoid shell piping', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    await uploadOpenAiKey('my-project', 'sk-test');
    const addCall = vi.mocked(shell).mock.calls[1]!;
    const dataFileArg = addCall[1]!.find((a: string) => a.startsWith('--data-file='));
    expect(dataFileArg).toBeDefined();
    // Temp file path should never contain the literal key.
    expect(dataFileArg!).not.toContain('sk-test');
  });

  it('deletes the temp file even if gcloud fails', async () => {
    const { existsSync } = await import('node:fs');
    vi.mocked(shell)
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // create succeeds
      .mockRejectedValueOnce(new Error('upload failed')); // versions add fails
    await expect(uploadOpenAiKey('my-project', 'sk-test')).rejects.toThrow(/upload failed/);
    const addCall = vi.mocked(shell).mock.calls[1]!;
    const dataFileArg = addCall[1]!.find((a: string) => a.startsWith('--data-file='))!;
    const tmpPath = dataFileArg.replace('--data-file=', '');
    expect(existsSync(tmpPath)).toBe(false);
  });
});
