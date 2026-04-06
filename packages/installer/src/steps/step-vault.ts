import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader, renderBox } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

/**
 * Locate the bundled templates directory relative to THIS compiled module
 * (not CWD — the installer may be invoked from any directory). Compiled
 * layout: `packages/installer/dist/steps/step-vault.js` → go up 4 dirs to
 * the repo root where `templates/<preset>/` lives.
 *
 * Uses CommonJS `__dirname` (the installer ships as CJS via
 * `"type": "commonjs"` in packages/installer/package.json). Exported for
 * tests which assert path resolution without depending on working dir.
 */
export function resolveTemplatesDir(preset: string): string {
  return pathResolve(__dirname, '..', '..', '..', '..', 'templates', preset);
}

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

export const GITLEAKS_HOOK = `#!/usr/bin/env bash
# gitleaks pre-commit hook — blocks secrets from being committed
LOX_GITLEAKS="\${HOME}/.lox/bin/gitleaks"
if command -v gitleaks &> /dev/null; then
  GITLEAKS_CMD="gitleaks"
elif [ -x "$LOX_GITLEAKS" ]; then
  GITLEAKS_CMD="$LOX_GITLEAKS"
else
  echo "WARNING: gitleaks not installed. Skipping secret scan."
  exit 0
fi
$GITLEAKS_CMD protect --staged --verbose
if [ $? -ne 0 ]; then
  echo "ERROR: gitleaks detected secrets. Commit blocked."
  exit 1
fi
`;

/** Pinned gitleaks release version — known stable. */
export const GITLEAKS_VERSION = '8.21.2';

/**
 * Attempt to install the gitleaks binary into `~/.lox/bin/`.
 * Best-effort: returns true on success, false on any failure. Never throws.
 *
 * 1. Check if gitleaks is already on PATH.
 * 2. If not, download the pinned release from GitHub and extract to ~/.lox/bin/.
 * 3. chmod +x on non-Windows.
 */
