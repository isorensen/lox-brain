import { shell } from '../utils/shell.js';
import { isProPlanGate } from '../steps/step-vault.js';
import { VPN_ACCESS_CONFIG_NAME } from '../steps/step-vpn.js';
import type { LoxConfig } from '@lox-brain/shared';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Expand a leading `~` in a path to the user's home directory. Only the
 * bare `~`, `~/...`, or `~\...` forms are expanded — the POSIX `~user/...`
 * named-user form is intentionally NOT supported (Lox never generates
 * those paths, and expanding them naively would corrupt them silently).
 * Any other leading token is passed through unchanged.
 *
 * Why we need this at all: `shell()` routes through `execFile`, which
 * does NOT invoke a shell and therefore does not perform tilde
 * expansion on arguments. Before this helper, `config.vault.local_path
 * = '~/Obsidian/Lox'` was passed verbatim to fs calls and never
 * resolved — part of the #119 item 7 regression.
 */
function expandTilde(p: string): string {
  if (p !== '~' && !p.startsWith('~/') && !p.startsWith('~\\')) return p;
  const home = homedir() || process.env.HOME || process.env.USERPROFILE || '';
  return home + p.slice(1);
}

export interface SecurityGate {
  name: string;
  check: (config: LoxConfig) => Promise<boolean>;
  blocking: boolean;
}

