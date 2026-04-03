import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;
const VM_NAME = 'lox-vm';
const SA_NAME = 'lox-vm-sa';
const MACHINE_TYPE = 'e2-small';
const IMAGE_FAMILY = 'ubuntu-2404-lts-amd64';
const IMAGE_PROJECT = 'ubuntu-os-cloud';
const BOOT_DISK_SIZE = '30GB';
const BOOT_DISK_TYPE = 'pd-ssd';
const VPC_NAME = 'lox-vpc';
const SUBNET_NAME = 'lox-subnet';

/**
 * Check if the service account already exists.
 */
async function saExists(project: string): Promise<boolean> {
  try {
    await shell('gcloud', [
      'iam', 'service-accounts', 'describe',
      `${SA_NAME}@${project}.iam.gserviceaccount.com`,
      '--project', project,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the VM instance already exists.
 */
async function vmExists(project: string, zone: string): Promise<boolean> {
  try {
    await shell('gcloud', [
      'compute', 'instances', 'describe', VM_NAME,
      '--zone', zone,
      '--project', project,
      '--format=value(name)',
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Step 6: Create dedicated service account with least-privilege roles,
 * then create the VM instance (no public IP, IAP tags).
 */
export async function stepVm(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  const project = ctx.gcpProjectId;
  const zone = ctx.config.gcp?.zone;

  if (!project || !zone) {
    return { success: false, message: 'GCP project or zone not set. Run step 3 first.' };
  }

  console.log(renderStepHeader(6, TOTAL_STEPS, strings.step_vm_instance));

  const saEmail = `${SA_NAME}@${project}.iam.gserviceaccount.com`;

  // Create service account if it doesn't exist
  const saAlreadyExists = await saExists(project);
  if (saAlreadyExists) {
    console.log(chalk.yellow(`  → Service account ${SA_NAME} already exists, reusing.`));
  } else {
    await withSpinner(
      `${strings.creating} service account ${SA_NAME}...`,
      async () => {
        await shell('gcloud', [
          'iam', 'service-accounts', 'create', SA_NAME,
          '--display-name=Lox VM Service Account',
          '--project', project,
        ]);
      },
    );
  }

  // Grant least-privilege IAM roles
  const roles = [
    'roles/secretmanager.secretAccessor',
    'roles/logging.logWriter',
  ];

  for (const role of roles) {
    await withSpinner(
      `Granting ${role.split('/')[1]}...`,
      async () => {
        await shell('gcloud', [
          'projects', 'add-iam-policy-binding', project,
          `--member=serviceAccount:${saEmail}`,
          `--role=${role}`,
          '--condition=None',
        ]);
      },
    );
  }

  // Create VM if it doesn't exist
  const vmAlreadyExists = await vmExists(project, zone);
  if (vmAlreadyExists) {
    console.log(chalk.yellow(`  → VM ${VM_NAME} already exists, skipping creation.`));
  } else {
    await withSpinner(
      `${strings.creating} VM ${VM_NAME} (${MACHINE_TYPE})...`,
      async () => {
        await shell('gcloud', [
          'compute', 'instances', 'create', VM_NAME,
          '--zone', zone,
          '--machine-type', MACHINE_TYPE,
          '--network', VPC_NAME,
          '--subnet', SUBNET_NAME,
          '--no-address',
          '--tags=vpn-server,allow-iap',
          `--service-account=${saEmail}`,
          '--scopes=cloud-platform',
          `--image-family=${IMAGE_FAMILY}`,
          `--image-project=${IMAGE_PROJECT}`,
          `--boot-disk-size=${BOOT_DISK_SIZE}`,
          `--boot-disk-type=${BOOT_DISK_TYPE}`,
          '--project', project,
        ]);
      },
    );
  }

  // Store service account in config
  if (ctx.config.gcp) {
    ctx.config.gcp.service_account = saEmail;
    ctx.config.gcp.vm_name = VM_NAME;
  }

  console.log(chalk.green(`  ✓ VM ${VM_NAME} ready (${zone}, no public IP)`));
  return { success: true };
}
