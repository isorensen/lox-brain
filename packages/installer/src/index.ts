#!/usr/bin/env node

import { renderSplash } from './ui/splash.js';
import { stepLanguage } from './steps/step-language.js';
import { stepPrerequisites } from './steps/step-prerequisites.js';
import { stepGcpAuth } from './steps/step-gcp-auth.js';
import { stepGcpProject } from './steps/step-gcp-project.js';
import { stepBilling } from './steps/step-billing.js';
import { stepNetwork } from './steps/step-network.js';
import { stepVm } from './steps/step-vm.js';
import { stepVmSetup } from './steps/step-vm-setup.js';
import { stepVpn } from './steps/step-vpn.js';
import { stepVault } from './steps/step-vault.js';
import { stepObsidian } from './steps/step-obsidian.js';
import { stepDeploy } from './steps/step-deploy.js';
import { stepMcp } from './steps/step-mcp.js';
import { runPostInstall } from './steps/step-post-install.js';
import { offerErrorReport, extractSubPhase, sourceFileForStep } from './utils/error-report.js';
import { LOX_VERSION } from '@lox-brain/shared';
import type { InstallerContext } from './steps/types.js';

async function handleStepFailure(stepName: string, message: string | undefined): Promise<never> {
  console.error(`\n${message ?? 'Unknown error'}`);
  await offerErrorReport({
    stepName,
    errorMessage: message ?? 'Unknown error',
    subPhase: extractSubPhase(message ?? ''),
    sourceFile: sourceFileForStep(stepName),
    loxVersion: LOX_VERSION,
    os: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
  });
  process.exit(1);
}

async function main(): Promise<void> {
  // Check for subcommands
  const args = process.argv.slice(2);
  if (args[0] === 'migrate') {
    const { runMigration } = await import('./migrate.js');
    await runMigration(args[1]); // optional: explicit path to old installation
    return;
  }
  if (args[0] === 'status') {
    console.log('lox status: coming soon');
    return;
  }

  const ctx: InstallerContext = { config: {}, locale: 'en' };

  // Step 0: Language
  const langResult = await stepLanguage(ctx);
  if (!langResult.success) process.exit(1);

  console.log(renderSplash());

  // Step 1: Prerequisites
  const prereqResult = await stepPrerequisites(ctx);
  if (!prereqResult.success) await handleStepFailure('Prerequisites', prereqResult.message);

  // Step 2: GCP Auth
  const authResult = await stepGcpAuth(ctx);
  if (!authResult.success) await handleStepFailure('GCP Auth', authResult.message);

  // Step 3: GCP Project
  const projectResult = await stepGcpProject(ctx);
  if (!projectResult.success) await handleStepFailure('GCP Project', projectResult.message);

  // Step 4: Billing
  const billingResult = await stepBilling(ctx);
  if (!billingResult.success) await handleStepFailure('Billing', billingResult.message);

  // Step 5: VPC Network
  const networkResult = await stepNetwork(ctx);
  if (!networkResult.success) await handleStepFailure('VPC Network', networkResult.message);

  // Step 6: VM Instance
  const vmResult = await stepVm(ctx);
  if (!vmResult.success) await handleStepFailure('VM Instance', vmResult.message);

  // Step 7: VM Setup (Node.js, PostgreSQL, pgvector)
  const vmSetupResult = await stepVmSetup(ctx);
  if (!vmSetupResult.success) await handleStepFailure('VM Setup', vmSetupResult.message);

  // Step 8: WireGuard VPN
  const vpnResult = await stepVpn(ctx);
  if (!vpnResult.success) await handleStepFailure('WireGuard VPN', vpnResult.message);

  // Step 9: Vault Setup
  const vaultResult = await stepVault(ctx);
  if (!vaultResult.success) await handleStepFailure('Vault Setup', vaultResult.message);

  // Step 10: Obsidian
  const obsidianResult = await stepObsidian(ctx);
  if (!obsidianResult.success) await handleStepFailure('Obsidian', obsidianResult.message);

  // Step 11: Deploy Lox Core
  const deployResult = await stepDeploy(ctx);
  if (!deployResult.success) await handleStepFailure('Deploy', deployResult.message);

  // Step 12: Claude Code MCP
  const mcpResult = await stepMcp(ctx);
  if (!mcpResult.success) await handleStepFailure('MCP Server', mcpResult.message);

  // Post-install: Security audit + success screen
  await runPostInstall(ctx);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
