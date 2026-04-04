import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

/**
 * Returns true when an error is caused by a process timeout (SIGTERM / killed).
 */
function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes('timed out') ||
      err.message.includes('SIGTERM') ||
      ('killed' in err && (err as unknown as { killed: boolean }).killed === true)
    );
  }
  if (err !== null && typeof err === 'object' && 'killed' in err) {
    return (err as { killed: boolean }).killed === true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const TOTAL_STEPS = 12;
const VM_NAME = 'lox-vm';
const DB_NAME = 'lox_brain';
const DB_USER = 'lox';
const SSH_TIMEOUT = 300_000; // 5 minutes — default for individual SSH calls

// --------------------------------------------------------------------------
// Setup phases — each gets its own SSH call and spinner
// --------------------------------------------------------------------------

interface SetupPhase {
  /** i18n key for spinner text */
  name: string;
  /** Shell commands joined with && */
  commands: string[];
  /** Timeout in ms */
  timeout: number;
}

const SETUP_PHASES: SetupPhase[] = [
  {
    name: 'vm_phase_system_update',
    commands: [
      'sudo apt-get update -qq',
      'sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq',
    ],
    timeout: 300_000, // 5 min
  },
  {
    name: 'vm_phase_nodejs',
    commands: [
      'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs',
    ],
    timeout: 180_000, // 3 min
  },
  {
    name: 'vm_phase_postgresql',
    commands: [
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 postgresql-server-dev-16',
    ],
    timeout: 180_000, // 3 min
  },
  {
    name: 'vm_phase_pgvector',
    commands: [
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential git',
      'cd /tmp && git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git',
      'cd /tmp/pgvector && make && sudo make install',
      'rm -rf /tmp/pgvector',
    ],
    timeout: 300_000, // 5 min — compiling from source
  },
  {
    name: 'vm_phase_ssh_hardening',
    commands: [
      'sudo sed -i "s/#PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config',
      'sudo sed -i "s/PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config',
      'sudo sed -i "s/#PermitRootLogin prohibit-password/PermitRootLogin no/" /etc/ssh/sshd_config',
      'sudo sed -i "s/PermitRootLogin yes/PermitRootLogin no/" /etc/ssh/sshd_config',
      'sudo systemctl restart ssh',
    ],
    timeout: 60_000, // 1 min
  },
  {
    name: 'vm_phase_wireguard',
    commands: [
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard',
    ],
    timeout: 120_000, // 2 min
  },
];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Extract the meaningful error message from an execSync failure.
 * Prefers gcloud ERROR: lines from stderr, falls back to first stderr line,
 * then to the generic err.message.
 */
function extractExecError(err: unknown): string {
  let msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = Buffer.isBuffer((err as { stderr: unknown }).stderr)
      ? ((err as { stderr: Buffer }).stderr).toString('utf-8').trim()
      : String((err as { stderr: unknown }).stderr).trim();
    if (stderr) {
      const errorLines = stderr.split('\n').filter(l => l.startsWith('ERROR:'));
      msg = errorLines.length > 0
        ? errorLines.join(' ')
        : (stderr.split('\n')[0] || msg);
    }
  }
  return msg;
}

/**
 * Base gcloud SSH args shared by all SSH helpers.
 */
function baseSshArgs(project: string, zone: string): string[] {
  return [
    'compute', 'ssh', VM_NAME,
    `--zone=${zone}`,
    `--project=${project}`,
    '--tunnel-through-iap',
    '--quiet',
    '--strict-host-key-checking=no',
  ];
}

// --------------------------------------------------------------------------
// Command builders — pure functions, exported for cross-platform safety tests
// --------------------------------------------------------------------------

/** Build the gcloud SSH warmup command string. */
export function buildWarmupCommand(project: string, zone: string): string {
  const args = baseSshArgs(project, zone);
  args.push('--command=true');
  return `gcloud ${args.join(' ')}`;
}

/** Build the gcloud SSH exec command string. */
export function buildSshExecCommand(project: string, zone: string, command: string): string {
  const args = baseSshArgs(project, zone);
  args.push(`--command="${command}"`);
  return `gcloud ${args.join(' ')}`;
}

/** Build the gcloud SCP upload command string. */
export function buildScpCommand(project: string, zone: string, localPath: string, remotePath: string): string {
  return `gcloud compute scp "${localPath}" ${VM_NAME}:${remotePath} --zone=${zone} --project=${project} --tunnel-through-iap --quiet`;
}

/** Build the gcloud SSH script execution command string. */
export function buildSshExecScriptCommand(project: string, zone: string, remotePath: string): string {
  const args = baseSshArgs(project, zone);
  args.push(`--command="bash ${remotePath}"`);
  return `gcloud ${args.join(' ')}`;
}

/**
 * Warm-up the SSH connection with stdio inherited so the user can
 * answer interactive prompts (SSH key passphrase, host key verification).
 * Must be called once before any piped SSH calls.
 *
 * SECURITY: No user-controlled values are interpolated into the command
 * string. project/zone originate from gcloud config, not user input.
 */
