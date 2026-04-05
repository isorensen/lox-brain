import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/**
 * Build the systemd unit file for the vault watcher service.
 * Extracted to avoid hardcoding personal values.
 */
export function buildWatcherService(user: string, installDir: string): string {
  return `[Unit]
Description=Lox Vault Watcher
After=network.target postgresql.service

[Service]
Type=simple
User=${user}
WorkingDirectory=${installDir}
ExecStart=/usr/bin/node packages/core/dist/watcher/index.js
EnvironmentFile=/etc/lox/secrets.env
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Clone or update the lox-brain repo on the VM. Uses anonymous HTTPS against
 * the public upstream so `gh` isn't required (see #73).
 */
export function buildCloneScript(installDir: string): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    `if [ -d "${installDir}" ]; then`,
    `  cd "${installDir}"`,
    '  git pull',
    'else',
    `  git clone https://github.com/isorensen/lox-brain.git "${installDir}"`,
    'fi',
    '',
  ].join('\n');
}

/** Run npm ci + workspace build inside the install dir. */
export function buildBuildScript(installDir: string): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    `cd "${installDir}"`,
    'npm ci',
    'npm run build --workspaces',
    '',
  ].join('\n');
}

/**
 * Write /etc/lox/secrets.env with tight perms. The env content is embedded
 * verbatim via a quoted heredoc — the local temp script owns the whole
 * payload so we never pass multi-line content through `gcloud --command`.
 */
export function buildSecretsEnvScript(envContent: string, user: string): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    'sudo mkdir -p /etc/lox',
    "sudo tee /etc/lox/secrets.env > /dev/null <<'LOX_ENV_EOF'",
    envContent,
    'LOX_ENV_EOF',
    'sudo chmod 600 /etc/lox/secrets.env',
    `sudo chown ${user}:${user} /etc/lox/secrets.env`,
    '',
  ].join('\n');
}

/** Install the lox-watcher systemd unit. */
export function buildSystemdInstallScript(watcherService: string): string {
  // buildWatcherService() always ends with a newline; join('\n') adds another
  // between content and LOX_UNIT_EOF, which produces a safe blank line
  // before the delimiter. No trimming needed.
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    "sudo tee /etc/systemd/system/lox-watcher.service > /dev/null <<'LOX_UNIT_EOF'",
    watcherService,
    'LOX_UNIT_EOF',
    '',
  ].join('\n');
}

/** Reload systemd and enable+start the lox-watcher service. */
export function buildServiceStartScript(): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    'sudo systemctl daemon-reload',
    'sudo systemctl enable lox-watcher',
    'sudo systemctl start lox-watcher',
    '',
  ].join('\n');
}

/**
 * Smoke-test the MCP server by sending it a `tools/list` JSON-RPC request
 * and echoing the first response line. All pipes and redirects live inside
 * the script, not in `gcloud --command`.
 */
export function buildMcpHealthProbeScript(installDir: string): string {
  // Deliberately NO `set -euo pipefail` — a failing MCP server (pipefail)
  // would abort before `head -1` reads any output, hiding diagnostic info
  // from the caller which inspects stdout to decide health. The enclosing
  // TypeScript wraps this call in try/catch and treats any throw as unhealthy.
  return [
    '#!/bin/bash',
    `cd "${installDir}" || exit 1`,
    'echo \'{"jsonrpc":"2.0","method":"tools/list","id":1}\' | timeout 10 node packages/core/dist/mcp/index.js 2>/dev/null | head -1',
    '',
  ].join('\n');
}

/**
 * Write `script` to a local temp file, scp it to the VM via IAP, execute it
 * with `bash /tmp/lox-deploy-<phase>.sh`, and clean the local temp file.
 *
 * The remote `--command` value is always `bash <absolute-path>` — no shell
 * metacharacters leak through cmd.exe on Windows (#61). The local path lives
 * in os.tmpdir() and is always absolute (#64). Returns captured stdout so
 * callers can inspect script output (used by the MCP health probe).
 */
