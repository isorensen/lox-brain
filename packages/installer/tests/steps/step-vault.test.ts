import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isProPlanGate, isRepoNotFoundError, repoExists, buildVmSetupScript, isValidPatFormat, gcpSecretExists, VM_SETUP_SCRIPT_REMOTE_PATH, resolveTemplatesDir } from '../../src/steps/step-vault.js';
import { shell } from '../../src/utils/shell.js';
import { existsSync } from 'node:fs';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

describe('isProPlanGate', () => {
  it('detects the Pro upgrade 403 from err.message', () => {
    const err = new Error(
      'Command failed: gh api repos/owner/repo/branches/main/protection -X PUT\n' +
      'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)',
    );
    expect(isProPlanGate(err)).toBe(true);
  });

  it('detects the Pro upgrade 403 from err.stderr', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)',
    });
    expect(isProPlanGate(err)).toBe(true);
  });

  it('requires both HTTP 403 and the upgrade message', () => {
    expect(isProPlanGate(new Error('HTTP 403 some other 403 error'))).toBe(false);
    expect(isProPlanGate(new Error('Upgrade to GitHub Pro (HTTP 402)'))).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isProPlanGate(new Error('HTTP 404 Not Found'))).toBe(false);
    expect(isProPlanGate(new Error('Network error: ECONNREFUSED'))).toBe(false);
    expect(isProPlanGate(new Error(''))).toBe(false);
  });

  it('returns false for other 403 errors (e.g. missing token scopes)', () => {
    expect(isProPlanGate(new Error('HTTP 403 Resource not accessible by personal access token'))).toBe(false);
    expect(isProPlanGate(new Error('HTTP 403 Forbidden'))).toBe(false);
  });

  it('rejects when signals are split across message and stderr (no false positive)', () => {
    // HTTP 403 in message, Pro message in stderr — should NOT match because
    // neither surface contains both signals.
    const err = Object.assign(new Error('HTTP 403 Forbidden'), {
      stderr: 'Upgrade to GitHub Pro to access this feature',
    });
    expect(isProPlanGate(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isProPlanGate(null)).toBe(false);
    expect(isProPlanGate(undefined)).toBe(false);
    expect(isProPlanGate('some string')).toBe(false);
    expect(isProPlanGate({})).toBe(false);
  });

  it('handles objects with non-string stderr gracefully', () => {
    const err = Object.assign(new Error('Command failed'), { stderr: Buffer.from('HTTP 403') });
    // Buffer stderr is not a string — helper only checks typeof string
    expect(isProPlanGate(err)).toBe(false);
  });
});

describe('isRepoNotFoundError', () => {
  it('detects "Could not resolve to a Repository" in err.stderr', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: 'GraphQL: Could not resolve to a Repository with the name \'isorensen/lox-vault\'. (repository)',
    });
    expect(isRepoNotFoundError(err)).toBe(true);
  });

  it('detects "Could not resolve" in err.message', () => {
    const err = new Error('GraphQL: Could not resolve to a Repository with the name');
    expect(isRepoNotFoundError(err)).toBe(true);
  });

  it('detects HTTP 404 from gh api', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: 'gh: Not Found (HTTP 404)',
    });
    expect(isRepoNotFoundError(err)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isRepoNotFoundError(new Error('HTTP 403 Forbidden'))).toBe(false);
    expect(isRepoNotFoundError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isRepoNotFoundError(new Error(''))).toBe(false);
  });

  it('returns false for a bare "HTTP 404" without the "Not Found" signal', () => {
    // Prevents false positives from unrelated 404s in error chains
    expect(isRepoNotFoundError(new Error('proxy returned HTTP 404 upstream'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isRepoNotFoundError(null)).toBe(false);
    expect(isRepoNotFoundError(undefined)).toBe(false);
    expect(isRepoNotFoundError('string')).toBe(false);
    expect(isRepoNotFoundError({})).toBe(false);
  });
});

describe('repoExists', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns true when gh repo view succeeds', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'lox-vault', stderr: '' });
    await expect(repoExists('isorensen/lox-vault')).resolves.toBe(true);
    expect(vi.mocked(shell)).toHaveBeenCalledWith('gh', [
      'repo', 'view', 'isorensen/lox-vault', '--json', 'name', '--jq', '.name',
    ]);
  });

  it('returns false when repo is not found (GraphQL Could not resolve)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), {
        stderr: 'GraphQL: Could not resolve to a Repository with the name \'x/y\'. (repository)',
      }),
    );
    await expect(repoExists('x/y')).resolves.toBe(false);
  });

  it('returns false when repo is not found (HTTP 404)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)' }),
    );
    await expect(repoExists('x/y')).resolves.toBe(false);
  });

  it('rethrows unrelated errors (e.g. auth, network)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), { stderr: 'HTTP 403 Forbidden — token expired' }),
    );
    await expect(repoExists('x/y')).rejects.toThrow('Command failed');
  });

  it('rethrows "Command not found" errors', async () => {
    vi.mocked(shell).mockRejectedValueOnce(new Error('Command not found: gh'));
    await expect(repoExists('x/y')).rejects.toThrow('Command not found: gh');
  });
});