function sshWarmup(project: string, zone: string): void {
  // execSync is required here (not execFile) because stdio: 'inherit'
  // must pass through interactive SSH key generation prompts to the user.
  // stdin/stdout inherited for interactive prompts; stderr piped to capture gcloud errors.
  execSync(buildWarmupCommand(project, zone), {
    timeout: SSH_TIMEOUT,
    stdio: ['inherit', 'inherit', 'pipe'],
  });
}

/**
 * Execute a short command on the VM via IAP tunnel SSH.
 * Uses execSync with pipe to capture output.
 *
 * IMPORTANT: Only use for simple commands without complex quoting
 * (e.g. tail, echo, journalctl). For multi-line scripts with sed,
 * SQL, or && chains, use {@link sshExecScript} instead.
 *
 * SECURITY: No user-controlled values are interpolated into the command
 * string. project/zone originate from gcloud config, not user input.
 */
async function sshExec(
  project: string,
  zone: string,
  command: string,
  timeout?: number,
): Promise<string> {
  // execSync is required here (not execFile) to avoid cmd.exe argument
  // parsing issues on Windows — see issue #31.
  const result = execSync(buildSshExecCommand(project, zone, command), {
    timeout: timeout ?? SSH_TIMEOUT,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  return (result ?? '').trim();
}

/**
 * Execute a multi-line script on the VM by uploading it via SCP first.
 *
 * This avoids shell quoting issues on Windows where cmd.exe interprets
 * && and double quotes inside the --command argument. The script is
 * written to a local temp file, SCP'd to the VM, then executed via SSH.
 *
 * SECURITY: No user-controlled values are interpolated into the command
 * strings. project/zone originate from gcloud config. The script content
 * is written to a file (not interpolated into a shell command).
 */
async function sshExecScript(
  project: string,
  zone: string,
  script: string,
  timeout?: number,
): Promise<string> {
  const suffix = crypto.randomBytes(4).toString('hex');
  const localTmp = join(tmpdir(), `lox-ssh-${suffix}.sh`);
  const remotePath = `/tmp/lox-setup-${suffix}.sh`;

  writeFileSync(localTmp, script, { mode: 0o700 });

  try {
    // Upload script to VM via SCP through IAP tunnel
    // execSync required for same Windows cmd.exe reasons as sshExec.
    execSync(
      buildScpCommand(project, zone, localTmp, remotePath),
      { timeout: 30_000, stdio: 'pipe' },
    );

    // Execute on the remote side. No inline cleanup — && is interpreted
    // as a command separator by cmd.exe on Windows even inside quotes.
    // The temp script in /tmp is cleaned on next VM reboot.
    const result = execSync(buildSshExecScriptCommand(project, zone, remotePath), {
      timeout: timeout ?? SSH_TIMEOUT,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return (result ?? '').trim();
  } finally {
    try { unlinkSync(localTmp); } catch { /* ignore */ }
  }
}

/**
 * Generate a cryptographically secure random password.
 */
function generatePassword(length = 32): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

/**
 * Attempt to fetch recent logs from the VM for timeout diagnosis.
 * Returns null if logs cannot be retrieved (fails gracefully).
 */
async function fetchVmLogs(project: string, zone: string): Promise<string | null> {
  try {
    // Uses sshExecScript (not sshExec) because the command contains
    // double quotes and || chains that break cmd.exe parsing on Windows.
    const output = await sshExecScript(
      project,
      zone,
      'tail -20 /var/log/apt/term.log 2>/dev/null || journalctl -n 20 --no-pager 2>/dev/null || echo "No logs available"',
      15_000,
    );
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Build the DB setup script: PostgreSQL config, database creation, and schema.
 * Separated from other phases because it requires the generated password.
 */
function buildDbSetupScript(dbPassword: string): string {
  return [
    'set -euo pipefail',

    // Configure PostgreSQL: listen on localhost only (Zero Trust)
    "sudo sed -i \"s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/\" /etc/postgresql/16/main/postgresql.conf",
    'sudo systemctl restart postgresql',

    // Create DB user and database
    `sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${dbPassword}';"`,
    `sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"`,
    `sudo -u postgres psql -d ${DB_NAME} -c "CREATE EXTENSION IF NOT EXISTS vector;"`,

    // Apply schema
    `sudo -u postgres psql -d ${DB_NAME} -c "
      CREATE TABLE IF NOT EXISTS vault_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_path TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tags TEXT[] NOT NULL DEFAULT '{}',
        embedding vector(1536),
        file_hash TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_embedding_cosine ON vault_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      CREATE INDEX IF NOT EXISTS idx_tags ON vault_embeddings USING gin (tags);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON vault_embeddings (updated_at DESC);
    "`,
  ].join(' && ');
}

// --------------------------------------------------------------------------
// Main step
// --------------------------------------------------------------------------

/**
 * Step 7: SSH into VM via IAP and set up Node.js, PostgreSQL + pgvector,
 * create database, apply schema, store password in Secret Manager, harden SSH.
 *
 * Each phase runs as a separate SSH call with its own spinner, giving the user
 * granular progress feedback instead of a single 5-10 minute wait.
 */
export async function stepVmSetup(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  const project = ctx.gcpProjectId;
  const zone = ctx.config.gcp?.zone;

  if (!project || !zone) {
    return { success: false, message: 'GCP project or zone not set. Run step 3 first.' };
  }

  console.log(renderStepHeader(7, TOTAL_STEPS, strings.step_postgresql));

  // --- SSH warm-up: handles first-connection key generation interactively ---
  try {
    const warmupLabel = strings.vm_ssh_warmup || 'Establishing SSH connection to VM';
    console.log(chalk.cyan(`  ${warmupLabel}...`));
    sshWarmup(project, zone);
    console.log(chalk.green(`  ✓ ${warmupLabel}`));
  } catch (err) {
    return { success: false, message: `SSH warm-up failed: ${extractExecError(err)}` };
  }

  // Generate a secure DB password
  const dbPassword = generatePassword();

  // --- Run each setup phase with its own spinner ---
  for (const phase of SETUP_PHASES) {
    const phaseLabel = strings[phase.name as keyof typeof strings] || phase.name;
    let timeout = phase.timeout;
    const maxTimeout = timeout * 2;

    // Per-phase retry loop (timeout only, one retry with doubled timeout)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await withSpinner(
          `${phaseLabel}...`,
          async () => {
            const script = ['set -euo pipefail', ...phase.commands].join(' && ');
            await sshExecScript(project, zone, script, timeout);
          },
        );
        console.log(chalk.green(`  ✓ ${phaseLabel}`));
        break; // phase succeeded
      } catch (err) {
        if (isTimeoutError(err) && timeout < maxTimeout) {
          // Try to fetch logs for diagnosis
          const logs = await fetchVmLogs(project, zone);
          if (logs) {
            console.log(chalk.dim(`\n  Last VM output:\n${logs}\n`));
          }

          const { confirm } = await import('@inquirer/prompts');
          const shouldRetry = await confirm({
            message: `${phaseLabel}: ${strings.vm_setup_timeout}`,
            default: true,
          });
          if (shouldRetry) {
            timeout = maxTimeout;
            continue;
          }
        }
        // Non-timeout, user declined, or already at max — fail with phase context
        if (isTimeoutError(err)) {
          const msg = `${phaseLabel} timed out after ${timeout / 1000}s`;
          return { success: false, message: msg };
        }
        return { success: false, message: `${phaseLabel} failed: ${extractExecError(err)}` };
      }
    }
  }

  // --- DB setup phase (needs password) ---
  {
    const dbLabel = strings.vm_phase_db_setup || 'vm_phase_db_setup';
    let timeout = 120_000;
    const maxTimeout = 240_000;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await withSpinner(
          `${dbLabel}...`,
          async () => {
            const dbScript = buildDbSetupScript(dbPassword);
            await sshExecScript(project, zone, dbScript, timeout);
          },
        );
        console.log(chalk.green(`  ✓ ${dbLabel}`));
        break;
      } catch (err) {
        if (isTimeoutError(err) && timeout < maxTimeout) {
          const logs = await fetchVmLogs(project, zone);
          if (logs) {
            console.log(chalk.dim(`\n  Last VM output:\n${logs}\n`));
          }

          const { confirm } = await import('@inquirer/prompts');
          const shouldRetry = await confirm({
            message: `${dbLabel}: ${strings.vm_setup_timeout}`,
            default: true,
          });
          if (shouldRetry) {
            timeout = maxTimeout;
            continue;
          }
        }
        if (isTimeoutError(err)) {
          const msg = `${dbLabel} timed out after ${timeout / 1000}s`;
          return { success: false, message: msg };
        }
        return { success: false, message: `${dbLabel} failed: ${extractExecError(err)}` };
      }
    }
  }

  // --- Store DB password in Secret Manager ---
  try {
    await withSpinner(
      'Storing database password in Secret Manager...',
      async () => {
        // Create the secret (may already exist)
        try {
          await shell('gcloud', [
            'secrets', 'create', 'lox-db-password',
            '--replication-policy=automatic',
            '--project', project,
          ]);
        } catch {
          // Secret may already exist — add a new version
        }

        // Write password to a temp file for cross-platform compatibility.
        // SECURITY: File has restrictive permissions (0o600) and is always deleted.
        const tmpFile = join(tmpdir(), `lox-db-pw-${crypto.randomBytes(8).toString('hex')}`);
        writeFileSync(tmpFile, dbPassword, { mode: 0o600 });
        try {
          await shell('gcloud', [
            'secrets', 'versions', 'add', 'lox-db-password',
            `--data-file=${tmpFile}`,
            '--project', project,
          ]);
        } finally {
          unlinkSync(tmpFile);
        }
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { success: false, message: `Failed to store DB password in Secret Manager: ${msg}` };
  }

  // Store database config
  ctx.config.database = {
    host: '127.0.0.1',
    port: 5432,
    name: DB_NAME,
    user: DB_USER,
  };

  console.log(chalk.green(`  ✓ VM setup complete (PostgreSQL 16 + pgvector, SSH hardened)`));
  return { success: true };
}