async function runRemoteScript(
  projectId: string,
  zone: string,
  vmName: string,
  phaseName: string,
  script: string,
  opts?: { timeout?: number },
): Promise<string> {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const timeout = opts?.timeout ?? 300_000;

  const localPath = join(tmpdir(), `lox-deploy-${phaseName}-${Date.now()}.sh`);
  const remotePath = `/tmp/lox-deploy-${phaseName}.sh`;
  // Append a self-delete line so the script removes itself from the VM
  // after running — important for the secrets phase whose body embeds
  // DATABASE_URL credentials. Doing it inside the script keeps the
  // --command argument metachar-free (a separate `; rm ...` would defeat
  // the whole point of this refactor on Windows cmd.exe).
  const scriptWithCleanup = script.endsWith('\n')
    ? `${script}rm -- "$0"\n`
    : `${script}\nrm -- "$0"\n`;
  // mode 0600 — the secrets phase embeds DATABASE_URL credentials into the
  // script body, so the local tmp file must not be world-readable.
  writeFileSync(localPath, scriptWithCleanup, { mode: 0o600 });

  try {
    await shell('gcloud', [
      'compute', 'scp',
      '--project', projectId,
      '--zone', zone,
      '--tunnel-through-iap',
      localPath, `${vmName}:${remotePath}`,
    ], { timeout });

    const { stdout } = await shell('gcloud', [
      'compute', 'ssh', vmName,
      '--project', projectId,
      '--zone', zone,
      '--tunnel-through-iap',
      '--command', `bash ${remotePath}`,
    ], { timeout });

    return stdout;
  } finally {
    try { rmSync(localPath, { force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Parse `$USER:$HOME` output from the VM identity probe. Returns null if the
 * output does not match the expected `user:/path` format.
 */
export function parseVmIdentity(output: string): { user: string; home: string } | null {
  // Match `username:/absolute/path` — gcloud SSH may prepend MOTD banners or
  // warnings, so we scan lines and pick the first one that matches the
  // strict `user:/home/...` shape.
  const re = /^([a-zA-Z0-9._-]+):(\/[^\s]*)$/;
  for (const raw of output.split('\n')) {
    const m = raw.trim().match(re);
    if (m) {
      return { user: m[1]!, home: m[2]! };
    }
  }
  return null;
}

/** Script that echoes the VM's POSIX user and $HOME in `user:/home/path` form. */
export function buildIdentityProbeScript(): string {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    'echo "${USER}:${HOME}"',
    '',
  ].join('\n');
}

/**
 * SSH to the VM and capture `$USER:$HOME` via the scp+bash pattern (same as
 * #70). Throws if the probe output cannot be parsed.
 *
 * Why: `ctx.gcpUsername` is derived from the email prefix, but GCP OS Login
 * creates POSIX users as `<email-prefix>_<domain>_<tld>` (dots → underscores).
 * Guessing the /home path from the email prefix makes `git clone` fail with
 * "could not create leading directories" (see #79). We cannot pass
 * `echo "$USER:$HOME"` via `--command` directly because on Windows cmd.exe
 * reinterprets `$` and `"`, producing literal `$USER:$HOME` back — the exact
 * class of bug the scp+bash refactor in #70 was introduced to prevent.
 */
async function resolveVmIdentity(
  projectId: string,
  zone: string,
  vmName: string,
): Promise<{ user: string; home: string }> {
  const stdout = await runRemoteScript(
    projectId, zone, vmName, 'identity', buildIdentityProbeScript(), { timeout: 60_000 },
  );
  const parsed = parseVmIdentity(stdout);
  if (!parsed) {
    throw new Error(`Could not parse VM identity from SSH probe output: ${JSON.stringify(stdout)}`);
  }
  return parsed;
}

/**
 * Ensure `ctx.vmUser` and `ctx.vmHome` are set, resolving them via SSH if
 * needed. Safe to call from any step — idempotent, caches on context.
 */
export async function ensureVmIdentity(
  ctx: InstallerContext,
  projectId: string,
  zone: string,
  vmName: string,
): Promise<{ user: string; home: string }> {
  if (ctx.vmUser && ctx.vmHome) {
    return { user: ctx.vmUser, home: ctx.vmHome };
  }
  const identity = await resolveVmIdentity(projectId, zone, vmName);
  ctx.vmUser = identity.user;
  ctx.vmHome = identity.home;
  return identity;
}

/**
 * Step 11: Deploy Lox Core to VM
 *
 * Clones the repo, builds, creates env file, installs systemd service,
 * starts the watcher, and validates MCP server + Cloud Logging.
 */
export async function stepDeploy(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(11, TOTAL_STEPS, strings.step_embedding));

  const projectId = ctx.gcpProjectId ?? 'lox-project';
  const vmName = ctx.config.gcp?.vm_name ?? 'lox-vm';
  const zone = ctx.config.gcp?.zone ?? 'us-east1-b';

  // Resolve the actual POSIX user + $HOME on the VM. Must not derive from the
  // email — OS Login POSIX names differ from email prefixes (#79).
  const { user, home: vmHome } = await withSpinner(
    'Resolving VM user identity...',
    () => ensureVmIdentity(ctx, projectId, zone, vmName),
  );
  const installDir = ctx.config.install_dir ?? `${vmHome}/lox-brain`;
  const vaultPath = ctx.config.vault?.local_path ?? `${vmHome}/lox-vault`;

  // 1. Clone lox-brain repo on VM
  await withSpinner(
    'Cloning lox-brain repo on VM...',
    () => runRemoteScript(projectId, zone, vmName, 'clone', buildCloneScript(installDir)),
  );

  // 2. Build on VM
  await withSpinner(
    'Building lox-brain on VM (npm ci && npm run build)...',
    () => runRemoteScript(projectId, zone, vmName, 'build', buildBuildScript(installDir), { timeout: 600_000 }),
  );

  // 3. Create .env on VM from config (NOT in repo — in /etc/lox/secrets.env)
  await withSpinner(
    `${strings.configuring} secrets on VM...`,
    async () => {
      const dbUser = ctx.config.database?.user ?? 'lox';
      const dbName = ctx.config.database?.name ?? 'lox_brain';
      const dbHost = ctx.config.database?.host ?? '127.0.0.1';
      const dbPort = ctx.config.database?.port ?? 5432;

      const envContent = [
        `DATABASE_URL=postgresql://${dbUser}@${dbHost}:${dbPort}/${dbName}?sslmode=require`,
        'OPENAI_API_KEY=__REPLACE_FROM_SECRET_MANAGER__',
        `VAULT_PATH=${vaultPath}`,
        'NODE_ENV=production',
        'LOG_LEVEL=info',
      ].join('\n');

      await runRemoteScript(projectId, zone, vmName, 'secrets', buildSecretsEnvScript(envContent, user));
    },
  );

  console.log(chalk.yellow('  → IMPORTANT: Replace OPENAI_API_KEY in /etc/lox/secrets.env'));
  console.log(chalk.yellow('    Use: gcloud secrets versions access latest --secret=openai-api-key'));

  // 4. Install systemd service
  await withSpinner(
    'Installing lox-watcher systemd service...',
    async () => {
      const watcherService = buildWatcherService(user, installDir);
      await runRemoteScript(projectId, zone, vmName, 'systemd-install', buildSystemdInstallScript(watcherService));
    },
  );

  // 5. Enable and start watcher service
  await withSpinner(
    'Starting lox-watcher service...',
    () => runRemoteScript(projectId, zone, vmName, 'service-start', buildServiceStartScript()),
  );

  // 6. Test MCP server with a JSON-RPC test call
  const mcpHealthy = await withSpinner(
    'Testing MCP server...',
    async () => {
      try {
        const result = await runRemoteScript(projectId, zone, vmName, 'mcp-probe', buildMcpHealthProbeScript(installDir), { timeout: 60_000 });
        return result.includes('"jsonrpc"');
      } catch {
        return false;
      }
    },
  );

  if (mcpHealthy) {
    console.log(chalk.green('  ✓ MCP server responding'));
  } else {
    console.log(chalk.yellow('  ⚠ MCP server did not respond. Check logs: journalctl -u lox-watcher'));
  }

  // 7. Validate Cloud Logging is active
  await withSpinner(
    'Validating Cloud Logging...',
    async () => {
      try {
        await shell('gcloud', [
          'logging', 'read',
          `resource.type="gce_instance" AND resource.labels.instance_id="${vmName}"`,
          '--project', projectId,
          '--limit', '1',
          '--format', 'json',
        ]);
      } catch {
        console.log(chalk.yellow('  ⚠ Cloud Logging query failed. Verify logging agent is installed on VM.'));
      }
    },
  );

  console.log(chalk.green('  ✓ Lox core deployed to VM'));
  return { success: true };
}
