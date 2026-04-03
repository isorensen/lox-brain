#!/usr/bin/env node

import { renderSplash } from './ui/splash.js';
import { stepLanguage } from './steps/step-language.js';
import { stepPrerequisites } from './steps/step-prerequisites.js';
import { stepGcpAuth } from './steps/step-gcp-auth.js';
import { stepGcpProject } from './steps/step-gcp-project.js';
import { stepBilling } from './steps/step-billing.js';
import type { InstallerContext } from './steps/types.js';

async function main(): Promise<void> {
  // Check for subcommands
  const args = process.argv.slice(2);
  if (args[0] === 'migrate') {
    const { runMigration } = await import('./migrate.js');
    await runMigration();
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

  console.log('\nSteps 5-12 coming in next phase...\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