describe('buildVmSetupScript', () => {
  const script = buildVmSetupScript({
    githubUser: 'alice',
    repoName: 'lox-vault',
    patSecretName: 'lox-github-pat',
  });

  it('starts with a bash shebang and strict mode', () => {
    expect(script.startsWith('#!/bin/bash\n')).toBe(true);
    expect(script).toContain('set -euo pipefail');
  });

  it('writes ~/sync-vault.sh via heredoc and chmods it', () => {
    expect(script).toContain("cat > ~/sync-vault.sh <<'LOX_SYNC_EOF'");
    expect(script).toContain('LOX_SYNC_EOF');
    expect(script).toContain('chmod +x ~/sync-vault.sh');
  });

  it('embeds the git sync commands in the heredoc body', () => {
    expect(script).toContain('cd ~/lox-vault');
    expect(script).toContain('git fetch origin main');
    expect(script).toContain('git merge --ff-only origin/main || true');
    expect(script).toContain('git push origin main');
  });

  it('installs a 2-minute cron entry for sync-vault.sh', () => {
    expect(script).toContain('*/2 * * * * ~/sync-vault.sh >> ~/sync-vault.log 2>&1');
    // Dedup: remove matching line first, then re-add — prevents duplicates on re-run
    expect(script).toContain('crontab -l 2>/dev/null');
    expect(script).toContain('crontab -');
  });

  it('removes itself after running (self-cleanup)', () => {
    expect(script).toContain('rm -- "$0"');
  });

  it('clones the vault repo to ~/lox-vault if missing (#104-B)', () => {
    // Before #104-B, sync-vault.sh did `cd ~/lox-vault` against a
    // directory that the installer never created on the VM — cron
    // failed silently forever. Now the setup script clones the repo
    // as a one-time bootstrap.
    expect(script).toContain('if [ ! -d "$HOME/lox-vault/.git" ]; then');
    expect(script).toContain('git clone');
    expect(script).toContain('github.com/alice/lox-vault.git');
    expect(script).toContain('$HOME/lox-vault');
  });

  it('fetches the PAT from Secret Manager and unsets it after clone', () => {
    // The token must be scrubbed from the shell env after the clone so
    // it doesn't linger for subsequent lines in the setup script.
    expect(script).toContain('gcloud secrets versions access latest --secret=lox-github-pat');
    expect(script).toContain('unset GH_PAT');
  });

  it('sanitizes repoName / githubUser / patSecretName against shell injection', () => {
    // Defense in depth: even though githubUser comes from the GitHub API
    // and repoName passes through input validation, we strip anything
    // outside the alphanumeric + allowed-punct set before interpolating.
    const malicious = buildVmSetupScript({
      githubUser: 'alice; rm -rf /',
      repoName: 'lox-vault && curl evil',
      patSecretName: 'x$(whoami)',
    });
    // Stripped to their safe character sets.
    expect(malicious).toContain('github.com/alicerm-rf/lox-vaultcurlevil.git');
    expect(malicious).toContain('--secret=xwhoami');
    // Must NOT contain the raw injection metachars.
    expect(malicious).not.toContain('; rm -rf /');
    expect(malicious).not.toContain('&& curl');
    expect(malicious).not.toContain('$(whoami)');
  });

  it('preserves underscores in patSecretName (GCP Secret Manager allows them)', () => {
    // GCP allows [A-Za-z0-9_-] in secret names per
    // https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets
    // Stripping underscores would silently break users whose secret names
    // look like `lox_github_pat` instead of `lox-github-pat`.
    const s = buildVmSetupScript({
      githubUser: 'alice',
      repoName: 'lox-vault',
      patSecretName: 'lox_github_pat_2026',
    });
    expect(s).toContain('--secret=lox_github_pat_2026');
  });

  it('VM_SETUP_SCRIPT_REMOTE_PATH is an absolute POSIX path', () => {
    // pscp.exe (Windows Cloud SDK) does not perform tilde expansion — a
    // destination like lox-vm:~/file.sh lands in a literal "~" directory
    // and fails. The remote path must start with "/" and contain no "~"
    // (see #64).
    expect(VM_SETUP_SCRIPT_REMOTE_PATH.startsWith('/')).toBe(true);
    expect(VM_SETUP_SCRIPT_REMOTE_PATH).not.toContain('~');
  });

  it('ends with a trailing newline', () => {
    // The script is written to a file and executed via `bash <path>`. A
    // trailing newline is conventional and ensures POSIX tools treat the
    // last line as a complete line.
    expect(script.endsWith('\n')).toBe(true);
  });
});