export async function tryInstallGitleaks(): Promise<boolean> {
  const { join } = await import('node:path');
  const { mkdirSync, chmodSync, existsSync: fsExists } = await import('node:fs');
  const { homedir: osHomedir, tmpdir } = await import('node:os');

  try {
    // Already available on PATH — nothing to do.
    await shell('gitleaks', ['version']);
    return true;
  } catch {
    // Not on PATH — proceed to download.
  }

  try {
    const home = osHomedir();
    const binDir = join(home, '.lox', 'bin');
    mkdirSync(binDir, { recursive: true });

    // Map Node.js values to gitleaks release naming conventions.
    const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
    const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64' };
    const os = osMap[process.platform];
    const arch = archMap[process.arch];
    if (!os || !arch) return false;

    const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.${ext}`;
    const tmpFile = join(tmpdir(), `gitleaks-${Date.now()}.${ext}`);

    await shell('curl', ['-fsSL', '-o', tmpFile, url], { timeout: 120_000 });

    if (process.platform === 'win32') {
      await shell('powershell', [
        '-Command',
        `Expand-Archive -Path '${tmpFile}' -DestinationPath '${binDir}' -Force`,
      ]);
    } else {
      await shell('tar', ['-xzf', tmpFile, '-C', binDir, 'gitleaks']);
    }

    // chmod +x on POSIX
    if (process.platform !== 'win32') {
      const binaryPath = join(binDir, 'gitleaks');
      if (fsExists(binaryPath)) {
        chmodSync(binaryPath, 0o755);
      }
    }

    // Cleanup temp file (best-effort)
    try { (await import('node:fs')).rmSync(tmpFile, { force: true }); } catch { /* ignore */ }

    return true;
  } catch {
    return false;
  }
}

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

export interface VmSetupScriptInput {
  /** GitHub handle that owns the vault repo (used to build the clone URL). */
  githubUser: string;
  /** Vault repo name on GitHub (default 'lox-vault'). */
  repoName: string;
  /** GCP Secret Manager secret name holding the fine-grained PAT. */
  patSecretName: string;
}

export function buildVmSetupScript(input: VmSetupScriptInput): string {
  // cronLine must not contain single quotes — embedded in a single-quoted bash assignment below.
  const cronLine = '*/2 * * * * ~/sync-vault.sh >> ~/sync-vault.log 2>&1';
  // Shell-injection guard on template strings: these values flow from
  // GitHub API + user input. Trust is not guaranteed in user-controlled
  // fields (repoName is user-entered), so restrict the format to the set
  // GitHub actually allows (alphanumeric, dash, dot, underscore).
  const safeRepo = input.repoName.replace(/[^A-Za-z0-9._-]/g, '');
  const safeUser = input.githubUser.replace(/[^A-Za-z0-9-]/g, '');
  // GCP Secret Manager allows underscores in secret names — must include
  // `_` or a user with a secret like `lox_github_pat` gets silent truncation.
  const safeSecret = input.patSecretName.replace(/[^A-Za-z0-9_-]/g, '');
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    '',
    // GIT_ASKPASS helper: fetches the PAT from Secret Manager on every
    // git operation that needs auth. The token never persists in
    // .git/config — git calls this script as a password provider (#107).
    // Single-quoted heredoc tag prevents bash expansion; the secret name
    // is embedded as a JS template literal at script-generation time.
    `cat > ~/.lox-git-askpass.sh <<'ASKPASS_EOF'`,
    '#!/bin/bash',
    `gcloud secrets versions access latest --secret=${safeSecret}`,
    'ASKPASS_EOF',
    'chmod 700 ~/.lox-git-askpass.sh',
    '',
    // #104-B: initial clone of the vault repo on the VM. sync-vault.sh
    // (written below) does `cd ~/lox-vault` and assumes it exists — but
    // step 9 only ever clones the repo on the user's local machine, never
    // on the VM. Without this block, sync-vault.sh fails silently on
    // every cron tick, the vault never appears, and the watcher exits
    // cleanly (chokidar on a missing dir = no-op event loop). Idempotent:
    // skipped if ~/lox-vault/.git already exists.
    'if [ ! -d "$HOME/lox-vault/.git" ]; then',
    '  echo "[lox] Cloning vault repo to ~/lox-vault (one-time)..."',
    '  GIT_ASKPASS="$HOME/.lox-git-askpass.sh" GIT_TERMINAL_PROMPT=0 \\',
    `    git clone "https://x-access-token@github.com/${safeUser}/${safeRepo}.git" "$HOME/lox-vault"`,
    'fi',
    '',
    // Migration: remove embedded PAT from existing installs (#107).
    // Only triggers when the remote URL contains a PAT prefix (ghp_ or
    // github_pat_), replacing it with the clean x-access-token@ URL that
    // delegates auth to GIT_ASKPASS.
    'if git -C "$HOME/lox-vault" remote get-url origin 2>/dev/null | grep -q \'@github.com\'; then',
    '  CURRENT_URL=$(git -C "$HOME/lox-vault" remote get-url origin)',
    '  if echo "$CURRENT_URL" | grep -qE \'https://(ghp_|github_pat_)\'; then',
    '    echo "[lox] Migrating vault remote URL (removing embedded PAT)..."',
    `    git -C "$HOME/lox-vault" remote set-url origin "https://x-access-token@github.com/${safeUser}/${safeRepo}.git"`,
    '  fi',
    'fi',
    '',
    "cat > ~/sync-vault.sh <<'LOX_SYNC_EOF'",
    '#!/bin/bash',
    'set -euo pipefail',
    'export GIT_ASKPASS="$HOME/.lox-git-askpass.sh"',
    'export GIT_TERMINAL_PROMPT=0',
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
 * Top-level entries each template preset MUST produce after `cpSync` (#122).
 *
 * Kept as a static list (not derived from `readdirSync(templatesSrc)`) because
 * the check's job is to catch a silent cpSync failure — reading the source on
 * every verify would paper over a bundling regression where `templates/` is
 * missing from the shipped package entirely. The list is the contract.
 */
export const EXPECTED_TEMPLATE_ENTRIES: Record<string, string[]> = {
  para: [
    '1 - Inbox',
    '2 - Projects',
    '3 - Areas',
    '4 - Resources',
    '5 - Archive',
    'Templates',
    'Welcome to Lox.md',
  ],
  zettelkasten: [
    '1 - Fleeting Notes',
    '2 - Projects',
    '2 - Source Material',
    '3 - Tags',
    '5 - Templates',
    '6 - Atomic Notes',
    '7 - Meeting Notes',
    'attachments',
    'Welcome to Lox.md',
  ],
};

/**
 * Verify that `cpSync(templatesSrc, vaultDir)` actually produced the expected
 * top-level entries (#122). Throws with a diagnostic that includes the source
 * path, destination path, what's missing, and what's actually on disk — this
 * is the information a reporter needs to diagnose why the copy silently
 * failed (typically path resolution on Windows, or packaging regression).
 *
 * Defensive against unknown presets even though the installer's select prompt
 * already constrains `preset` — an untyped extension would otherwise produce
 * a silent pass.
 */
export function verifyTemplatesCopied(vaultDir: string, preset: string, templatesSrc: string): void {
  const expected = EXPECTED_TEMPLATE_ENTRIES[preset];
  if (!expected) {
    throw new Error(`Template copy verification: unknown preset "${preset}"`);
  }
  const actual = readdirSync(vaultDir);
  const actualSet = new Set(actual);
  const missing = expected.filter(entry => !actualSet.has(entry));
  if (missing.length > 0) {
    throw new Error(
      `Template copy verification failed for preset "${preset}".\n`
      + `  templatesSrc: ${templatesSrc}\n`
      + `  vaultDir: ${vaultDir}\n`
      + `  missing: ${missing.join(', ')}\n`
      + `  actual entries: ${actual.length > 0 ? actual.join(', ') : '(empty)'}`,
    );
  }
}

/**
 * Make the initial commit on a freshly-created vault and push to origin/main
 * (#122). Without this step, templates land locally but the GitHub remote and
 * VM clone stay empty — the VM's sync-vault.sh cron has nothing to pull, and
 * Obsidian opens a vault that is never committed anywhere.
 *
 * Idempotent: when nothing is staged (re-run over an already-initialized
 * vault), returns `'nothing-to-commit'` without calling `git commit` or
 * `git push`. Callers should treat both return values as success.
 */
export async function commitInitialVaultTemplate(
  vaultDir: string,
  preset: string,
): Promise<'pushed' | 'nothing-to-commit'> {
  await shell('git', ['-C', vaultDir, 'add', '-A']);
  const { stdout } = await shell('git', ['-C', vaultDir, 'status', '--porcelain']);
  if (stdout.trim() === '') {
    return 'nothing-to-commit';
  }
  // Set a local git identity so `git commit` doesn't fail with
  // "Author identity unknown" on hosts where the user has never set a
  // global git config (fresh Windows installs, CI runners). Scoped to the
  // vault repo — doesn't touch the user's global config.
  await shell('git', ['-C', vaultDir, 'config', 'user.email', 'installer@lox.local']);
  await shell('git', ['-C', vaultDir, 'config', 'user.name', 'Lox Installer']);
  await shell('git', ['-C', vaultDir, 'commit', '-m', `chore: initialize ${preset} template`]);
  await shell('git', ['-C', vaultDir, 'push', 'origin', 'main']);
  return 'pushed';
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
  // Resolve to an absolute path at creation (#122 review): makes subsequent
  // readdirSync / `git -C` calls CWD-independent and ensures diagnostic
  // error messages from verifyTemplatesCopied show an actionable path
  // instead of a bare relative name.
  const vaultDir = pathResolve(process.cwd(), repoName);

  // Handle a stale local clone directory from a prior run.
  if (fsExistsSync(vaultDir)) {
    console.log(chalk.yellow(`  ⚠ Local directory ./${repoName} already exists.`));
    const removeIt = await confirm({
      message: `Remove ./${repoName} and continue? (choose No to abort)`,
      default: false,
    });
    if (!removeIt) {
      return { success: false, message: `Aborted: ./${repoName} already exists.` };
    }
    try {
      rmSync(vaultDir, { recursive: true, force: true });
    } catch (err) {
      return {
        success: false,
        message: `Failed to remove ./${repoName}: ${(err as Error).message}`,
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

  // 3. Copy template files (#105). Uses fs.cpSync — cross-platform,
  // no shell dependency. Previously invoked `cp -r` which doesn't exist
  // on Windows; the silent try/catch then printed a misleading
  // "Template directory not found" message when the real cause was
  // cp missing from PATH. Now we let errors surface and say what's
  // actually missing.
  await withSpinner(
    `Copying ${preset} template files...`,
    async () => {
      const templatesSrc = resolveTemplatesDir(preset);
      if (!existsSync(templatesSrc)) {
        // Genuinely missing templates is a packaging/bundling regression —
        // fail loudly instead of silently producing an empty vault.
        throw new Error(
          `Template directory not found: ${templatesSrc}. `
          + `Check the installer package includes templates/${preset}/.`,
        );
      }
      cpSync(templatesSrc, vaultDir, { recursive: true, force: true });
      // #122: verify the copy landed — previously a silent cpSync failure
      // (path resolution, permissions, packaging regression) produced an
      // empty vault with no error signal anywhere.
      verifyTemplatesCopied(vaultDir, preset, templatesSrc);
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
      const setupScript = buildVmSetupScript({
        githubUser: ghUser,
        repoName,
        patSecretName,
      });
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

  // 8b. Install gitleaks binary (best-effort — never fails the step)
  const gitleaksInstalled = await withSpinner(
    'Installing gitleaks binary...',
    () => tryInstallGitleaks(),
  );
  if (gitleaksInstalled) {
    console.log(chalk.green('  ✓ gitleaks binary available'));
  } else {
    console.log(chalk.yellow(
      '  ⚠ Could not auto-install gitleaks. Install manually:\n'
      + '    brew install gitleaks          # macOS\n'
      + '    sudo apt install gitleaks      # Debian/Ubuntu\n'
      + '    choco install gitleaks         # Windows\n'
      + '    https://github.com/gitleaks/gitleaks/releases',
    ));
  }

  // 9. Initial commit + push (#122). Without this, templates + .gitignore +
  // hook land locally but the GitHub remote stays empty — the VM cron pulls
  // nothing, Obsidian opens a vault that is never committed anywhere, and
  // the user ends up with three disconnected copies. Idempotent: a re-run
  // over an already-committed vault is a no-op.
  const commitResult = await withSpinner(
    'Committing initial vault template and pushing to origin/main...',
    () => commitInitialVaultTemplate(vaultDir, preset),
  );
  if (commitResult === 'pushed') {
    console.log(chalk.green('  ✓ Initial vault template committed and pushed'));
  } else {
    console.log(chalk.green('  ✓ Vault already in sync with origin/main'));
  }

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
