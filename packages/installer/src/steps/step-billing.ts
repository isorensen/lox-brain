import { execFile } from 'node:child_process';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { renderStepHeader, renderBox } from '../ui/box.js';
import { getPlatform } from '../utils/shell.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;
const BILLING_URL = 'https://console.cloud.google.com/billing';

/**
 * Open a URL in the default browser using platform-specific commands.
 * Uses execFile (not exec) to avoid shell injection — the URL is internal/controlled.
 */
function openBrowser(url: string): void {
  const platform = getPlatform();
  try {
    switch (platform) {
      case 'macos':
        execFile('open', [url], { stdio: 'ignore' } as never);
        break;
      case 'windows':
        execFile('cmd', ['/c', 'start', '', url], { stdio: 'ignore' } as never);
        break;
      default:
        execFile('xdg-open', [url], { stdio: 'ignore' } as never);
        break;
    }
  } catch {
    // Non-fatal: user can open the URL manually
    console.log(chalk.yellow(`  Could not open browser. Visit: ${url}`));
  }
}

export async function stepBilling(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(4, TOTAL_STEPS, 'Billing'));

  const projectId = ctx.gcpProjectId ?? 'your-project';

  const instructions = renderBox([
    strings.estimated_cost,
    '',
    `1. ${strings.billing_instructions_3}`,
    `2. Link billing to project: ${projectId}`,
    '',
    `URL: ${BILLING_URL}`,
  ]);

  console.log(`\n${instructions}\n`);
  console.log(chalk.cyan('  Opening billing page in browser...\n'));

  openBrowser(`${BILLING_URL}?project=${projectId}`);

  // Wait for user to confirm they've set up billing
  const { input } = await import('@inquirer/prompts');
  await input({
    message: strings.press_enter,
    default: '',
  });

  console.log(chalk.green('  ✓ Billing setup acknowledged'));
  return { success: true };
}
