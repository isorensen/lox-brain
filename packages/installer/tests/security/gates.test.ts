import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { securityGates } from '../../src/security/gates.js';
import { shell } from '../../src/utils/shell.js';
import { mkdirSync, writeFileSync, rmSync, existsSync as existsSyncReal } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type { LoxConfig } from '@lox-brain/shared';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

// Minimal config stub. Each test overrides only the fields its gate inspects.
function buildConfig(overrides: Partial<LoxConfig> = {}): LoxConfig {
  return {
    version: '0.6.14',
    mode: 'personal',
    gcp: {
      project: 'test-project',
      region: 'us-east1',
      zone: 'us-east1-b',
      vm_name: 'lox-vm',
      service_account: 'lox-sa@test-project.iam.gserviceaccount.com',
    },
    database: { host: '127.0.0.1', port: 5432, name: 'lox_brain', user: 'lox' },
    vpn: { server_ip: '10.10.0.1', subnet: '10.10.0.0/24', listen_port: 51820, peers: [] },
    vault: { repo: 'alice/lox-vault', local_path: '~/Obsidian/Lox', preset: 'para' },
    install_dir: '/tmp/lox',
    installed_at: '2026-04-05T00:00:00Z',
    ...overrides,
  };
}

function findGate(name: string) {
  const gate = securityGates.find(g => g.name === name);
  if (!gate) throw new Error(`Gate not found: ${name}`);
  return gate;
}

describe('Branch protection gate (#119)', () => {
  const gate = findGate('Branch protection enabled on main');

  beforeEach(() => { vi.mocked(shell).mockReset(); });

  it('passes when gh api returns protection details', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: '{}', stderr: '' });
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('passes (N/A) when GitHub Free rejects with Pro-upgrade 403', async () => {
    // Private repos on GitHub Free can't enable branch protection — the
    // installer already skipped it in step 9 with a warning. Counting it
    // as a failure here would produce a false negative in the audit.
    vi.mocked(shell).mockRejectedValueOnce(Object.assign(new Error('Command failed'), {
      stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)',
    }));
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('fails when gh api returns a different error (real missing protection)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(Object.assign(new Error('Command failed'), {
      stderr: 'gh: Not Found (HTTP 404)',
    }));
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails on generic errors (auth, network)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(Object.assign(new Error('Command failed'), {
      stderr: 'HTTP 403 Forbidden — token expired',
    }));
    expect(await gate.check(buildConfig())).toBe(false);
  });
});

