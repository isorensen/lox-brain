import chalk from 'chalk';
import { shell, getPlatform } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader, renderBox } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/**
 * Install Obsidian using the platform-appropriate package manager.
 */
async function installObsidian(): Promise<void> {
  const platform = getPlatform();
  switch (platform) {
    case 'macos':
      await shell('brew', ['install', '--cask', 'obsidian']);
      break;
    case 'windows':
      await shell('winget', ['install', 'Obsidian.Obsidian', '--accept-source-agreements', '--accept-package-agreements']);
      break;
    case 'linux':
      try {
        await shell('snap', ['install', 'obsidian', '--classic']);
      } catch {
        throw new Error(
          'Could not install Obsidian via snap. ' +
          'Please install manually: https://obsidian.md/download',
        );
      }
      break;
  }
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

  // 1. Install Obsidian
  await withSpinner(
    `${strings.installing} Obsidian...`,
    () => installObsidian(),
  );
  console.log(chalk.green('  ✓ Obsidian installed'));

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
      await shell('gh', ['repo', 'clone', vaultRepo, expandedPath]);
    },
  );

  // 3. Copy .obsidian/ config with plugins
  await withSpinner(
    'Copying Obsidian plugin configuration...',
    async () => {
      try {
        await shell('cp', ['-r', 'templates/obsidian-plugins/.', `${expandedPath}/.obsidian`]);
      } catch {
        console.log(chalk.yellow('  → Plugin templates not found, skipping plugin copy.'));
      }
    },
  );

  // 4. Pause with instructions for manual plugin activation
  const pluginInstructions = renderBox([
    'Obsidian Plugin Activation',
    '',
    '1. Open Obsidian',
    `2. Open vault: ${localPath}`,
    '3. Go to Settings → Community Plugins',
    '4. Enable "Safe Mode" off if prompted',
    '5. Enable the pre-configured plugins',
    '',
    'Recommended plugins have been pre-copied to .obsidian/plugins/',
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
