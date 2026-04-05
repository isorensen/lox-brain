import { saveState } from './state.js';
import { offerErrorReport, extractSubPhase, sourceFileForStep } from './utils/error-report.js';
import type { InstallerContext } from './steps/types.js';

/**
 * Dependencies injected by the main installer loop. Extracted so the
 * failure-handling logic can be unit-tested without driving the full
 * installer flow.
 */
export interface StepFailureDeps {
  loxVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
}

/**
 * Handle a step failure: persist state for the resume feature, print the
 * guidance message, optionally offer to auto-report the failure to GitHub,
 * and exit. User-actionable failures (`actionable: true`) skip the report
 * prompt since they aren't installer bugs — just states the user can fix
 * and retry (see #96).
 */
export async function handleStepFailure(
  stepName: string,
  stepNum: number,
  message: string | undefined,
  ctx: InstallerContext,
  actionable: boolean,
  deps: StepFailureDeps,
): Promise<never> {
  // Persist state so the user can resume from this step on the next run.
  // stepNum-1 is the last COMPLETED step (the step that just failed is
  // `stepNum`, so everything before it finished). The resume prompt uses
  // `failed_step = stepNum` to default the continue-from selection back
  // to this exact step.
  try {
    saveState(ctx, stepNum - 1, stepNum, deps.loxVersion);
  } catch {
    // Non-fatal: state write is a convenience, not a correctness requirement.
  }
  console.error(`\n${message ?? 'Unknown error'}`);
  if (!actionable) {
    await offerErrorReport({
      stepName,
      errorMessage: message ?? 'Unknown error',
      subPhase: extractSubPhase(message ?? ''),
      sourceFile: sourceFileForStep(stepName),
      loxVersion: deps.loxVersion,
      os: `${deps.platform} ${deps.arch}`,
      nodeVersion: deps.nodeVersion,
    });
  }
  process.exit(1);
}