describe('resolveTemplatesDir (#105)', () => {
  it('resolves to an absolute path independent of CWD', () => {
    const paraPath = resolveTemplatesDir('para');
    expect(paraPath).toMatch(/templates[/\\]para$/);
    // Not a relative path — must not depend on process.cwd().
    expect(paraPath.startsWith('/') || /^[A-Z]:\\/.test(paraPath)).toBe(true);
  });

  it('resolves to actual template directories that exist in the repo', () => {
    // End-to-end check: the path resolution isn't just syntactic — the
    // templates MUST exist on disk for the installer to copy them.
    // This would have caught the #105 silent-failure bug: the old code
    // tried `cp -r templates/para/.` (CWD-relative), failed on Windows,
    // and swallowed the error. The new path MUST reach a real folder.
    expect(existsSync(resolveTemplatesDir('para'))).toBe(true);
    expect(existsSync(resolveTemplatesDir('zettelkasten'))).toBe(true);
  });
});

describe('isValidPatFormat', () => {
  it('accepts fine-grained PATs (github_pat_ prefix)', () => {
    // Fine-grained PATs are the recommended format — the installer's UI
    // points users at the fine-grained token flow specifically.
    expect(isValidPatFormat('github_pat_' + 'A'.repeat(82))).toBe(true);
    expect(isValidPatFormat('github_pat_11ABCDE_0123456789abcdefghij_ABCDEFGHIJKLMNOP' + 'q'.repeat(30))).toBe(true);
  });

  it('accepts classic PATs (ghp_ prefix) as a fallback', () => {
    // Some users may paste a classic PAT — accept it rather than rejecting
    // a working token over a prefix mismatch.
    expect(isValidPatFormat('ghp_' + 'A'.repeat(36))).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    // Copy-paste from browsers often includes a trailing newline
    expect(isValidPatFormat('  ghp_' + 'A'.repeat(36) + '\n')).toBe(true);
  });

  it('rejects empty or whitespace-only input', () => {
    expect(isValidPatFormat('')).toBe(false);
    expect(isValidPatFormat('   ')).toBe(false);
    expect(isValidPatFormat('\n\t')).toBe(false);
  });

  it('rejects tokens without a recognized prefix', () => {
    // A bare hex/base64 string is almost certainly not a GitHub PAT
    expect(isValidPatFormat('A'.repeat(40))).toBe(false);
    expect(isValidPatFormat('sk-live-abcdef1234567890')).toBe(false);
    expect(isValidPatFormat('Bearer ghp_' + 'A'.repeat(36))).toBe(false);
  });

  it('rejects tokens that are too short', () => {
    // GitHub PATs are substantially longer than the prefix — a short suffix
    // is a clear typo/truncation signal.
    expect(isValidPatFormat('ghp_short')).toBe(false);
    expect(isValidPatFormat('github_pat_short')).toBe(false);
  });

  it('rejects tokens containing invalid characters', () => {
    // PATs use [A-Za-z0-9_] only; spaces/quotes/special chars mean paste corruption
    expect(isValidPatFormat('ghp_' + 'A'.repeat(20) + ' ' + 'A'.repeat(15))).toBe(false);
    expect(isValidPatFormat('ghp_' + 'A'.repeat(20) + '"' + 'A'.repeat(15))).toBe(false);
  });

  it('rejects non-string input gracefully', () => {
    expect(isValidPatFormat(null as unknown as string)).toBe(false);
    expect(isValidPatFormat(undefined as unknown as string)).toBe(false);
    expect(isValidPatFormat(123 as unknown as string)).toBe(false);
  });
});

describe('gcpSecretExists', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns true when gcloud secrets describe succeeds', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'name: projects/x/secrets/lox-github-pat', stderr: '' });
    await expect(gcpSecretExists('lox-github-pat', 'my-project')).resolves.toBe(true);
    expect(vi.mocked(shell)).toHaveBeenCalledWith('gcloud', [
      'secrets', 'describe', 'lox-github-pat', '--project', 'my-project',
    ]);
  });

  it('returns false when the secret is NOT_FOUND', async () => {
    vi.mocked(shell).mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), {
        stderr: 'ERROR: (gcloud.secrets.describe) NOT_FOUND: Secret [lox-github-pat] was not found',
      }),
    );
    await expect(gcpSecretExists('lox-github-pat', 'my-project')).resolves.toBe(false);
  });

  it('returns false on the alternate "was not found" phrasing', async () => {
    vi.mocked(shell).mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), {
        stderr: 'Secret [x] was not found in project [y]',
      }),
    );
    await expect(gcpSecretExists('x', 'y')).resolves.toBe(false);
  });

  it('rethrows unrelated errors (auth, API disabled, billing)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), {
        stderr: 'PERMISSION_DENIED: Secret Manager API has not been used',
      }),
    );
    await expect(gcpSecretExists('x', 'y')).rejects.toThrow('Command failed');
  });

  it('rethrows "Command not found" for missing gcloud', async () => {
    vi.mocked(shell).mockRejectedValueOnce(new Error('Command not found: gcloud'));
    await expect(gcpSecretExists('x', 'y')).rejects.toThrow('Command not found: gcloud');
  });
});
