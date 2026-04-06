import { stepPrerequisites } from './step-prerequisites.js';
import { stepGcpAuth } from './step-gcp-auth.js';
import { stepGcpProject } from './step-gcp-project.js';
import { stepBilling } from './step-billing.js';
import { stepNetwork } from './step-network.js';
import { stepVm } from './step-vm.js';
import { stepVmSetup } from './step-vm-setup.js';
import { stepVpn } from './step-vpn.js';
import { stepVault } from './step-vault.js';
import { stepObsidian } from './step-obsidian.js';
import { stepDeploy } from './step-deploy.js';
import { stepMcp } from './step-mcp.js';
import type { InstallerStep } from './types.js';

/**
 * Ordered list of post-language installer steps. Indices here are 1..12 and
 * match the `Step N/12` headers each step renders. Step 0 (language) is
 * handled separately because it must run before i18n is initialised.
 *
 * Isolated from index.ts to avoid a circular import: the resume prompt
 * needs STEPS to render step names, and index.ts imports the resume
 * prompt to offer it on startup.
 */
export interface StepEntry {
  /** 1-based step index shown to the user. */
  num: number;
  /** Short, stable English name used in handleStepFailure and error reports. */
  name: string;
  fn: InstallerStep;
}

export const STEPS: StepEntry[] = [
  { num: 1, name: 'Prerequisites', fn: stepPrerequisites },
  { num: 2, name: 'GCP Auth', fn: stepGcpAuth },
  { num: 3, name: 'GCP Project', fn: stepGcpProject },
  { num: 4, name: 'Billing', fn: stepBilling },
  { num: 5, name: 'VPC Network', fn: stepNetwork },
  { num: 6, name: 'VM Instance', fn: stepVm },
  { num: 7, name: 'VM Setup', fn: stepVmSetup },
  { num: 8, name: 'WireGuard VPN', fn: stepVpn },
  { num: 9, name: 'Vault Setup', fn: stepVault },
  { num: 10, name: 'Obsidian', fn: stepObsidian },
  { num: 11, name: 'Deploy', fn: stepDeploy },
  { num: 12, name: 'MCP Server', fn: stepMcp },
];
