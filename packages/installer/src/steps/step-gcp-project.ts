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

  // Enable required APIs
  await withSpinner(
    `Enabling APIs (${REQUIRED_APIS.length})...`,
    async () => {
      await shell('gcloud', ['services', 'enable', ...REQUIRED_APIS, '--project', projectId]);
    },
  );

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
