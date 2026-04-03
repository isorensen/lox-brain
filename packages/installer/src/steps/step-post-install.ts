import { runSecurityAudit, renderAuditResults, renderSecurityHygiene } from '../security/audit.js';
import { renderBox } from '../ui/box.js';
import { t } from '../i18n/index.js';
import { getConfigPath } from '@lox-brain/shared';
import type { InstallerContext } from './types.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Post-install sequence: security audit, hygiene reminders,
 * config persistence, and success screen.
 *
 * Runs after step 12 completes. Not a numbered step — it is the
 * final wrap-up sequence.
 */
export async function runPostInstall(ctx: InstallerContext): Promise<void> {
  const config = ctx.config as any; // Will be complete by this point

  // Security audit
  console.log('\n');
  const auditResults = await runSecurityAudit(config);
  console.log(renderAuditResults(auditResults));

  // Security hygiene
  console.log('\n');
  console.log(renderSecurityHygiene());

  // Save config
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Success screen
  const strings = t();
  const vaultPath = ctx.config.vault?.local_path ?? '~/Obsidian/Lox';
  console.log('\n');
  console.log(renderBox([
    '',
    `  ${strings.success_title}`,
    '',
    `  ${strings.success_subtitle}`,
    '',
    `  * ${strings.success_vault}: ${vaultPath}`,
    `  * ${strings.success_mcp}`,
    `  * ${strings.success_claude}`,
    '',
    `  ${strings.success_next_steps}`,
    `    1. ${strings.success_step_1}`,
    `    2. ${strings.success_step_2}`,
    `    3. ${strings.success_step_3}`,
    '',
    `  ${strings.success_status_hint}`,
    '',
  ]));
}
