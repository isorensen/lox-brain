import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;
const VPC_NAME = 'lox-vpc';
const SUBNET_NAME = 'lox-subnet';
const SUBNET_RANGE = '10.0.0.0/24';
const ROUTER_NAME = 'lox-router';
const NAT_NAME = 'lox-nat';

/**
 * Check if a VPC network already exists.
 */
async function vpcExists(project: string): Promise<boolean> {
  try {
    await shell('gcloud', [
      'compute', 'networks', 'describe', VPC_NAME,
      '--project', project,
      '--format=value(name)',
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the default VPC and its firewall rules.
 * Non-fatal: if default VPC doesn't exist, skip silently.
 */
async function deleteDefaultVpc(project: string): Promise<void> {
  try {
    const { stdout } = await shell('gcloud', [
      'compute', 'firewall-rules', 'list',
      '--filter=network=default',
      '--format=value(name)',
      '--project', project,
    ]);

    const rules = stdout.split('\n').filter(Boolean);
    for (const rule of rules) {
      await shell('gcloud', [
        'compute', 'firewall-rules', 'delete', rule,
        '--quiet', '--project', project,
      ]);
    }

    await shell('gcloud', [
      'compute', 'networks', 'delete', 'default',
      '--quiet', '--project', project,
    ]);
  } catch {
    // Default VPC may not exist — non-fatal
  }
}

/**
 * Step 5: Create custom VPC, subnet, firewall rules, Cloud Router, and Cloud NAT.
 * Follows Zero Trust: deny-all default, only required ports open.
 */
export async function stepNetwork(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  const project = ctx.gcpProjectId;
  const region = ctx.config.gcp?.region;

  if (!project || !region) {
    return { success: false, message: 'GCP project or region not set. Run step 3 first.' };
  }

  console.log(renderStepHeader(5, TOTAL_STEPS, strings.step_vpc_network));

  // Check if VPC already exists
  const exists = await vpcExists(project);
  if (exists) {
    console.log(chalk.yellow(`  → ${VPC_NAME} already exists, skipping creation.`));
    return { success: true };
  }

  // Create custom VPC
  await withSpinner(
    `${strings.creating} VPC ${VPC_NAME}...`,
    async () => {
      await shell('gcloud', [
        'compute', 'networks', 'create', VPC_NAME,
        '--subnet-mode=custom',
        '--project', project,
      ]);
    },
  );

  // Create subnet
  await withSpinner(
    `${strings.creating} subnet ${SUBNET_NAME}...`,
    async () => {
      await shell('gcloud', [
        'compute', 'networks', 'subnets', 'create', SUBNET_NAME,
        '--network', VPC_NAME,
        '--range', SUBNET_RANGE,
        '--region', region,
        '--project', project,
      ]);
    },
  );

  // Firewall: allow WireGuard (UDP 51820) from anywhere to vpn-server tagged instances
  await withSpinner(
    `${strings.creating} firewall rule allow-wireguard...`,
    async () => {
      await shell('gcloud', [
        'compute', 'firewall-rules', 'create', 'allow-wireguard',
        '--network', VPC_NAME,
        '--allow=udp:51820',
        '--source-ranges=0.0.0.0/0',
        '--target-tags=vpn-server',
        '--project', project,
      ]);
    },
  );

  // Firewall: allow internal VPC communication
  await withSpinner(
    `${strings.creating} firewall rule allow-internal...`,
    async () => {
      await shell('gcloud', [
        'compute', 'firewall-rules', 'create', 'allow-internal',
        '--network', VPC_NAME,
        '--allow=tcp,udp,icmp',
        '--source-ranges', SUBNET_RANGE,
        '--project', project,
      ]);
    },
  );

  // Firewall: allow IAP SSH (Google's Identity-Aware Proxy range)
  await withSpinner(
    `${strings.creating} firewall rule allow-iap-ssh...`,
    async () => {
      await shell('gcloud', [
        'compute', 'firewall-rules', 'create', 'allow-iap-ssh',
        '--network', VPC_NAME,
        '--allow=tcp:22',
        '--source-ranges=35.235.240.0/20',
        '--target-tags=allow-iap',
        '--project', project,
      ]);
    },
  );

  // Cloud Router for NAT
  await withSpinner(
    `${strings.creating} Cloud Router ${ROUTER_NAME}...`,
    async () => {
      await shell('gcloud', [
        'compute', 'routers', 'create', ROUTER_NAME,
        '--network', VPC_NAME,
        '--region', region,
        '--project', project,
      ]);
    },
  );

  // Cloud NAT (allows outbound internet without public IP)
  await withSpinner(
    `${strings.creating} Cloud NAT ${NAT_NAME}...`,
    async () => {
      await shell('gcloud', [
        'compute', 'routers', 'nats', 'create', NAT_NAME,
        '--router', ROUTER_NAME,
        '--region', region,
        '--auto-allocate-nat-external-ips',
        '--nat-all-subnet-ip-ranges',
        '--project', project,
      ]);
    },
  );

  // Delete default VPC (security hardening)
  await withSpinner(
    'Removing default VPC...',
    async () => {
      await deleteDefaultVpc(project);
    },
  );

  console.log(chalk.green(`  ✓ Network ${VPC_NAME} ready (${region})`));
  return { success: true };
}
