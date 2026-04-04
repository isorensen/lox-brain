import chalk from 'chalk';
import { shell, getPlatform } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader, renderBox } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/**
 * Detect the GitHub Free plan "upgrade to Pro" gate when setting branch
 * protection on a private repository. The error text may appear in either
 * err.message or err.stderr depending on how the child process surfaces it.
 */
export function isProPlanGate(err: unknown): boolean {
  const parts: string[] = [];
  if (err instanceof Error) parts.push(err.message);
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr: unknown }).stderr;
    if (typeof stderr === 'string') parts.push(stderr);
  }
  // Check each surface independently — both signals must appear in the SAME string
  // to avoid false positives from unrelated mentions across message and stderr.
  return parts.some(p => p.includes('HTTP 403') && p.includes('Upgrade to GitHub Pro'));
}

const GITIGNORE_CONTENT = `# Security — NEVER commit secrets
.env
.env.*
*.pem
*.key
*.p12
*.pfx
credentials.json
service-account*.json
token*.json
*secret*
*.gpg

# OS
.DS_Store
Thumbs.db
desktop.ini

# Obsidian — sync config but not workspace state
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
`;

const GITLEAKS_HOOK = `#!/usr/bin/env bash
# gitleaks pre-commit hook — blocks secrets from being committed
if command -v gitleaks &> /dev/null; then
  gitleaks protect --staged --verbose
  if [ $? -ne 0 ]; then
    echo "ERROR: gitleaks detected secrets. Commit blocked."
    exit 1
  fi
else
  echo "WARNING: gitleaks not installed. Skipping secret scan."
fi
`;

/**
 * Get the GitHub username from the authenticated gh CLI.
 */
async function getGitHubUser(): Promise<string> {
  const { stdout } = await shell('gh', ['api', 'user', '--jq', '.login']);
  return stdout.trim();
}

/**
 * Validate that a GitHub repo is private.
 */
async function isRepoPrivate(repo: string): Promise<boolean> {
  const { stdout } = await shell('gh', ['repo', 'view', repo, '--json', 'isPrivate', '--jq', '.isPrivate']);
  return stdout.trim() === 'true';
}

/**
 * Detect a "repo does not exist" error from `gh repo view`. Used to distinguish
 * missing repos (expected) from real failures (auth, network, permissions).
 * Both GitHub GraphQL and REST surface this differently, so we match both.
 */
export function isRepoNotFoundError(err: unknown): boolean {
  const parts: string[] = [];
  if (err instanceof Error) parts.push(err.message);
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr: unknown }).stderr;
    if (typeof stderr === 'string') parts.push(stderr);
  }
  // Match gh's two shapes for "repo does not exist" precisely. Avoid a bare
  // 'HTTP 404' match, which could false-positive on unrelated 404s.
  return parts.some(p =>
    p.includes('Could not resolve to a Repository') ||
    (p.includes('HTTP 404') && p.includes('Not Found')),
  );
}

/**
 * Build the bash script that configures git sync on the VM. The script:
 *   1. Writes ~/sync-vault.sh with the periodic git pull/commit/push logic.
 *   2. Installs a crontab entry running every 2 minutes (idempotent — removes
 *      any matching prior line before adding, so re-runs don't duplicate).
 *   3. Removes itself after running.
 *
 * It is uploaded to the VM as a file and executed with a plain
 * `bash /tmp/lox-setup-sync.sh` — this avoids passing shell metacharacters
 * through `gcloud ... --command`, which fails on Windows cmd.exe (see #61).
 */
export const VM_SETUP_SCRIPT_REMOTE_PATH = '/tmp/lox-setup-sync.sh';

export function buildVmSetupScript(): string {
  // cronLine must not contain single quotes — embedded in a single-quoted bash assignment below.
  const cronLine = '*/2 * * * * ~/sync-vault.sh >> ~/sync-vault.log 2>&1';
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    '',
    "cat > ~/sync-vault.sh <<'LOX_SYNC_EOF'",
    '#!/bin/bash',
    'set -euo pipefail',
    'cd ~/lox-vault',
    'git fetch origin main',
    'git merge --ff-only origin/main || true',
    'git add -A',
    'git diff --cached --quiet || git commit -m "auto-sync $(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    'git push origin main',
    'LOX_SYNC_EOF',
    'chmod +x ~/sync-vault.sh',
    '',
    `CRON_LINE='${cronLine}'`,
    '(crontab -l 2>/dev/null | grep -v -F "$CRON_LINE" || true; echo "$CRON_LINE") | crontab -',
    '',
    'rm -- "$0"',
    '',
  ].join('\n');
}

