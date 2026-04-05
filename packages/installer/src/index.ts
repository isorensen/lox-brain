#!/usr/bin/env node

import { renderSplash } from './ui/splash.js';
import { stepLanguage } from './steps/step-language.js';
import { runPostInstall } from './steps/step-post-install.js';
import { STEPS } from './steps/registry.js';
import { offerErrorReport } from './utils/error-report.js';
import { handleStepFailure as handleStepFailureExternal } from './step-failure.js';
import { formatFatalError } from './utils/format-error.js';
import { LOX_VERSION } from '@lox-brain/shared';
import { setLocale, t } from './i18n/index.js';
import { loadState, saveState, clearState } from './state.js';
import { promptResume, stepLabel } from './ui/resume-prompt.js';
import type { InstallerContext } from './steps/types.js';

function handleStepFailure(
  stepName: string,
  stepNum: number,
  message: string | undefined,
  ctx: InstallerContext,
  actionable: boolean = false,
): Promise<never> {
  return handleStepFailureExternal(stepName, stepNum, message, ctx, actionable, {
    loxVersion: LOX_VERSION,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  });
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

  let ctx: InstallerContext = { config: {}, locale: 'en' };
  let startFromStep = 1;
  let runLanguageStep = true;

  // Check for a resumable previous installation before asking for language —
  // we reuse the saved locale so the resume prompt appears in the user's
  // chosen language without re-asking (#81).
  const savedState = loadState();
  if (savedState) {
    setLocale(savedState.ctx.locale);
    ctx = savedState.ctx;
    console.log(renderSplash());
    const decision = await promptResume(savedState);
    if (decision === 'restart') {
      clearState();
      console.log(`\n${t().resume_cleared}\n`);
      ctx = { config: {}, locale: 'en' };
      // runLanguageStep stays true — fresh install re-asks language.
    } else {
      startFromStep = decision;
      runLanguageStep = false;
      console.log(`\n  ${t().resume_starting_from} ${stepLabel(startFromStep)}\n`);
    }
  }

  if (runLanguageStep) {
    // Step 0: Language
    const langResult = await stepLanguage(ctx);
    if (!langResult.success) process.exit(1);
    console.log(renderSplash());
  }

  for (const step of STEPS) {
    if (step.num < startFromStep) continue;
    let result: Awaited<ReturnType<typeof step.fn>>;
    try {
      result = await step.fn(ctx);
    } catch (err) {
      // Thrown exceptions (e.g. transient SSH drops from runRemoteScript
      // after exhausting retries) must also persist state so the v0.5.0
      // resume prompt can offer to restart from this exact step (#87).
      // Save first, then re-throw so the existing outer handler still
      // offers the error report and exits.
      try {
        saveState(ctx, step.num - 1, step.num, LOX_VERSION);
      } catch { /* best-effort */ }
      throw err;
    }
    if (!result.success) {
      await handleStepFailure(step.name, step.num, result.message, ctx, result.actionable);
    }
    // Persist progress after every successful step so a crash mid-run
    // leaves a resumable state file.
    try {
      saveState(ctx, step.num, null, LOX_VERSION);
    } catch { /* best-effort */ }
  }

  // Post-install: Security audit + success screen. Clear state regardless of
  // whether post-install throws — the 12 numbered steps all succeeded, so a
  // downstream crash must not leave a "resumable" state file behind.
  try {
    await runPostInstall(ctx);
  } finally {
    clearState();
  }
}

main().catch(async (err) => {
  const message = formatFatalError(err);
  console.error('Fatal error:', message);
  // Offer to auto-report the crash so users don't have to hand-copy stack traces.
  // offerErrorReport is best-effort and never throws.
  await offerErrorReport({
    stepName: 'Unhandled exception',
    errorMessage: message,
    loxVersion: LOX_VERSION,
    os: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
  });
  process.exit(1);
});
