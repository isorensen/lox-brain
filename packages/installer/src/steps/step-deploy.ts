import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;

/**
 * Execute a command on the VM via SSH through IAP tunnel.
 */
async function sshCommand(
  vmName: string,
  projectId: string,
  zone: string,
  command: string,
): Promise<string> {
  const { stdout } = await shell('gcloud', [
    'compute', 'ssh', vmName,
    '--project', projectId,
    '--zone', zone,
    '--tunnel-through-iap',
    '--command', command,
  ]);
  return stdout;
}

const WATCHER_SERVICE = `[Unit]
Description=Lox Vault Watcher
After=network.target postgresql.service

[Service]
Type=simple
User=sorensen
WorkingDirectory=/home/sorensen/lox-brain
ExecStart=/usr/bin/node packages/core/dist/watcher/index.js
EnvironmentFile=/etc/lox/secrets.env
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

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

  // 1. Clone lox-brain repo on VM
  await withSpinner(
    'Cloning lox-brain repo on VM...',
    async () => {
      await sshCommand(vmName, projectId, zone,
        'test -d ~/lox-brain && (cd ~/lox-brain && git pull) || gh repo clone lox-brain ~/lox-brain',
      );
    },
  );

  // 2. Build on VM
  await withSpinner(
    'Building lox-brain on VM (npm ci && npm run build)...',
    async () => {
      await sshCommand(vmName, projectId, zone,
        'cd ~/lox-brain && npm ci && npm run build --workspaces',
      );
    },
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
        `VAULT_PATH=/home/sorensen/lox-vault`,
        'NODE_ENV=production',
        'LOG_LEVEL=info',
      ].join('\n');

      // Create /etc/lox directory and write secrets.env (requires sudo)
      await sshCommand(vmName, projectId, zone,
        `sudo mkdir -p /etc/lox && echo '${envContent}' | sudo tee /etc/lox/secrets.env > /dev/null && sudo chmod 600 /etc/lox/secrets.env && sudo chown sorensen:sorensen /etc/lox/secrets.env`,
      );
    },
  );

  console.log(chalk.yellow('  → IMPORTANT: Replace OPENAI_API_KEY in /etc/lox/secrets.env'));
  console.log(chalk.yellow('    Use: gcloud secrets versions access latest --secret=openai-api-key'));

  // 4. Install systemd service
  await withSpinner(
    'Installing lox-watcher systemd service...',
    async () => {
      await sshCommand(vmName, projectId, zone,
        `echo '${WATCHER_SERVICE}' | sudo tee /etc/systemd/system/lox-watcher.service > /dev/null`,
      );
    },
  );

  // 5. Enable and start watcher service
  await withSpinner(
    'Starting lox-watcher service...',
    async () => {
      await sshCommand(vmName, projectId, zone,
        'sudo systemctl daemon-reload && sudo systemctl enable lox-watcher && sudo systemctl start lox-watcher',
      );
    },
  );

  // 6. Test MCP server with a JSON-RPC test call
  const mcpHealthy = await withSpinner(
    'Testing MCP server...',
    async () => {
      try {
        const result = await sshCommand(vmName, projectId, zone,
          'echo \'{"jsonrpc":"2.0","method":"tools/list","id":1}\' | timeout 10 node ~/lox-brain/packages/core/dist/mcp/index.js 2>/dev/null | head -1',
        );
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
