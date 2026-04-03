import chalk from 'chalk';
import { shell, getPlatform } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader, renderBox } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

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
 * Step 9: Vault Setup
 *
 * Creates a private GitHub repo for the vault, sets up templates,
 * security patterns, branch protection, git sync cron, and gitleaks hook.
 */
export async function stepVault(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(9, TOTAL_STEPS, strings.step_git_sync));

  // 1. Ask vault preset
  const { select } = await import('@inquirer/prompts');
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

  const repoName = 'lox-vault';
  const fullRepo = `${ghUser}/${repoName}`;

  await withSpinner(
    `${strings.creating} private repo ${fullRepo}...`,
    async () => {
      await shell('gh', ['repo', 'create', fullRepo, '--private', '--clone']);
    },
  );

  const vaultDir = `${repoName}`;

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
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(join(vaultDir, '.gitignore'), GITIGNORE_CONTENT);
  console.log(chalk.green('  ✓ .gitignore created with security patterns'));

  // 5. Guide fine-grained PAT creation
  const patInstructions = renderBox([
    'GitHub Fine-Grained PAT Setup',
    '',
    '1. Go to: https://github.com/settings/tokens?type=beta',
    '2. Click "Generate new token"',
    `3. Repository access: Only select repositories → ${fullRepo}`,
    '4. Permissions: Contents (Read and write), Metadata (Read)',
    '5. Generate and copy the token',
    '',
    'This PAT will be used for git sync on the VM.',
    'Store it in GCP Secret Manager after this step.',
  ]);
  console.log(`\n${patInstructions}\n`);

  const { input } = await import('@inquirer/prompts');
  await input({
    message: strings.press_enter,
    default: '',
  });

  // 6. Set up branch protection
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

  // 7. Configure git sync cron on VM (via SSH IAP)
  const projectId = ctx.gcpProjectId ?? 'lox-project';
  const vmName = ctx.config.gcp?.vm_name ?? 'lox-vm';
  const zone = ctx.config.gcp?.zone ?? 'us-east1-b';

  await withSpinner(
    'Configuring git sync cron on VM...',
    async () => {
      const syncScript = [
        '#!/bin/bash',
        'set -euo pipefail',
        'cd ~/lox-vault',
        'git fetch origin main',
        'git merge --ff-only origin/main || true',
        'git add -A',
        'git diff --cached --quiet || git commit -m "auto-sync $(date -u +%Y-%m-%dT%H:%M:%SZ)"',
        'git push origin main',
      ].join('\n');

      // Create sync script on VM
      await shell('gcloud', [
        'compute', 'ssh', vmName,
        '--project', projectId,
        '--zone', zone,
        '--tunnel-through-iap',
        '--command', `echo '${syncScript}' > ~/sync-vault.sh && chmod +x ~/sync-vault.sh`,
      ]);

      // Add crontab entry (every 2 minutes)
      await shell('gcloud', [
        'compute', 'ssh', vmName,
        '--project', projectId,
        '--zone', zone,
        '--tunnel-through-iap',
        '--command', '(crontab -l 2>/dev/null; echo "*/2 * * * * ~/sync-vault.sh >> ~/sync-vault.log 2>&1") | sort -u | crontab -',
      ]);
    },
  );

  // 8. Install gitleaks pre-commit hook
  const { existsSync, mkdirSync } = await import('node:fs');
  const hooksDir = join(vaultDir, '.git', 'hooks');
  if (!existsSync(hooksDir)) {
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
