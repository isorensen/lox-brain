import chalk from 'chalk';
import { checkAllPrerequisites } from '../checks/prerequisites.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

export async function stepPrerequisites(_ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(1, TOTAL_STEPS, strings.step_prerequisites));

  const results = await withSpinner(
    `${strings.checking} ${strings.step_prerequisites.toLowerCase()}...`,
    () => checkAllPrerequisites(),
  );

  const allInstalled = results.every((r) => r.installed);

  for (const r of results) {
    const icon = r.installed ? chalk.green('✓') : chalk.red('✗');
    const version = r.version ? chalk.dim(` (${r.version})`) : '';
    console.log(`  ${icon} ${r.name}${version}`);

    if (!r.installed && r.installCommand) {
      console.log(chalk.yellow(`    → ${r.installCommand}`));
    }
  }

  if (!allInstalled) {
    const missing = results.filter((r) => !r.installed).map((r) => r.name);
    return {
      success: false,
      message: `Missing prerequisites: ${missing.join(', ')}. Install them and re-run lox.`,
    };
  }

  return { success: true };
}
