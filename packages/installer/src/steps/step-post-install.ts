import { runSecurityAudit, renderAuditResults, renderSecurityHygiene } from '../security/audit.js';
import { renderBox } from '../ui/box.js';
import { t } from '../i18n/index.js';
import { getConfigPath } from '@lox-brain/shared';
import type { InstallerContext } from './types.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

async function installSkills(): Promise<void> {
  const { cpSync, existsSync: fsExistsSync, mkdirSync: fsMkdirSync } = await import('node:fs');
  const { resolve: pathResolve, join } = await import('node:path');
  const { homedir } = await import('node:os');

  // Skills source: skills/ at repo root, relative to this compiled file.
  // Compiled layout: packages/installer/dist/steps/step-post-install.js
  // → go up 4 dirs to repo root, then into skills/
  const skillsSrc = pathResolve(__dirname, '..', '..', '..', '..', 'skills');
  if (!fsExistsSync(skillsSrc)) return; // No skills directory — skip silently

  const targetDir = join(homedir(), '.claude', 'skills');
  fsMkdirSync(targetDir, { recursive: true });

  cpSync(skillsSrc, targetDir, { recursive: true, force: true });
}

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

  // Install shipped Claude Skills
  try {
    await installSkills();
    console.log(chalk.green('  ✓ Claude Skills installed to ~/.claude/skills/'));
  } catch {
    console.log(chalk.yellow('  ⚠ Could not install Claude Skills — copy them manually from skills/'));
  }

  // Success screen
  const strings = t();
  const vaultPath = ctx.config.vault?.local_path ?? '~/Obsidian/Lox';
  const vpnServerIp = ctx.config.vpn?.server_ip ?? '10.10.0.1';
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
    `    2. Verify the VPN tunnel: ping ${vpnServerIp}`,
    `    3. ${strings.success_step_3}`,
    '',
    `  ${strings.success_status_hint}`,
    '',
  ]));
}
