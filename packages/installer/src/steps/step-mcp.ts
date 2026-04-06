import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { probeTcp } from '../utils/net-probe.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';
import { ensureVmIdentity } from './step-deploy.js';
import { getVpnConfig } from './step-vpn.js';

const TOTAL_STEPS = 12;

/**
 * Build a platform-aware guidance message shown when the VPN preflight
 * fails. Exported for tests. Kept in English to match other step failure
 * messages in the installer (`'GCP project... Run step 3 first.'` etc.).
 */
export function buildVpnUnreachableMessage(vpnServerIp: string, platform: NodeJS.Platform, iface: string = 'wg0'): string {
  const confFile = `${iface}.conf`;
  const activation =
    platform === 'win32'
      ? `  • Open the WireGuard app, import your client config from\n`
        + `    %USERPROFILE%\\.config\\lox\\wireguard\\${confFile}, then click Activate.`
      : platform === 'darwin'
        ? `  • Open the WireGuard app (or run \`sudo wg-quick up ~/.config/lox/wireguard/${confFile}\`).`
        // Unix fallback: Linux, FreeBSD, OpenBSD, etc. all share wg-quick.
        : `  • Run: sudo wg-quick up ~/.config/lox/wireguard/${confFile}`;
  return [
    `Cannot reach the VM over the WireGuard VPN (${vpnServerIp}:22).`,
    '',
    'The VPN tunnel is not active. To fix:',
    activation,
    '  • Verify the WireGuard client is connected, then re-run the installer.',
    '    The resume prompt will offer to continue from step 12.',
  ].join('\n');
}

/**
 * Check that the VPN server is reachable on port 22. Kept as a thin
 * wrapper so callers/tests don't need to hardcode the timeout or port.
 * Returns true if a TCP handshake completes within 5s.
 */
export async function isVpnReachable(vpnServerIp: string): Promise<boolean> {
  return probeTcp(vpnServerIp, 22, 5000);
}

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
 * Exported for tests — the #109 regression requires verifying that
 * `tightenGcloudSshKey` runs on BOTH the new-entry AND already-configured
 * paths (previously a bug skipped it on re-runs).
 */
export async function configureSshConfig(vpnServerIp: string, sshUser: string): Promise<void> {
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
  } else {
    const entry = buildSshConfigEntry(vpnServerIp, sshUser);
    writeFileSync(configPath, existing + entry);
    // Ensure correct permissions on SSH config
    const { chmodSync } = await import('node:fs');
    chmodSync(configPath, 0o600);
    await fixWindowsSshAcl(configPath);
  }

  // ALWAYS tighten the gcloud private key (#109). `gcloud compute ssh` in
  // earlier steps — and inside step 12's own `ensureVmIdentity` call —
  // regenerates ~/.ssh/google_compute_engine with fresh inherited loose
  // Windows ACLs EVERY TIME it runs. So even if a previous step 12 run
  // tightened the key, a subsequent re-run would re-loosen it via
  // ensureVmIdentity, then skip the tightening via the early-return
  // above. Must run unconditionally AFTER the config-entry branch.
  await tightenGcloudSshKey(sshDir);
}

/**
 * Apply `fixWindowsAcl` to the gcloud-created `~/.ssh/google_compute_engine`
 * private key if present (#101). Earlier steps (VM setup, deploy) invoke
 * `gcloud compute ssh`, which creates the key with inherited loose Windows
 * ACLs (`CREATOR OWNER` / `BUILTIN\Users`). OpenSSH validates identity-file
 * permissions before use and rejects the scp in step 12 with "UNPROTECTED
 * PRIVATE KEY FILE". `fixWindowsAcl` is a no-op on non-Windows; on Windows
 * it restricts access to the current user only. Gated on `existsSync`
 * because the key may not yet exist when step 12 runs standalone.
 *
 * Exported for tests; the only production caller is `configureSshConfig`.
 */
