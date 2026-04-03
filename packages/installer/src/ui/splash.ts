import chalk from 'chalk';
import { LOX_ASCII_LOGO, LOX_TAGLINE, LOX_VERSION } from '@lox-brain/shared';
import { t } from '../i18n/index.js';

/**
 * Render the ASCII splash screen with logo, tagline, and description.
 */
export function renderSplash(): string {
  const logo = chalk.cyan.bold(LOX_ASCII_LOGO);
  const tagline = chalk.white.bold(`  ${LOX_TAGLINE}`);
  const version = chalk.dim(`  v${LOX_VERSION}`);
  const description = chalk.gray(`  ${t().splash_description}`);
  const features = chalk.dim(`  ${t().splash_features}`);

  return [
    '',
    logo,
    '',
    tagline,
    version,
    '',
    description,
    features,
    '',
  ].join('\n');
}
