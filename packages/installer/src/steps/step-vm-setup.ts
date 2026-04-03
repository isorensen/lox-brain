import crypto from 'node:crypto';
import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;
const VM_NAME = 'lox-vm';
const DB_NAME = 'lox_brain';
const DB_USER = 'lox';
const SSH_TIMEOUT = 120_000; // 2 minutes per SSH command

/**
 * Execute a command on the VM via IAP tunnel SSH.
 * SECURITY: Uses gcloud compute ssh with -- to separate SSH args.
 */
async function sshExec(
  project: string,
  zone: string,
  command: string,
): Promise<string> {
  const { stdout } = await shell('gcloud', [
    'compute', 'ssh', VM_NAME,
    '--zone', zone,
    '--project', project,
    '--tunnel-through-iap',
    '--command', command,
  ]);
  return stdout;
}

/**
 * Generate a cryptographically secure random password.
 */
function generatePassword(length = 32): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

/**
 * Build the VM setup script that installs Node.js 22, PostgreSQL 16 + pgvector,
 * creates the database, and hardens SSH.
 */
function buildSetupScript(dbPassword: string): string {
  return [
    'set -euo pipefail',

    // Update system
    'sudo apt-get update -qq',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq',

    // Install Node.js 22 LTS
    'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs',

    // Install PostgreSQL 16
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 postgresql-server-dev-16',

    // Install pgvector from source
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential git',
    'cd /tmp && git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git',
    'cd /tmp/pgvector && make && sudo make install',
    'rm -rf /tmp/pgvector',

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

    // Harden SSH: disable password auth, disable root login
    'sudo sed -i "s/#PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config',
    'sudo sed -i "s/PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config',
    'sudo sed -i "s/#PermitRootLogin prohibit-password/PermitRootLogin no/" /etc/ssh/sshd_config',
    'sudo sed -i "s/PermitRootLogin yes/PermitRootLogin no/" /etc/ssh/sshd_config',
    'sudo systemctl restart sshd',

    // Install WireGuard (needed for step 8)
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard',

    'echo "VM_SETUP_COMPLETE"',
  ].join(' && ');
}

/**
 * Step 7: SSH into VM via IAP and set up Node.js, PostgreSQL + pgvector,
 * create database, apply schema, store password in Secret Manager, harden SSH.
 */
export async function stepVmSetup(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  const project = ctx.gcpProjectId;
  const zone = ctx.config.gcp?.zone;

  if (!project || !zone) {
    return { success: false, message: 'GCP project or zone not set. Run step 3 first.' };
  }

  console.log(renderStepHeader(7, TOTAL_STEPS, strings.step_postgresql));

  // Generate a secure DB password
  const dbPassword = generatePassword();

  // Run the setup script on the VM
  await withSpinner(
    `${strings.installing} Node.js 22, PostgreSQL 16, pgvector on VM...`,
    async () => {
      const script = buildSetupScript(dbPassword);
      const output = await sshExec(project, zone, script);
      if (!output.includes('VM_SETUP_COMPLETE')) {
        throw new Error('VM setup script did not complete successfully');
      }
    },
  );

  // Store DB password in Secret Manager
  await withSpinner(
    'Storing database password in Secret Manager...',
    async () => {
      // Create the secret
      try {
        await shell('gcloud', [
          'secrets', 'create', 'lox-db-password',
          '--replication-policy=automatic',
          '--project', project,
        ]);
      } catch {
        // Secret may already exist — add a new version
      }

      // Add the password as a secret version via stdin
      // SECURITY: Password is piped, never appears in process args
      await shell('bash', [
        '-c',
        `echo -n "${dbPassword}" | gcloud secrets versions add lox-db-password --data-file=- --project=${project}`,
      ]);
    },
  );

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
