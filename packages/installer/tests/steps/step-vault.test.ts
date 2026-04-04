import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isProPlanGate, isRepoNotFoundError, repoExists, buildVmSetupScript } from '../../src/steps/step-vault.js';
import { shell } from '../../src/utils/shell.js';

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
  const script = buildVmSetupScript();

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

  it('ends with a trailing newline', () => {
    // The script is written to a file and executed via `bash <path>`. A
    // trailing newline is conventional and ensures POSIX tools treat the
    // last line as a complete line.
    expect(script.endsWith('\n')).toBe(true);
  });
});
