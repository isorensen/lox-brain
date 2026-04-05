import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';
import { ensureVmIdentity } from './step-deploy.js';

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
 * Build the VM-side launcher script that Claude Code invokes over SSH to
 * start the MCP server. Keeping all the shell metacharacters (`&&`, `source`,
 * `set -a`) inside this script means the argument Claude Code passes to the
 * local `ssh` binary is just a single path — no tokens for `cmd.exe` to
 * reinterpret on Windows (see #61 for the same class of bug).
 *
 * The script is idempotent: it `cd`s into the install dir, loads the env
 * file, and `exec`s node so the MCP server replaces the shell and responds
 * to signals directly.
 */
export function buildMcpLauncherScript(installDir: string): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    `cd ${installDir}`,
    'set -a',
    'source /etc/lox/secrets.env',
    'set +a',
    'exec node packages/core/dist/mcp/index.js',
    '',
  ].join('\n');
}

/**
 * Back-compat re-export: earlier versions exported `fixWindowsSshAcl`
 * from step-mcp.ts. The implementation moved to `utils/windows-acl.ts`
 * so step-deploy can reuse it for the OpenAI secret tmp file (#84).
 */
export { fixWindowsAcl as fixWindowsSshAcl } from '../utils/windows-acl.js';
import { fixWindowsAcl as fixWindowsSshAcl } from '../utils/windows-acl.js';

/**
 * Ensure ~/.ssh/config exists and append the lox-vm entry if not present.
 */
async function configureSshConfig(vpnServerIp: string, sshUser: string): Promise<void> {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const sshDir = join(home, '.ssh');
  const configPath = join(sshDir, 'config');

  const sshDirCreated = !existsSync(sshDir);
  if (sshDirCreated) {
    mkdirSync(sshDir, { mode: 0o700, recursive: true });
    // Only tighten ACLs if WE just created the dir. If it already existed,
    // the user may have configured it themselves and we should not clobber.
    await fixWindowsSshAcl(sshDir);
  }

  let existing = '';
  if (existsSync(configPath)) {
    existing = readFileSync(configPath, 'utf-8');
  }

  if (existing.includes('Host lox-vm')) {
    // Already configured — skip body write, but still ensure ACLs are
    // correct on both the file AND the dir. On a re-run after a previous
    // failed install, the config entry may be present but the ACLs may
    // never have been fixed, and OpenSSH validates the parent dir too.
    await fixWindowsSshAcl(sshDir);
    await fixWindowsSshAcl(configPath);
    return;
  }

  const entry = buildSshConfigEntry(vpnServerIp, sshUser);
  writeFileSync(configPath, existing + entry);
  // Ensure correct permissions on SSH config
  const { chmodSync } = await import('node:fs');
  chmodSync(configPath, 0o600);
  await fixWindowsSshAcl(configPath);
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
 * Upload the MCP launcher script to the VM at an absolute path and make it
 * executable. Uses plain `scp`/`ssh` via the SSH config entry written earlier
 * in this step (no gcloud, no IAP tunnel — the VPN is already up by now).
 */
async function uploadMcpLauncher(vmHome: string, installDir: string): Promise<string> {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const remotePath = `${vmHome}/lox-mcp.sh`;
  const script = buildMcpLauncherScript(installDir);
  const localScriptPath = join(tmpdir(), `lox-mcp-${Date.now()}.sh`);
  writeFileSync(localScriptPath, script, { mode: 0o755 });

  try {
    // Absolute remote paths only — pscp.exe (Windows Cloud SDK) does not
    // expand `~` (see #64). `/home/<user>/...` works on every platform.
    await shell('scp', [localScriptPath, `lox-vm:${remotePath}`], { timeout: 60_000 });
    await shell('ssh', ['lox-vm', 'chmod', '+x', remotePath], { timeout: 30_000 });
  } finally {
    try { rmSync(localScriptPath, { force: true }); } catch { /* best-effort */ }
  }

  return remotePath;
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
  // Reuse the identity resolved in step-deploy (#79). If this step runs
  // standalone (e.g. re-run after a failed step 12), probe the VM directly —
  // the email-prefix derivation would reintroduce the original bug.
  const projectId = ctx.gcpProjectId ?? 'lox-project';
  const vmName = ctx.config.gcp?.vm_name ?? 'lox-vm';
  const zone = ctx.config.gcp?.zone ?? 'us-east1-b';
  const { user: sshUser, home: vmHome } = await withSpinner(
    'Resolving VM user identity...',
    () => ensureVmIdentity(ctx, projectId, zone, vmName),
  );

  // 1. Generate SSH config entry
  await withSpinner(
    `${strings.configuring} SSH config for lox-vm...`,
    () => configureSshConfig(vpnServerIp, sshUser),
  );
  console.log(chalk.green('  ✓ SSH config entry for lox-vm added'));

  // 2. Upload the VM-side MCP launcher script.
  //    Claude Code will invoke it over SSH with no shell metacharacters in
  //    the argument, so cmd.exe on Windows can't reinterpret `&&`/`source`
  //    when spawning the MCP server.
  const installDir = ctx.config.install_dir ?? `${vmHome}/lox-brain`;
  const remoteLauncher = await withSpinner(
    'Uploading MCP launcher to VM...',
    () => uploadMcpLauncher(vmHome, installDir),
  );
  console.log(chalk.green(`  ✓ MCP launcher uploaded to ${remoteLauncher}`));

  // 3. Register MCP server with Claude Code.
  //    Idempotency: `claude mcp add` fails when a server with the same name
  //    is already registered. Detect that and remove the prior entry so
  //    re-runs re-register cleanly (picks up changed installDir / lox-vm
  //    config).
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
        'ssh', 'lox-vm', remoteLauncher,
      ]);
    },
  );

  // 4. Verify registration
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