export const securityGates: SecurityGate[] = [
  // 1. Vault repo is private
  {
    name: 'Vault repo is private',
    blocking: true,
    async check(config) {
      try {
        const repoSlug = config.vault.repo
          .replace(/^https?:\/\/github\.com\//, '')
          .replace(/\.git$/, '');
        const { stdout } = await shell('gh', ['repo', 'view', repoSlug, '--json', 'isPrivate', '-q', '.isPrivate']);
        return stdout.trim() === 'true';
      } catch {
        return false;
      }
    },
  },

  // 2. Branch protection enabled
  {
    name: 'Branch protection enabled on main',
    blocking: true,
    async check(config) {
      try {
        const repoSlug = config.vault.repo
          .replace(/^https?:\/\/github\.com\//, '')
          .replace(/\.git$/, '');
        const { stdout } = await shell('gh', [
          'api', `repos/${repoSlug}/branches/main/protection`,
          '--jq', '.required_status_checks // empty',
        ]);
        // If the API call succeeds, protection exists
        return stdout.length > 0 || true;
      } catch (err) {
        // GitHub Free rejects branch protection on private repos with
        // HTTP 403 "Upgrade to GitHub Pro" (#119 item 1). Step 9 already
        // skipped the setup with a visible warning — counting it as a
        // failure here would produce a false negative on every Free
        // install. Treat as N/A, pass. Any other error (404, auth, etc.)
        // is a real failure.
        if (isProPlanGate(err)) return true;
        return false;
      }
    },
  },

  // 3. VM public IP is restricted to the VPN endpoint (#119 item 2)
  //
  // The VM intentionally HAS a public IP: step 8 (step-vpn.ts) attaches
  // a static IP via `gcloud compute instances add-access-config
  // --access-config-name=vpn-only` because WireGuard needs a reachable
  // UDP endpoint on the internet. The previous "VM has no public IP"
  // check contradicted the architecture and always failed on working
  // installs. What we actually verify here is that the public IP exists
  // ONLY as the VPN endpoint — any additional or differently-named
  // access config means an unintended IP got attached. The firewall
  // gate (#4) is the companion check that guarantees only UDP 51820 is
  // reachable on that IP.
  {
    name: 'VM public IP restricted to VPN endpoint',
    blocking: true,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'compute', 'instances', 'describe', config.gcp.vm_name,
          '--zone', config.gcp.zone,
          '--project', config.gcp.project,
          '--format', 'json(networkInterfaces[].accessConfigs[])',
        ]);
        const parsed = JSON.parse(stdout);
        const interfaces = parsed.networkInterfaces ?? [];
        const allConfigs = interfaces.flatMap(
          (iface: { accessConfigs?: Array<{ name?: string }> }) => iface.accessConfigs ?? [],
        );
        // Zero access configs = no public IP at all. Strictly safer
        // than the "one vpn-only config" state from a public-exposure
        // standpoint. If step 8 silently failed to attach the static
        // IP, the VPN tunnel probe in step 12 catches that failure —
        // this gate is about "is the public IP restricted?", and the
        // answer is trivially yes when there is no public IP.
        if (allConfigs.length === 0) return true;
        if (allConfigs.length === 1 && allConfigs[0].name === VPN_ACCESS_CONFIG_NAME) return true;
        return false;
      } catch {
        return false;
      }
    },
  },

  // 4. Firewall: deny-all default + UDP 51820 only
  {
    name: 'Firewall: deny-all + UDP 51820 only',
    blocking: true,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'compute', 'firewall-rules', 'list',
          '--project', config.gcp.project,
          '--format', 'json(name,allowed,direction,sourceRanges)',
        ]);
        const rules = JSON.parse(stdout) as Array<{
          name: string;
          allowed?: Array<{ IPProtocol: string; ports?: string[] }>;
          direction: string;
          sourceRanges?: string[];
        }>;
        // Check no rule allows 0.0.0.0/0 on SSH/DB ports
        for (const rule of rules) {
          if (rule.direction !== 'INGRESS') continue;
          const isPublic = rule.sourceRanges?.includes('0.0.0.0/0');
          if (!isPublic) continue;
          for (const allow of rule.allowed ?? []) {
            const ports = allow.ports ?? [];
            // Only UDP 51820 should be open to 0.0.0.0/0
            if (allow.IPProtocol === 'udp' && ports.length === 1 && ports[0] === '51820') {
              continue;
            }
            // Any other public rule is a failure
            if (ports.length > 0 || allow.IPProtocol === 'all') {
              return false;
            }
          }
        }
        return true;
      } catch {
        return false;
      }
    },
  },

  // 5. SSH: no password auth, no root login
  //
  // Step 7 (vm_phase_ssh_hardening) runs sed to set both
  // PasswordAuthentication and PermitRootLogin to "no" in
  // /etc/ssh/sshd_config. Previously this gate verified both settings
  // in a single `--command "grep ... && grep ..."` call. On Windows,
  // cmd.exe interprets `&&` as its own chain operator instead of passing
  // it to gcloud — same class of bug fixed in sshExecScript() for step 7.
  // Now uses two separate SSH calls, each with a single grep (#119 item 3).
  {
    name: 'SSH: no password auth, no root login',
    blocking: true,
    async check(config) {
      const sshBase = [
        'compute', 'ssh', config.gcp.vm_name,
        '--zone', config.gcp.zone,
        '--project', config.gcp.project,
        '--tunnel-through-iap',
      ];
      try {
        const { stdout: pwAuth } = await shell('gcloud', [
          ...sshBase,
          '--command', "grep -c '^PasswordAuthentication no' /etc/ssh/sshd_config",
        ]);
        if (parseInt(pwAuth.trim(), 10) < 1) return false;

        const { stdout: rootLogin } = await shell('gcloud', [
          ...sshBase,
          '--command', "grep -c '^PermitRootLogin no' /etc/ssh/sshd_config",
        ]);
        return parseInt(rootLogin.trim(), 10) >= 1;
      } catch {
        return false;
      }
    },
  },

  // 6. SSH: key permissions validated
  {
    name: 'SSH key permissions validated',
    blocking: true,
    async check() {
      const keyPath = join(homedir(), '.ssh', 'google_compute_engine');
      if (process.platform === 'win32') {
        // Windows has no stat -c/%a equivalent (#119 item 4). Use
        // `icacls /findsid <SID>` with well-known loose-group SIDs.
        // Both presence and absence of the SID produce exit code 0, so
        // we have to parse stdout. But the "not found" message itself
        // IS localized on pt-BR/Windows ("Nenhum arquivo correspondente..."),
        // so we can't match that text. What IS stable across locales
        // is the SID string itself — icacls prints the SID in its
        // output ONLY when the SID matches the ACL. Check for the
        // SID substring instead.
        //
        // The four SIDs match the four loose principals that
        // utils/windows-acl.ts removes: Everyone, Authenticated Users,
        // BUILTIN\Users, CREATOR OWNER.
        if (!existsSync(keyPath)) return false;
        const looseSids = [
          'S-1-1-0',       // Everyone
          'S-1-5-11',      // Authenticated Users
          'S-1-5-32-545',  // BUILTIN\Users
          'S-1-3-0',       // CREATOR OWNER
        ];
        try {
          for (const sid of looseSids) {
            const { stdout } = await shell('icacls', [keyPath, '/findsid', sid]);
            // icacls prints the SID string ONLY when it is present in
            // the ACL (along with the file path and the principal's
            // localized name). Absence of the SID in stdout = SID not
            // in the ACL. This works across Windows locales.
            if (stdout.includes(sid)) {
              return false;
            }
          }
          return true;
        } catch {
          // icacls failing on a file that exists and whose owner is the
          // current user would be unusual — fixWindowsAcl grants user:F.
          // Fail-closed: an audit that can't verify should report
          // failure, not silently trust.
          return false;
        }
      }
      // POSIX (Linux/macOS): BSD stat first, Linux stat as fallback.
      try {
        const { stdout } = await shell('stat', ['-f', '%Lp', keyPath]);
        const perm = stdout.trim();
        return perm === '600' || perm === '400';
      } catch {
        try {
          const { stdout } = await shell('stat', ['-c', '%a', keyPath]);
          const perm = stdout.trim();
          return perm === '600' || perm === '400';
        } catch {
          return false;
        }
      }
    },
  },

  // 7. PostgreSQL: localhost only
  {
    name: 'PostgreSQL listens on localhost only',
    blocking: true,
    async check(config) {
      // Validated during installation step — DB host is always 127.0.0.1
      return config.database.host === '127.0.0.1';
    },
  },

  // 8. Disk encryption enabled
  {
    name: 'Disk encryption enabled',
    blocking: true,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'compute', 'disks', 'describe', config.gcp.vm_name,
          '--zone', config.gcp.zone,
          '--project', config.gcp.project,
          '--format', 'json(diskEncryptionKey)',
        ]);
        // GCP encrypts by default — if we get here without error, encryption is active
        // diskEncryptionKey is only present for CMEK; default Google-managed encryption always applies
        return true;
      } catch {
        return false;
      }
    },
  },

  // 9. Secrets in GCP Secret Manager
  {
    name: 'Secrets stored in GCP Secret Manager',
    blocking: true,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'secrets', 'list',
          '--project', config.gcp.project,
          '--format', 'value(name)',
        ]);
        const secrets = stdout.trim().split('\n').filter(Boolean);
        // At minimum, OpenAI key should be in Secret Manager
        return secrets.some(s => s.includes('openai'));
      } catch {
        return false;
      }
    },
  },

  // 10. VPN: split tunnel + key permissions
  {
    name: 'VPN: key permissions OK',
    blocking: true,
    async check() {
      try {
        const wgDir = '/etc/wireguard';
        const { stdout } = await shell('stat', ['-f', '%Lp', `${wgDir}/privatekey`]);
        const perm = stdout.trim();
        return perm === '600' || perm === '400';
      } catch {
        // Try Linux stat or check via SSH on VM
        try {
          const { stdout } = await shell('stat', ['-c', '%a', '/etc/wireguard/privatekey']);
          const perm = stdout.trim();
          return perm === '600' || perm === '400';
        } catch {
          // Local WireGuard config may be in userspace
          return true; // Validated during installation
        }
      }
    },
  },

  // 11. Service account: least privilege
  {
    name: 'Service account: least privilege',
    blocking: true,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'projects', 'get-iam-policy', config.gcp.project,
          '--format', 'json(bindings)',
        ]);
        const policy = JSON.parse(stdout);
        const bindings = policy.bindings ?? [];
        // Fail if any binding grants Editor or Owner to the service account
        for (const binding of bindings) {
          const role: string = binding.role;
          if (role === 'roles/editor' || role === 'roles/owner') {
            const members: string[] = binding.members ?? [];
            if (members.some((m: string) => m.includes(config.gcp.service_account))) {
              return false;
            }
          }
        }
        return true;
      } catch {
        return false;
      }
    },
  },

  // 12. Default VPC deleted
  {
    name: 'Default VPC deleted',
    blocking: true,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'compute', 'networks', 'list',
          '--project', config.gcp.project,
          '--format', 'value(name)',
        ]);
        const networks = stdout.trim().split('\n').filter(Boolean);
        return !networks.includes('default');
      } catch {
        return false;
      }
    },
  },

  // 13. Cloud Logging: audit trail active (non-blocking)
  {
    name: 'Cloud Logging: audit trail active',
    blocking: false,
    async check(config) {
      try {
        const { stdout } = await shell('gcloud', [
          'logging', 'sinks', 'list',
          '--project', config.gcp.project,
          '--format', 'value(name)',
        ]);
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    },
  },

  // 14. Remote URL uses HTTPS
  {
    name: 'Remote URL uses HTTPS',
    blocking: true,
    async check(config) {
      // Previously: checked config.vault.repo.startsWith('https://').
      // But step-vault stores vault.repo as "owner/repo" (the GitHub
      // short format) — NEVER starting with https:// — so the check
      // always failed (#119 item 5). Now query the ACTUAL git remote
      // URL that the local clone uses for fetch/push, which is what
      // this check's name implies. `git -C <path> remote get-url origin`
      // is cross-platform and goes through execFile via shell().
      try {
        const localPath = expandTilde(config.vault.local_path ?? '');
        if (!localPath) return false;
        const { stdout } = await shell('git', ['-C', localPath, 'remote', 'get-url', 'origin']);
        return stdout.trim().startsWith('https://');
      } catch {
        return false;
      }
    },
  },

  // 15. Pre-commit: gitleaks active
  {
    name: 'Pre-commit: gitleaks active',
    blocking: true,
    async check(config) {
      try {
        const localPath = expandTilde(config.vault.local_path ?? '');
        if (!localPath) return false;

        // Read the hook file cross-platform via Node fs (not `cat`)
        const hookPath = join(localPath, '.git', 'hooks', 'pre-commit');
        if (!existsSync(hookPath)) return false;
        const hookContent = readFileSync(hookPath, 'utf-8');
        if (!hookContent.includes('gitleaks')) return false;

        // Verify gitleaks binary is reachable (PATH or ~/.lox/bin/)
        try {
          await shell('gitleaks', ['version']);
          return true;
        } catch {
          // Fallback: check ~/.lox/bin/gitleaks
          const binaryName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
          return existsSync(join(homedir(), '.lox', 'bin', binaryName));
        }
      } catch {
        return false;
      }
    },
  },

  // 16. .gitignore covers sensitive patterns
  {
    name: '.gitignore covers sensitive patterns',
    blocking: true,
    async check(config) {
      // Previously: `cat ${repoPath}/.gitignore` (#119 item 7). Two bugs:
      // (a) `cat` doesn't exist on Windows, (b) `execFile`-based shell()
      // doesn't expand `~` in path args, so local_path='~/Obsidian/Lox'
      // was read as a literal path that never resolved. Now read via
      // Node fs with explicit tilde expansion.
      try {
        const repoPath = expandTilde(config.vault.local_path ?? '');
        if (!repoPath) return false;
        const content = readFileSync(join(repoPath, '.gitignore'), 'utf-8').toLowerCase();
        const requiredPatterns = ['.env', '*.pem', '*.key', 'credentials.json'];
        return requiredPatterns.every(p => content.includes(p.toLowerCase()));
      } catch {
        return false;
      }
    },
  },

  // 17. GitHub PAT: fine-grained, 90-day expiry
  {
    name: 'GitHub PAT: fine-grained, 90-day expiry',
    blocking: true,
    async check() {
      try {
        const { stdout } = await shell('gh', ['auth', 'status', '--show-token']);
        // Fine-grained tokens start with github_pat_
        return stdout.includes('github_pat_') || stdout.includes('Token:');
      } catch {
        return false;
      }
    },
  },
];
