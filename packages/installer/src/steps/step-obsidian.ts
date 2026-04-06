import chalk from 'chalk';
import { shell, getPlatform } from '../utils/shell.js';
import { withExtendableTimeout } from '../utils/extendable-timeout.js';
import { t } from '../i18n/index.js';
import { renderStepHeader, renderBox } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/** Initial timeout for package-manager installs (5 min). */
const INSTALL_TIMEOUT_MS = 300_000;
/** Upper-bound timeout when the user chooses to keep waiting (10 min). */
const INSTALL_MAX_TIMEOUT_MS = 600_000;

type Platform = 'windows' | 'macos' | 'linux';

/**
 * Detect whether Obsidian is already installed via the platform's package
 * manager. Returns false when the check itself fails (command missing,
 * unknown platform) so the installer falls through to the install path.
 */
export async function isObsidianInstalled(platform: Platform): Promise<boolean> {
  try {
    switch (platform) {
      case 'macos': {
        const { stdout } = await shell('brew', ['list', '--cask', 'obsidian']);
        return stdout.length > 0;
      }
      case 'windows': {
        const { stdout } = await shell('winget', ['list', '--id', 'Obsidian.Obsidian', '-e']);
        return stdout.includes('Obsidian.Obsidian');
      }
      case 'linux': {
        const { stdout } = await shell('snap', ['list', 'obsidian']);
        return stdout.includes('obsidian');
      }
    }
  } catch {
    return false;
  }
}

/**
 * Install Obsidian using the platform-appropriate package manager.
 * Idempotent: skips install when Obsidian is already present. The package
 * manager call runs with a 5-minute timeout; if it still times out, the user
 * is prompted (default=yes) to extend to 10 minutes.
 */
async function installObsidian(): Promise<boolean> {
  const strings = t();
  const platform = getPlatform();

  if (await isObsidianInstalled(platform)) {
    return false; // already installed — nothing to do
  }

  await withExtendableTimeout(
    async (timeout) => {
      switch (platform) {
        case 'macos':
          await shell('brew', ['install', '--cask', 'obsidian'], { timeout });
          break;
        case 'windows':
          await shell(
            'winget',
            ['install', 'Obsidian.Obsidian', '--accept-source-agreements', '--accept-package-agreements'],
            { timeout },
          );
          break;
        case 'linux':
          try {
            await shell('snap', ['install', 'obsidian', '--classic'], { timeout });
          } catch {
            throw new Error(
              'Could not install Obsidian via snap. ' +
              'Please install manually: https://obsidian.md/download',
            );
          }
          break;
      }
    },
    {
      label: 'Obsidian install',
      initialTimeout: INSTALL_TIMEOUT_MS,
      maxTimeout: INSTALL_MAX_TIMEOUT_MS,
      promptMessage: strings.install_timeout_extend,
    },
  );
  return true;
}

/**
 * Step 10: Obsidian Setup
 *
 * Installs Obsidian, clones the vault repo locally, copies plugin
 * configurations, and guides manual plugin activation.
 */
export async function stepObsidian(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(10, TOTAL_STEPS, 'Obsidian'));

  // 1. Install Obsidian (skips when already present)
  const installed = await withSpinner(
    `${strings.installing} Obsidian...`,
    () => installObsidian(),
  );
  console.log(chalk.green(installed ? '  ✓ Obsidian installed' : '  ✓ Obsidian already installed'));

  // 2. Clone vault repo locally to ~/Obsidian/Lox
  const vaultRepo = ctx.config.vault?.repo;
  if (!vaultRepo) {
    return {
      success: false,
      message: 'Vault repo not configured. Run vault setup (step 9) first.',
    };
  }

  const localPath = ctx.config.vault?.local_path ?? '~/Obsidian/Lox';
  const expandedPath = localPath.replace('~', process.env.HOME ?? process.env.USERPROFILE ?? '~');

  await withSpinner(
    `Cloning vault to ${localPath}...`,
    async () => {
      const { mkdirSync, existsSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const parentDir = dirname(expandedPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      // Idempotency: if the target path already contains a clone from a
      // prior run, skip clone. `gh repo clone` fails on an existing dir,
      // which would break re-runs of the installer.
      if (existsSync(expandedPath)) {
        return;
      }
      await shell('gh', ['repo', 'clone', vaultRepo, expandedPath]);
    },
  );

  // 3. Copy .obsidian/ config with plugins (use Node fs so Windows works too —
  //    `cp -r` does not exist on Windows).
  await withSpinner(
    'Copying Obsidian plugin configuration...',
    async () => {
      const { cpSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const src = join('templates', 'obsidian-plugins');
      if (!existsSync(src)) {
        console.log(chalk.yellow('  → Plugin templates not found, skipping plugin copy.'));
        return;
      }
      const dest = join(expandedPath, '.obsidian');
      cpSync(src, dest, { recursive: true });
    },
  );

  // 4. Pause with instructions for plugin install + obsidian-git configuration
  const pluginInstructions = renderBox([
    'Obsidian Plugin Setup',
    '',
    `1. Open Obsidian and open vault: ${localPath}`,
    '2. Settings → Community Plugins → Turn on community plugins',
    '3. Click Browse and install each of these plugins:',
    '     • obsidian-git       (local vault ↔ git sync)',
    '     • dataview           (query notes as a database)',
    '     • omnisearch         (full-text search)',
    '     • emoji-shortcodes   (inline emoji)',
    '     • recent-files-obsidian',
    '4. Settings → Community Plugins → enable each after install',
    '',
    'obsidian-git — required for vault sync:',
    '  Settings → Obsidian Git →',
    '    • Vault backup interval: 2 min',
    '    • Auto pull on startup: on',
    '    • Auto pull interval: 2 min',
    '    • Auto push after commit: on',
    '',
    'The plugin list (community-plugins.json) is already seeded,',
    'so Obsidian will remember your selections after this step.',
  ]);
  console.log(`\n${pluginInstructions}\n`);

  const { input } = await import('@inquirer/prompts');
  await input({
    message: strings.press_enter,
    default: '',
  });

  console.log(chalk.green('  ✓ Obsidian configured'));
  return { success: true };
}
