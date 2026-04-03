import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/**
 * Extract the active GCP account from `gcloud auth list`.
 * Returns the email or undefined if not authenticated.
 */
async function getActiveAccount(): Promise<string | undefined> {
  try {
    const { stdout } = await shell('gcloud', [
      'auth',
      'list',
      '--filter=status:ACTIVE',
      '--format=value(account)',
    ]);
    const account = stdout.trim();
    return account.length > 0 ? account : undefined;
  } catch {
    return undefined;
  }
}

export async function stepGcpAuth(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(2, TOTAL_STEPS, 'GCP Authentication'));

  // Check if already authenticated
  let account = await getActiveAccount();

  if (account) {
    console.log(chalk.green(`  ✓ Already authenticated as ${account}`));
  } else {
    console.log(chalk.yellow('  → Opening browser for GCP authentication...\n'));

    try {
      // SECURITY NOTE: We use execSync with stdio: 'inherit' here because
      // `gcloud auth login` is an interactive command that opens a browser
      // and waits for the user to complete OAuth. The safe shell() wrapper
      // (execFile-based) cannot handle interactive stdio inheritance.
      execSync('gcloud auth login --brief', { stdio: 'inherit' });
    } catch {
      return {
        success: false,
        message: 'GCP authentication failed. Run "gcloud auth login" manually and re-run lox.',
      };
    }

    // Verify authentication succeeded
    account = await getActiveAccount();
    if (!account) {
      return {
        success: false,
        message: 'GCP authentication could not be verified. Run "gcloud auth login" manually.',
      };
    }

    console.log(chalk.green(`\n  ✓ Authenticated as ${account}`));
  }

  // Extract username from email (part before @)
  ctx.gcpUsername = account.split('@')[0]?.replace(/[^a-z0-9-]/gi, '-') ?? 'user';
  return { success: true };
}