export async function tightenGcloudSshKey(sshDir: string): Promise<void> {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const keyPath = join(sshDir, 'google_compute_engine');
  if (existsSync(keyPath)) {
    await fixWindowsSshAcl(keyPath);
  }
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
 * Derive the MCP server name for Claude Code registration.
 * Team installs use `lox-brain-<org>` so they coexist with personal installs.
 */
export function getMcpServerName(mode: string, org?: string): string {
  if (mode === 'team' && org) {
    return `lox-brain-${org}`;
  }
  return 'lox-brain';
}

/**
 * Install the MCP HTTP systemd service on the VM. Reads the service template
 * from `infra/systemd/lox-mcp.service`, substitutes placeholders, uploads to
 * the VM, and enables the service. Team mode only — the personal mode uses
 * SSH stdio via the launcher script.
 */
export async function installMcpService(installDir: string, vmUser: string): Promise<void> {
  const { readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');

  // Resolve the template path relative to this file's location in the built output
  // packages/installer/dist/steps/step-mcp.js -> ../../../../infra/systemd/lox-mcp.service
  const templatePath = resolve(__dirname, '..', '..', '..', '..', 'infra', 'systemd', 'lox-mcp.service');
  const template = readFileSync(templatePath, 'utf-8');
  const serviceContent = template
    .replace(/__LOX_VM_USER__/g, vmUser)
    .replace(/__LOX_INSTALL_DIR__/g, installDir);

  const tmpFile = join(tmpdir(), `lox-mcp-${Date.now()}.service`);
  writeFileSync(tmpFile, serviceContent);

  try {
    await shell('scp', [tmpFile, 'lox-vm:/tmp/lox-mcp.service'], { timeout: 60_000 });
    await shell('ssh', ['lox-vm', 'sudo', 'mv', '/tmp/lox-mcp.service', '/etc/systemd/system/lox-mcp.service'], { timeout: 30_000 });
    await shell('ssh', ['lox-vm', 'sudo', 'systemctl', 'daemon-reload'], { timeout: 30_000 });
    await shell('ssh', ['lox-vm', 'sudo', 'systemctl', 'enable', '--now', 'lox-mcp'], { timeout: 30_000 });
  } finally {
    try { rmSync(tmpFile, { force: true }); } catch { /* best-effort */ }
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

  // VPN preflight FIRST (#93). Everything downstream in this step — the
  // scp upload and the `ssh lox-vm chmod` call — rides the WireGuard
  // tunnel to `vpnServerIp`. If the client tunnel isn't active, scp
  // hangs until its 60s timeout and surfaces as an unhandled exception.
  // A fast TCP probe converts that into a clean, recoverable
  // {success: false} — the resume feature then lets the user activate
  // WireGuard and continue from step 12. Runs before any VM identity
  // work so the user hits the failure (and VPN guidance) in <5s.
  // Fallback IP matches VPN_SERVER_IP in step-vpn.ts — used only when
  // step 12 runs standalone and ctx.config.vpn wasn't populated.
  const vpnCfg = getVpnConfig(ctx.config.mode);
  const vpnServerIp = ctx.config.vpn?.server_ip ?? vpnCfg.serverIp;
  const vpnUp = await withSpinner(
    `Verifying VPN connectivity to ${vpnServerIp}...`,
    () => isVpnReachable(vpnServerIp),
  );
  if (!vpnUp) {
    // actionable=true so the installer doesn't ask the user to file a
    // GitHub bug report for a user-fixable condition (#96).
    return {
      success: false,
      message: buildVpnUnreachableMessage(vpnServerIp, process.platform, vpnCfg.iface),
      actionable: true,
    };
  }
  console.log(chalk.green(`  ✓ VPN reachable (${vpnServerIp}:22)`));

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

  // 2b. Team mode: install the MCP HTTP systemd service on the VM.
  //     The launcher script is still uploaded (used for admin tasks), but team
  //     clients connect via HTTP over VPN instead of SSH stdio.
  const isTeamMode = ctx.config.mode === 'team';

  if (isTeamMode) {
    await withSpinner(
      'Installing MCP HTTP service on VM...',
      () => installMcpService(installDir, sshUser),
    );
    console.log(chalk.green('  ✓ MCP HTTP service installed and started'));
  }

  // 3. Register MCP server with Claude Code.
  //    Idempotency: `claude mcp add` fails when a server with the same name
  //    is already registered. Detect that and remove the prior entry so
  //    re-runs re-register cleanly (picks up changed installDir / lox-vm
  //    config).
  const mcpServerName = getMcpServerName(ctx.config.mode ?? 'personal', ctx.config.license_org);

  const alreadyRegistered = await isMcpServerRegistered(mcpServerName);
  if (alreadyRegistered) {
    try {
      await shell('claude', ['mcp', 'remove', '--scope', 'user', mcpServerName]);
    } catch {
      // Fall through: if remove fails we still try add; add's own error will surface.
    }
  }

  if (isTeamMode) {
    // Team mode: HTTP via VPN — clients connect directly to the MCP service
    // bound to the VPN interface IP. No SSH tunnel needed.
    const mcpUrl = `http://${vpnServerIp}:3100/mcp`;
    await withSpinner(
      `Registering ${mcpServerName} MCP server (HTTP) with Claude Code...`,
      async () => {
        await shell('claude', [
          'mcp', 'add',
          '--scope', 'user',
          '--transport', 'sse',
          mcpServerName,
          mcpUrl,
        ]);
      },
    );
  } else {
    // Personal mode: SSH stdio
    await withSpinner(
      `Registering ${mcpServerName} MCP server with Claude Code...`,
      async () => {
        await shell('claude', [
          'mcp', 'add',
          '--scope', 'user',
          mcpServerName,
          '--',
          'ssh', 'lox-vm', remoteLauncher,
        ]);
      },
    );
  }

  // 4. Verify registration
  const verified = await withSpinner(
    'Verifying MCP registration...',
    async () => {
      try {
        const { stdout } = await shell('claude', ['mcp', 'list']);
        return stdout.includes(mcpServerName);
      } catch {
        return false;
      }
    },
  );

  if (verified) {
    console.log(chalk.green(`  ✓ ${mcpServerName} MCP server registered in Claude Code`));
  } else {
    console.log(chalk.yellow(`  ⚠ Could not verify MCP registration. Run "claude mcp list" to check.`));
  }

  return { success: true };
}