/**
 * Validate the shape of a pasted GitHub Personal Access Token.
 * We don't call GitHub — we just rule out obvious paste corruption
 * (whitespace, wrong prefix, truncation, stray quotes). A token that
 * passes this check may still be invalid/expired; that surfaces when
 * git sync runs on the VM. Returning false here just means "definitely
 * not a PAT" so we can re-prompt without bothering the GitHub API.
 *
 * Accepts both fine-grained (`github_pat_`) and classic (`ghp_`) tokens.
 * The installer's UI recommends fine-grained, but we don't reject a
 * working classic PAT over a prefix mismatch.
 */
export function isValidPatFormat(token: string): boolean {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  // Fine-grained PATs are ~93+ chars (github_pat_ + 82 chars of payload).
  // Classic PATs are exactly 40 chars (ghp_ + 36 chars). Use a forgiving
  // lower bound of 36 characters of suffix to tolerate minor format drift.
  return /^(github_pat_|ghp_)[A-Za-z0-9_]{36,}$/.test(trimmed);
}

/**
 * Check whether a GCP Secret Manager secret already exists in the given project.
 * Returns true on success, false when the secret is not found, and rethrows on
 * other failures (auth, billing, API disabled) so real problems surface.
 */
export async function gcpSecretExists(secretName: string, projectId: string): Promise<boolean> {
  try {
    await shell('gcloud', ['secrets', 'describe', secretName, '--project', projectId]);
    return true;
  } catch (err) {
    const parts: string[] = [];
    if (err instanceof Error) parts.push(err.message);
    if (err && typeof err === 'object' && 'stderr' in err) {
      const stderr = (err as { stderr: unknown }).stderr;
      if (typeof stderr === 'string') parts.push(stderr);
    }
    const isNotFound = parts.some(p =>
      p.includes('NOT_FOUND') || (p.includes('Secret') && p.includes('was not found')),
    );
    if (isNotFound) return false;
    throw err;
  }
}

/**
 * Check whether a GitHub repo exists and is accessible to the current user.
 * Returns false only for "not found" errors; rethrows other failures (auth,
 * network, missing `gh`) so they surface with the real cause.
 */
export async function repoExists(repo: string): Promise<boolean> {
  try {
    await shell('gh', ['repo', 'view', repo, '--json', 'name', '--jq', '.name']);
    return true;
  } catch (err) {
    if (isRepoNotFoundError(err)) return false;
    throw err;
  }
}

/**
 * Step 9: Vault Setup
 *
 * Creates a private GitHub repo for the vault, sets up templates,
 * security patterns, branch protection, git sync cron, and gitleaks hook.
 */
