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
import type { InstallerContext } from './steps/types.js';

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
  if (!prereqResult.success) {
    console.error(`\n${prereqResult.message}`);
    process.exit(1);
  }

  // Step 2: GCP Auth
  const authResult = await stepGcpAuth(ctx);
  if (!authResult.success) {
    console.error(`\n${authResult.message}`);
    process.exit(1);
  }

  // Step 3: GCP Project
  const projectResult = await stepGcpProject(ctx);
  if (!projectResult.success) {
    console.error(`\n${projectResult.message}`);
    process.exit(1);
  }

  // Step 4: Billing
  const billingResult = await stepBilling(ctx);
  if (!billingResult.success) {
    console.error(`\n${billingResult.message}`);
    process.exit(1);
  }

  // Step 5: VPC Network
  const networkResult = await stepNetwork(ctx);
  if (!networkResult.success) {
    console.error(`\n${networkResult.message}`);
    process.exit(1);
  }

  // Step 6: VM Instance
  const vmResult = await stepVm(ctx);
  if (!vmResult.success) {
    console.error(`\n${vmResult.message}`);
    process.exit(1);
  }

  // Step 7: VM Setup (Node.js, PostgreSQL, pgvector)
  const vmSetupResult = await stepVmSetup(ctx);
  if (!vmSetupResult.success) {
    console.error(`\n${vmSetupResult.message}`);
    process.exit(1);
  }

  // Step 8: WireGuard VPN
  const vpnResult = await stepVpn(ctx);
  if (!vpnResult.success) {
    console.error(`\n${vpnResult.message}`);
    process.exit(1);
  }

  // Step 9: Vault Setup
  const vaultResult = await stepVault(ctx);
  if (!vaultResult.success) {
    console.error(`\n${vaultResult.message}`);
    process.exit(1);
  }

  // Step 10: Obsidian
  const obsidianResult = await stepObsidian(ctx);
  if (!obsidianResult.success) {
    console.error(`\n${obsidianResult.message}`);
    process.exit(1);
  }

  // Step 11: Deploy Lox Core
  const deployResult = await stepDeploy(ctx);
  if (!deployResult.success) {
    console.error(`\n${deployResult.message}`);
    process.exit(1);
  }

  // Step 12: Claude Code MCP
  const mcpResult = await stepMcp(ctx);
  if (!mcpResult.success) {
    console.error(`\n${mcpResult.message}`);
    process.exit(1);
  }

  // Post-install: Security audit + success screen
  await runPostInstall(ctx);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
