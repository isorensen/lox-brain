import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/**
 * Build the SSH config entry for the lox-vm host.
 * Extracted to avoid hardcoding personal values.
 */
export function buildSshConfigEntry(vpnServerIp: string, sshUser: string): string {
  return `
# Lox Brain VM — managed by lox installer
Host lox-vm
  HostName ${vpnServerIp}
  User ${sshUser}
  IdentityFile ~/.ssh/google_compute_engine
  StrictHostKeyChecking accept-new
  ServerAliveInterval 30
  ServerAliveCountMax 3
`;
}

/**
 * Ensure ~/.ssh/config exists and append the lox-vm entry if not present.
 */
async function configureSshConfig(vpnServerIp: string, sshUser: string): Promise<void> {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const sshDir = join(home, '.ssh');
  const configPath = join(sshDir, 'config');

  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { mode: 0o700, recursive: true });
  }

  let existing = '';
  if (existsSync(configPath)) {
    existing = readFileSync(configPath, 'utf-8');
  }

  if (existing.includes('Host lox-vm')) {
    // Already configured — skip
    return;
  }

  const entry = buildSshConfigEntry(vpnServerIp, sshUser);
  writeFileSync(configPath, existing + entry);
  // Ensure correct permissions on SSH config
  const { chmodSync } = await import('node:fs');
  chmodSync(configPath, 0o600);
}

/**
 * Check whether an MCP server is already registered with Claude Code at the
 * user scope. `claude mcp list` returns non-zero in some environments, so we
 * treat any failure as "not registered" and let the downstream add call run.
 */
export async function isMcpServerRegistered(name: string): Promise<boolean> {
  try {
    const { stdout } = await shell('claude', ['mcp', 'list']);
    // `claude mcp list` prints one server per line. Match on a word boundary
    // so we don't false-positive on `lox-brain-foo` when looking for `lox-brain`.
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escapedName}(\\s|:|$)`, 'm');
    return pattern.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Step 12: Configure Claude Code MCP
 *
 * Generates SSH config entry, registers the MCP server with Claude Code,
 * and verifies the registration.
 */
export async function stepMcp(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(12, TOTAL_STEPS, strings.step_mcp));

  const vpnServerIp = ctx.config.vpn?.server_ip ?? '10.10.0.1';
  const sshUser = ctx.gcpUsername ?? 'lox';

  // 1. Generate SSH config entry
  await withSpinner(
    `${strings.configuring} SSH config for lox-vm...`,
    () => configureSshConfig(vpnServerIp, sshUser),
  );
  console.log(chalk.green('  ✓ SSH config entry for lox-vm added'));

  // 2. Register MCP server with Claude Code
  const installDir = ctx.config.install_dir ?? '/home/' + sshUser + '/lox-brain';
  const mcpCommand = `cd ${installDir} && set -a && source /etc/lox/secrets.env && set +a && node packages/core/dist/mcp/index.js`;

  // Idempotency: `claude mcp add` fails when a server with the same name is
  // already registered. Detect that and remove the prior entry so re-runs
  // re-register cleanly (picks up changed installDir / lox-vm config).
  const alreadyRegistered = await isMcpServerRegistered('lox-brain');
  if (alreadyRegistered) {
    try {
      await shell('claude', ['mcp', 'remove', '--scope', 'user', 'lox-brain']);
    } catch {
      // Fall through: if remove fails we still try add; add's own error will surface.
    }
  }

  await withSpinner(
    'Registering lox-brain MCP server with Claude Code...',
    async () => {
      await shell('claude', [
        'mcp', 'add',
        '--scope', 'user',
        'lox-brain',
        '--',
        'ssh', 'lox-vm', mcpCommand,
      ]);
    },
  );

  // 3. Verify registration
  const verified = await withSpinner(
    'Verifying MCP registration...',
    async () => {
      try {
        const { stdout } = await shell('claude', ['mcp', 'list']);
        return stdout.includes('lox-brain');
      } catch {
        return false;
      }
    },
  );

  if (verified) {
    console.log(chalk.green('  ✓ lox-brain MCP server registered in Claude Code'));
  } else {
    console.log(chalk.yellow('  ⚠ Could not verify MCP registration. Run "claude mcp list" to check.'));
  }

  return { success: true };
}