describe('SSH key permissions gate (#119)', () => {
  const gate = findGate('SSH key permissions validated');
  const originalPlatform = process.platform;

  beforeEach(() => { vi.mocked(shell).mockReset(); });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('POSIX: passes when stat returns 600', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    vi.mocked(shell).mockRejectedValueOnce(new Error('stat -f unsupported'));
    vi.mocked(shell).mockResolvedValueOnce({ stdout: '600\n', stderr: '' });
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('POSIX: fails when stat returns 644', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    vi.mocked(shell).mockRejectedValueOnce(new Error('stat -f unsupported'));
    vi.mocked(shell).mockResolvedValueOnce({ stdout: '644\n', stderr: '' });
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('Windows: passes when icacls output contains none of the loose SIDs', async () => {
    // icacls prints the SID string ONLY when the SID is in the ACL. An
    // output with NO SID substring means the key was hardened (step 7's
    // fixWindowsAcl removes all four loose principals). Locale-independent:
    // works on en-US ("Successfully processed 0 files") AND pt-BR
    // ("Nenhum arquivo correspondente...") because neither phrase is
    // what we match on.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // The key file must exist for the Windows branch to probe — the
    // check calls existsSync upfront and fails if absent. Point the
    // test at a file we know exists (the test file itself).
    const keyPath = join(homedir(), '.ssh', 'google_compute_engine');
    vi.mocked(shell).mockResolvedValue({
      stdout: 'Successfully processed 0 files; Failed processing 0 files',
      stderr: '',
    });
    // Skip this test if the SSH key doesn't exist on the CI runner —
    // existsSync guard would return false before reaching icacls mock.
    if (!existsSyncReal(keyPath)) return;
    expect(await gate.check(buildConfig())).toBe(true);
    // Called once per loose SID (4 total) — iteration stops early on
    // the first match, but no-match path visits all four.
    expect(vi.mocked(shell).mock.calls.length).toBe(4);
  });

  it('Windows: fails when icacls stdout contains a loose SID (e.g. S-1-1-0 Everyone)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const keyPath = join(homedir(), '.ssh', 'google_compute_engine');
    if (!existsSyncReal(keyPath)) return;
    // icacls prints the SID in its output when the SID is present in
    // the ACL. The first call hits S-1-1-0 (Everyone).
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: `${keyPath} Everyone:(R,W)\n  S-1-1-0\nSuccessfully processed 1 files`,
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('Windows: fails when the key file does not exist (fail-closed)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // Override HOME to a tmpdir that definitely has no ~/.ssh/google_compute_engine
    const originalHome = process.env.HOME;
    const originalUserprofile = process.env.USERPROFILE;
    const emptyHome = join(tmpdir(), `lox-no-ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(emptyHome, { recursive: true });
    process.env.HOME = emptyHome;
    process.env.USERPROFILE = emptyHome;
    try {
      expect(await gate.check(buildConfig())).toBe(false);
      // icacls must NOT be called when the file doesn't exist
      expect(vi.mocked(shell)).not.toHaveBeenCalled();
    } finally {
      if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
      if (originalUserprofile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserprofile;
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('Windows: fails when icacls itself throws (fail-closed, does not trust silently)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const keyPath = join(homedir(), '.ssh', 'google_compute_engine');
    if (!existsSyncReal(keyPath)) return;
    vi.mocked(shell).mockRejectedValue(Object.assign(new Error('Command failed'), {
      stderr: 'Access is denied',
    }));
    // Audit that can't verify should report failure, not pass silently.
    expect(await gate.check(buildConfig())).toBe(false);
  });
});

describe('Remote URL HTTPS gate (#119)', () => {
  const gate = findGate('Remote URL uses HTTPS');

  beforeEach(() => { vi.mocked(shell).mockReset(); });

  it('passes when the actual git remote URL starts with https://', async () => {
    // Previously the check looked at config.vault.repo ("alice/lox-vault")
    // which NEVER starts with https:// — always failed. Now it queries
    // `git -C <local_path> remote get-url origin` to verify the real URL.
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'https://github.com/alice/lox-vault.git\n', stderr: '' });
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('fails when the remote URL is SSH (git@github.com:...)', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'git@github.com:alice/lox-vault.git\n', stderr: '' });
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when git remote get-url fails (not a git repo, missing remote)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(new Error('fatal: No such remote'));
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('expands ~ in local_path before invoking git -C', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'https://github.com/a/b.git\n', stderr: '' });
    await gate.check(buildConfig({
      vault: { repo: 'a/b', local_path: '~/Obsidian/Lox', preset: 'para' } as LoxConfig['vault'],
    }));
    const args = vi.mocked(shell).mock.calls[0][1] as string[];
    // -C <path> ... — path must NOT start with '~' (unexpanded)
    const dashC = args.indexOf('-C');
    expect(dashC).toBeGreaterThanOrEqual(0);
    expect(args[dashC + 1]).not.toMatch(/^~/);
  });
});

describe('.gitignore sensitive patterns gate (#119)', () => {
  const gate = findGate('.gitignore covers sensitive patterns');
  let workDir: string;

  beforeEach(() => {
    workDir = join(tmpdir(), `lox-gitignore-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('passes when .gitignore contains all required patterns', async () => {
    writeFileSync(join(workDir, '.gitignore'), [
      '.env',
      '.env.*',
      '*.pem',
      '*.key',
      'credentials.json',
      'service-account*.json',
    ].join('\n'));
    expect(await gate.check(buildConfig({
      vault: { repo: 'a/b', local_path: workDir, preset: 'para' } as LoxConfig['vault'],
    }))).toBe(true);
  });

  it('fails when .gitignore is missing a required pattern', async () => {
    writeFileSync(join(workDir, '.gitignore'), '.env\n*.pem\n'); // missing *.key, credentials.json
    expect(await gate.check(buildConfig({
      vault: { repo: 'a/b', local_path: workDir, preset: 'para' } as LoxConfig['vault'],
    }))).toBe(false);
  });

  it('fails when .gitignore does not exist at the vault path', async () => {
    // No writeFileSync — directory is empty
    expect(await gate.check(buildConfig({
      vault: { repo: 'a/b', local_path: workDir, preset: 'para' } as LoxConfig['vault'],
    }))).toBe(false);
  });

  it('expands ~ in local_path (regression for #119 item 7)', async () => {
    // Previously the check `cat`ed `~/Obsidian/Lox/.gitignore` as a literal
    // path. `cat` does NOT shell-expand `~`, so the check always failed
    // when local_path used tilde notation. Simulate by passing a tilde
    // path that resolves to a real dir on this machine.
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!home || !workDir.startsWith(home)) {
      // Cannot simulate tilde path on this CI — skip without failing
      return;
    }
    writeFileSync(join(workDir, '.gitignore'), '.env\n*.pem\n*.key\ncredentials.json\n');
    const tildePath = '~' + workDir.slice(home.length);
    expect(await gate.check(buildConfig({
      vault: { repo: 'a/b', local_path: tildePath, preset: 'para' } as LoxConfig['vault'],
    }))).toBe(true);
  });
});

describe('VM public IP restricted to VPN endpoint gate (#119 PR-B)', () => {
  const gate = findGate('VM public IP restricted to VPN endpoint');

  beforeEach(() => { vi.mocked(shell).mockReset(); });

  it('passes when VM has zero access configs (truly no public IP)', async () => {
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: JSON.stringify({ networkInterfaces: [{}] }),
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('passes when networkInterfaces is an empty array', async () => {
    // gcloud's behaviour when the VM has its external IP released but
    // the interface still listed can produce an empty interfaces array
    // via the JSON projection. Strictly safer than vpn-only; should pass.
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: JSON.stringify({ networkInterfaces: [] }),
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('passes when VM has exactly one access config named "vpn-only"', async () => {
    // This is the correct-by-design state: step 8 (step-vpn.ts) attaches
    // a static IP via `gcloud compute instances add-access-config
    // --access-config-name=vpn-only` because WireGuard needs a reachable
    // UDP endpoint. The firewall (gate #4) separately guarantees only
    // UDP 51820 is open to 0.0.0.0/0.
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: JSON.stringify({
        networkInterfaces: [{
          accessConfigs: [{ name: 'vpn-only', natIP: '35.196.10.20' }],
        }],
      }),
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(true);
  });

  it('fails when VM has a single access config with the default "external-nat" name', async () => {
    // If someone manually re-creates the VM without --no-address OR
    // attaches an access config via `gcloud compute instances add-access-config`
    // without `--access-config-name=vpn-only`, the default name is
    // "external-nat" (or "External NAT"). That's NOT our VPN endpoint —
    // it means an unintended public IP exists.
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: JSON.stringify({
        networkInterfaces: [{
          accessConfigs: [{ name: 'external-nat', natIP: '35.196.10.20' }],
        }],
      }),
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when VM has two access configs (extra IP attached)', async () => {
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: JSON.stringify({
        networkInterfaces: [{
          accessConfigs: [
            { name: 'vpn-only', natIP: '35.196.10.20' },
            { name: 'debug', natIP: '34.150.0.99' },
          ],
        }],
      }),
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when VM has access configs on multiple network interfaces', async () => {
    // Defense in depth: a VM with two NICs each holding an access config
    // would pass a naive "first-interface" check but shouldn't pass ours.
    vi.mocked(shell).mockResolvedValueOnce({
      stdout: JSON.stringify({
        networkInterfaces: [
          { accessConfigs: [{ name: 'vpn-only', natIP: '35.196.10.20' }] },
          { accessConfigs: [{ name: 'external-nat', natIP: '34.150.0.99' }] },
        ],
      }),
      stderr: '',
    });
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when gcloud describe fails (VM missing, auth error)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(Object.assign(new Error('Command failed'), {
      stderr: 'ERROR: (gcloud.compute.instances.describe) NOT_FOUND: instance not found',
    }));
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when gcloud returns malformed JSON', async () => {
    vi.mocked(shell).mockResolvedValueOnce({ stdout: 'not json', stderr: '' });
    expect(await gate.check(buildConfig())).toBe(false);
  });
});

describe('SSH hardening gate (#119 PR-C)', () => {
  const gate = findGate('SSH: no password auth, no root login');

  beforeEach(() => { vi.mocked(shell).mockReset(); });

  it('passes when both PasswordAuthentication and PermitRootLogin are "no"', async () => {
    // Step 7 (vm_phase_ssh_hardening) runs sed to set both. The gate
    // verifies each setting with a separate gcloud SSH call (#119:
    // previously used && in --command which broke on Windows cmd.exe).
    vi.mocked(shell)
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })   // PasswordAuthentication no
      .mockResolvedValueOnce({ stdout: '1', stderr: '' });   // PermitRootLogin no
    expect(await gate.check(buildConfig())).toBe(true);
    // MUST be two separate SSH calls, no && chain
    expect(vi.mocked(shell)).toHaveBeenCalledTimes(2);
  });

  it('fails when PasswordAuthentication is not hardened', async () => {
    vi.mocked(shell)
      .mockResolvedValueOnce({ stdout: '0', stderr: '' })   // PasswordAuth grep finds 0 matches
      .mockResolvedValueOnce({ stdout: '1', stderr: '' });   // PermitRootLogin is fine
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when PermitRootLogin is not hardened', async () => {
    vi.mocked(shell)
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })   // PasswordAuth is fine
      .mockResolvedValueOnce({ stdout: '0', stderr: '' });   // Root login grep finds 0 matches
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('fails when the first SSH call throws (connection error)', async () => {
    vi.mocked(shell).mockRejectedValueOnce(new Error('SSH connection timed out'));
    expect(await gate.check(buildConfig())).toBe(false);
    // Must not attempt the second SSH call
    expect(vi.mocked(shell)).toHaveBeenCalledTimes(1);
  });

  it('fails when the second SSH call throws', async () => {
    vi.mocked(shell)
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })
      .mockRejectedValueOnce(new Error('SSH connection reset'));
    expect(await gate.check(buildConfig())).toBe(false);
  });

  it('each SSH call does NOT contain && (regression test for Windows cmd.exe)', async () => {
    vi.mocked(shell)
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })
      .mockResolvedValueOnce({ stdout: '1', stderr: '' });
    await gate.check(buildConfig());
    for (const call of vi.mocked(shell).mock.calls) {
      const args = call[1] as string[];
      const commandArg = args[args.indexOf('--command') + 1] ?? '';
      expect(commandArg).not.toContain('&&');
    }
  });
});