export async function stepVault(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(9, TOTAL_STEPS, strings.step_git_sync));

  // 1. Ask vault preset
  const { select, input, confirm, password } = await import('@inquirer/prompts');
  const { existsSync: fsExistsSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const preset = await select({
    message: strings.step_vault_preset,
    choices: [
      { name: strings.preset_zettelkasten, value: 'zettelkasten' as const, description: strings.preset_zettelkasten_desc },
      { name: strings.preset_para, value: 'para' as const, description: strings.preset_para_desc },
    ],
  });
  ctx.vaultPreset = preset;

  // 2. Create private GitHub repo
  const ghUser = await withSpinner(
    'Detecting GitHub user...',
    () => getGitHubUser(),
  );

  // Resolve a repo name: loop until we have either a missing name (to create)
  // or the user chooses to reuse an existing one. Supports re-runs where
  // lox-vault was already created by a prior attempt (see issue #59).
  // Iteration cap prevents an infinite loop for confused users.
  let repoName = 'lox-vault';
  let action: 'create' | 'reuse' | 'cancel' = 'create';
  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const fullCandidate = `${ghUser}/${repoName}`;
    const exists = await withSpinner(
      `Checking if ${fullCandidate} exists...`,
      () => repoExists(fullCandidate),
    );
    if (!exists) {
      action = 'create';
      break;
    }
    console.log(chalk.yellow(`  ⚠ Repo ${fullCandidate} already exists on your account.`));
    const choice = await select({
      message: 'How would you like to proceed?',
      choices: [
        { name: `Reuse existing (clone ${fullCandidate})`, value: 'reuse' as const },
        { name: 'Use a different repo name', value: 'rename' as const },
        { name: 'Cancel vault setup', value: 'cancel' as const },
      ],
    });
    if (choice === 'reuse') { action = 'reuse'; break; }
    if (choice === 'cancel') { action = 'cancel'; break; }
    const newName = await input({
      message: 'Enter a new repo name:',
      default: repoName,
      validate: (v) => /^[A-Za-z0-9._-]+$/.test(v.trim()) || 'Only letters, digits, dot, underscore, hyphen.',
    });
    repoName = newName.trim();
  }
  if (action === 'cancel') {
    return { success: false, message: 'Vault setup cancelled by user.' };
  }

  const fullRepo = `${ghUser}/${repoName}`;
  const vaultDir = repoName;

  // Handle a stale local clone directory from a prior run.
  if (fsExistsSync(vaultDir)) {
    console.log(chalk.yellow(`  ⚠ Local directory ./${vaultDir} already exists.`));
    const removeIt = await confirm({
      message: `Remove ./${vaultDir} and continue? (choose No to abort)`,
      default: false,
    });
    if (!removeIt) {
      return { success: false, message: `Aborted: ./${vaultDir} already exists.` };
    }
    try {
      rmSync(vaultDir, { recursive: true, force: true });
    } catch (err) {
      return {
        success: false,
        message: `Failed to remove ./${vaultDir}: ${(err as Error).message}`,
      };
    }
  }

  if (action === 'create') {
    await withSpinner(
      `${strings.creating} private repo ${fullRepo}...`,
      async () => {
        await shell('gh', ['repo', 'create', fullRepo, '--private', '--clone']);
      },
    );
  } else {
    await withSpinner(
      `Cloning existing repo ${fullRepo}...`,
      async () => {
        await shell('gh', ['repo', 'clone', fullRepo, vaultDir]);
      },
    );
  }

  // 3. Copy template files
  await withSpinner(
    `Copying ${preset} template files...`,
    async () => {
      // Template copy is best-effort; templates may not exist yet in early phases
      try {
        const platform = getPlatform();
        const cpCmd = platform === 'macos' ? 'cp' : 'cp';
        await shell(cpCmd, ['-r', `templates/${preset}/.`, vaultDir]);
      } catch {
        console.log(chalk.yellow('  → Template directory not found, creating empty vault structure.'));
      }
    },
  );

  // 4. Create .gitignore with security patterns
  writeFileSync(join(vaultDir, '.gitignore'), GITIGNORE_CONTENT);
  console.log(chalk.green('  ✓ .gitignore created with security patterns'));

  // 5. Guide fine-grained PAT creation
  const patSecretName = 'lox-github-pat';
  const patInstructions = renderBox([
    'GitHub Fine-Grained PAT Setup',
    '',
    '1. Go to: https://github.com/settings/tokens?type=beta',
    '2. Click "Generate new token"',
    `3. Repository access: Only select repositories → ${fullRepo}`,
    '4. Permissions: Contents (Read and write), Metadata (Read)',
    '5. Generate and copy the token',
    '',
    `The PAT will be stored in GCP Secret Manager as "${patSecretName}"`,
    'and read by the VM for git sync. Paste it when prompted below.',
  ]);
  console.log(`\n${patInstructions}\n`);

  const gcpProjectId = ctx.gcpProjectId ?? 'lox-project';
  const manualCmd = `gcloud secrets create ${patSecretName} --data-file=<path> --project=${gcpProjectId}`;

  // Capture the token (masked) and loop on format validation.
  let patToken = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const entered = await password({
      message: 'Paste your GitHub PAT (input hidden, empty to skip):',
      mask: '*',
    });
    const trimmed = entered.trim();
    if (trimmed === '') {
      console.log(chalk.yellow(`  ⚠ Skipped. Store the PAT manually later with:\n    ${manualCmd}`));
      break;
    }
    if (!isValidPatFormat(trimmed)) {
      console.log(chalk.red('  ✗ That does not look like a GitHub PAT (expected prefix github_pat_ or ghp_). Try again.'));
      continue;
    }
    patToken = trimmed;
    break;
  }

  // Store the token in GCP Secret Manager if we captured one.
  if (patToken !== '') {
    const { tmpdir } = await import('node:os');
    const patTempPath = join(tmpdir(), `lox-pat-${Date.now()}.txt`);
    try {
      writeFileSync(patTempPath, patToken, { mode: 0o600 });
      const exists = await gcpSecretExists(patSecretName, gcpProjectId);
      await withSpinner(
        `${exists ? 'Adding new version to' : 'Creating'} secret ${patSecretName}...`,
        async () => {
          // Pass --data-file as two separate args so paths with spaces
          // (Windows temp dirs like C:\Users\First Last\...) survive
          // cmd.exe tokenization correctly.
          const args = exists
            ? ['secrets', 'versions', 'add', patSecretName, '--data-file', patTempPath, '--project', gcpProjectId]
            : ['secrets', 'create', patSecretName, '--data-file', patTempPath, '--project', gcpProjectId, '--replication-policy=automatic'];
          await shell('gcloud', args);
        },
      );
      console.log(chalk.green(
        `  ✓ PAT stored in Secret Manager (secret: ${patSecretName}, project: ${gcpProjectId})`,
      ));
    } catch (err) {
      // Never surface the token — only the failure reason.
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(
        `  ⚠ Failed to store PAT in Secret Manager: ${msg}\n    Store manually: ${manualCmd}`,
      ));
    } finally {
      try { rmSync(patTempPath, { force: true }); } catch { /* best-effort */ }
    }
  }

  // 6. Set up branch protection (graceful degradation for GitHub Free + private repos)
  try {
    await withSpinner(
      'Setting up branch protection...',
      async () => {
        await shell('gh', [
          'api',
          `repos/${fullRepo}/branches/main/protection`,
          '-X', 'PUT',
          '-H', 'Accept: application/vnd.github+json',
          '-f', 'required_status_checks=null',
          '-f', 'enforce_admins=true',
          '-f', 'required_pull_request_reviews=null',
          '-f', 'restrictions=null',
        ]);
      },
    );
  } catch (err) {
    if (isProPlanGate(err)) {
      console.log(chalk.yellow(
        '  ⚠ Branch protection skipped — requires GitHub Pro for private repos. Installation will continue.',
      ));
    } else {
      throw err;
    }
  }

  // 7. Configure git sync cron on VM (via SSH IAP)
  const projectId = ctx.gcpProjectId ?? 'lox-project';
  const vmName = ctx.config.gcp?.vm_name ?? 'lox-vm';
  const zone = ctx.config.gcp?.zone ?? 'us-east1-b';

  await withSpinner(
    'Configuring git sync cron on VM...',
    async () => {
      // Write the full setup (create sync-vault.sh + install cron) into a
      // local temp file, then SCP it to the VM and execute with a plain
      // `bash <path>` command. This avoids passing `|`, `(`, `;`, `&&` etc.
      // through gcloud's --command, which cmd.exe on Windows interprets as
      // its own shell metacharacters and fragments the command (#61).
      const { tmpdir } = await import('node:os');
      const setupScript = buildVmSetupScript();
      const localScriptPath = join(tmpdir(), `lox-setup-sync-${Date.now()}.sh`);
      writeFileSync(localScriptPath, setupScript);

      try {
        // Upload the setup script to the VM via IAP-tunneled SCP. Use an
        // absolute remote path (/tmp) — pscp.exe (Windows Cloud SDK) does
        // not perform tilde expansion, so `~/...` destinations land in a
        // literal directory named "~" and fail (see #64).
        await shell('gcloud', [
          'compute', 'scp',
          '--project', projectId,
          '--zone', zone,
          '--tunnel-through-iap',
          localScriptPath,
          `${vmName}:${VM_SETUP_SCRIPT_REMOTE_PATH}`,
        ], { timeout: 120_000 });

        // Execute the script on the VM — the --command value has no shell
        // metacharacters, so cmd.exe/bash quoting behaves identically.
        await shell('gcloud', [
          'compute', 'ssh', vmName,
          '--project', projectId,
          '--zone', zone,
          '--tunnel-through-iap',
          '--command', `bash ${VM_SETUP_SCRIPT_REMOTE_PATH}`,
        ], { timeout: 120_000 });
      } finally {
        try { rmSync(localScriptPath, { force: true }); } catch { /* best-effort cleanup */ }
      }
    },
  );

  // 8. Install gitleaks pre-commit hook
  const hooksDir = join(vaultDir, '.git', 'hooks');
  if (!fsExistsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  const hookPath = join(hooksDir, 'pre-commit');
  writeFileSync(hookPath, GITLEAKS_HOOK, { mode: 0o755 });
  console.log(chalk.green('  ✓ gitleaks pre-commit hook installed'));

  // Security gate: validate repo is private
  const isPrivate = await isRepoPrivate(fullRepo);
  if (!isPrivate) {
    return {
      success: false,
      message: `Security gate failed: repo ${fullRepo} is not private. Make it private before continuing.`,
    };
  }
  console.log(chalk.green('  ✓ Security gate: repo is private'));

  // Store vault config
  ctx.config.vault = {
    repo: fullRepo,
    local_path: `~/Obsidian/Lox`,
    preset,
  };

  return { success: true };
}
