import chalk from 'chalk';
import { shell } from '../utils/shell.js';
import { t } from '../i18n/index.js';
import { renderStepHeader } from '../ui/box.js';
import { withSpinner } from '../ui/spinner.js';
import type { InstallerContext, StepResult } from './types.js';

const TOTAL_STEPS = 12;
const DEFAULT_REGION = 'us-east1';
const DEFAULT_ZONE = 'us-east1-b';
const REQUIRED_APIS = [
  'compute.googleapis.com',
  'secretmanager.googleapis.com',
  'logging.googleapis.com',
];

const BILLING_CREATE_URL = 'https://console.cloud.google.com/billing/create';

/**
 * Check if a GCP project already exists and is accessible.
 */
async function projectExists(projectId: string): Promise<boolean> {
  try {
    await shell('gcloud', ['projects', 'describe', projectId, '--format=value(projectId)']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a billing account is linked to the project.
 * Returns the billing account name if linked, empty string otherwise.
 */
export async function checkBillingEnabled(projectId: string): Promise<string> {
  try {
    const result = await shell('gcloud', [
      'billing', 'projects', 'describe', projectId,
      '--format=value(billingAccountName)',
    ]);
    return result.stdout;
  } catch {
    return '';
  }
}

/**
 * List the user's available open billing accounts.
 * Returns array of { id, displayName } objects.
 */
export async function listBillingAccounts(): Promise<Array<{ id: string; displayName: string }>> {
  try {
    const result = await shell('gcloud', [
      'billing', 'accounts', 'list',
      '--format=value(name,displayName)',
      '--filter=open=true',
    ]);
    if (!result.stdout) return [];

    return result.stdout
      .split('\n')
      .filter((line) => line.startsWith('billingAccounts/'))
      .map((line) => {
        // Format: "billingAccounts/XXXXXX-YYYYYY-ZZZZZZ\tDisplay Name"
        const [fullId, ...nameParts] = line.split('\t');
        const id = fullId.replace('billingAccounts/', '');
        return { id, displayName: nameParts.join('\t') || id };
      });
  } catch {
    return [];
  }
}

/**
 * Link a billing account to a GCP project.
 */
export async function linkBillingAccount(projectId: string, billingAccountId: string): Promise<void> {
  await shell('gcloud', [
    'billing', 'projects', 'link', projectId,
    `--billing-account=${billingAccountId}`,
  ]);
}

/**
 * Prompt the user to select a billing account and link it to the project.
 */
async function promptAndLink(
  projectId: string,
  accounts: Array<{ id: string; displayName: string }>,
  strings: ReturnType<typeof t>,
): Promise<void> {
  const { select } = await import('@inquirer/prompts');
  const selectedAccountId = await select({
    message: strings.billing_select_account,
    choices: accounts.map((a) => ({
      name: `${a.displayName} (${a.id})`,
      value: a.id,
    })),
  });

  await withSpinner(
    strings.billing_linking,
    () => linkBillingAccount(projectId, selectedAccountId),
  );

  console.log(chalk.green(`  ✓ ${strings.billing_linked_success}`));
}

/**
 * Ensure a billing account is linked to the project.
 * If not linked, guide the user through selecting or creating one.
 * Returns { success: true } if billing is set up, or { success: false, message } if not.
 */
export async function ensureBilling(projectId: string, strings: ReturnType<typeof t>): Promise<StepResult> {
  // Check if billing is already enabled
  const billingAccount = await withSpinner(
    strings.billing_checking,
    () => checkBillingEnabled(projectId),
  );

  if (billingAccount) {
    return { success: true };
  }

  // Billing not linked
  console.log(chalk.yellow(`  → ${strings.billing_not_linked}: ${projectId}`));

  // List available billing accounts
  const accounts = await listBillingAccounts();

  if (accounts.length > 0) {
    await promptAndLink(projectId, accounts, strings);
    return { success: true };
  }

  // No billing accounts found — guide user to create one
  console.log(chalk.yellow(`  ${strings.billing_no_accounts}`));
  console.log(chalk.cyan(`  ${BILLING_CREATE_URL}`));
  console.log();

  const { input } = await import('@inquirer/prompts');
  await input({ message: strings.billing_press_enter });

  // Re-check after user creates one
  const billingAfterCreate = await withSpinner(
    strings.billing_checking,
    () => checkBillingEnabled(projectId),
  );

  if (billingAfterCreate) {
    console.log(chalk.green(`  ✓ ${strings.billing_linked_success}`));
    return { success: true };
  }

  // Still no billing — try listing again in case they created but didn't link
  const accountsAfterCreate = await listBillingAccounts();

  if (accountsAfterCreate.length > 0) {
    await promptAndLink(projectId, accountsAfterCreate, strings);
    return { success: true };
  }

  return { success: false, message: strings.billing_required_for_apis };
}

/**
 * Check if an error message indicates a billing issue.
 */
function isBillingError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.toLowerCase().includes('billing');
  }
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr: string }).stderr;
    return typeof stderr === 'string' && stderr.toLowerCase().includes('billing');
  }
  return false;
}

export async function stepGcpProject(ctx: InstallerContext): Promise<StepResult> {
  const strings = t();
  console.log(renderStepHeader(3, TOTAL_STEPS, strings.step_gcp_project));

  const defaultId = `lox-brain-${ctx.gcpUsername ?? 'user'}`;
  const { input } = await import('@inquirer/prompts');

  const projectId = await input({
    message: 'GCP Project ID:',
    default: defaultId,
    validate: (value: string) => {
      if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) {
        return 'Project ID must be 6-30 chars, start with a letter, and contain only lowercase letters, digits, and hyphens.';
      }
      return true;
    },
  });

  ctx.gcpProjectId = projectId;

  // Check if project already exists
  const exists = await projectExists(projectId);

  if (exists) {
    console.log(chalk.yellow(`  → Project ${projectId} already exists, reusing it.`));
  } else {
    // Create the project
    await withSpinner(
      `${strings.creating} project ${projectId}...`,
      async () => {
        await shell('gcloud', ['projects', 'create', projectId]);
      },
    );
  }

  // Set as default project
  await withSpinner(
    `${strings.configuring} default project...`,
    async () => {
      await shell('gcloud', ['config', 'set', 'project', projectId]);
    },
  );

  // Ensure billing is linked before enabling APIs
  const billingResult = await ensureBilling(projectId, strings);
  if (!billingResult.success) {
    return billingResult;
  }

  // Enable required APIs
  try {
    await withSpinner(
      `Enabling APIs (${REQUIRED_APIS.length})...`,
      async () => {
        await shell('gcloud', ['services', 'enable', ...REQUIRED_APIS, '--project', projectId]);
      },
    );
  } catch (err: unknown) {
    if (isBillingError(err)) {
      return {
        success: false,
        message: strings.billing_required_for_apis,
      };
    }
    throw err;
  }

  // Set default region and zone
  await withSpinner(
    `${strings.configuring} region=${DEFAULT_REGION}, zone=${DEFAULT_ZONE}...`,
    async () => {
      await shell('gcloud', ['config', 'set', 'compute/region', DEFAULT_REGION]);
      await shell('gcloud', ['config', 'set', 'compute/zone', DEFAULT_ZONE]);
    },
  );

  // Store in config
  ctx.config.gcp = {
    project: projectId,
    region: DEFAULT_REGION,
    zone: DEFAULT_ZONE,
    vm_name: 'lox-vm',
    service_account: '',
  };

  console.log(chalk.green(`  ✓ Project ${projectId} ready (${DEFAULT_REGION})`));
  return { success: true };
}
