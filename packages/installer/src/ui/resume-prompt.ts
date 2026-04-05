import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { STEPS } from '../steps/registry.js';
import type { InstallerState } from '../state.js';

/**
 * User's resume decision: either 'restart' (discard state), or a
 * 1-based step number to start from.
 */
export type ResumeDecision = 'restart' | number;

/**
 * Default target step when the user picks "continue": resume at the
 * failed step if there was one, otherwise at the step immediately after
 * the last completed one. Clamped to the 1..12 range.
 */
export function defaultResumeStep(state: InstallerState): number {
  const candidate = state.failed_step ?? state.last_completed_step + 1;
  if (candidate < 1) return 1;
  const max = STEPS[STEPS.length - 1]!.num;
  if (candidate > max) return max;
  return candidate;
}

/** User-facing label for a step number, e.g. "Step 7 (VM Setup)". Exported so
 * callers outside this module render the same format as the prompt. */
export function stepLabel(num: number): string {
  const entry = STEPS.find((s) => s.num === num);
  return entry ? `Step ${num} (${entry.name})` : `Step ${num}`;
}

/**
 * Map the user's raw `select` answer to a `ResumeDecision`. Extracted as a
 * pure function so the branching logic is unit-testable without mocking
 * `@inquirer/prompts`.
 */
export function resolveResumeDecision(
  choice: 'continue' | 'pick' | 'restart',
  picked: number | undefined,
  defaultStep: number,
): ResumeDecision {
  if (choice === 'restart') return 'restart';
  if (choice === 'continue') return defaultStep;
  // `pick` path: caller must have supplied a step number from the second prompt.
  if (picked === undefined) {
    throw new Error('resolveResumeDecision: picked step is required when choice is "pick"');
  }
  return picked;
}

/**
 * Render a human-readable summary of the saved state. Exported for tests.
 */
export function renderResumeSummary(state: InstallerState): string[] {
  const strings = t();
  const lines = [
    chalk.bold(`  ${strings.resume_found_title}`),
    `  ${strings.resume_found_subtitle}`,
    '',
    `  ${strings.resume_last_completed}: ${state.last_completed_step === 0 ? '—' : stepLabel(state.last_completed_step)}`,
  ];
  if (state.failed_step !== null) {
    lines.push(`  ${strings.resume_failed_at}: ${stepLabel(state.failed_step)}`);
  }
  // Include lox_version so the user can tell when saved state came from a
  // different release than the installer they're currently running (#92).
  // "(Lox vX.Y.Z)" is an untranslated product-version token on purpose —
  // the product name and SemVer format are the same in every locale.
  lines.push(`  ${strings.resume_saved_at}: ${state.timestamp} (Lox v${state.lox_version})`);
  return lines;
}

/**
 * Ask the user how to handle a saved installer state. Returns either
 * 'restart' (discard state, run from step 1) or a 1-based step number.
 */
export async function promptResume(state: InstallerState): Promise<ResumeDecision> {
  const { select } = await import('@inquirer/prompts');
  const strings = t();
  for (const line of renderResumeSummary(state)) console.log(line);
  console.log('');

  const defaultStep = defaultResumeStep(state);
  const choice = await select<'continue' | 'pick' | 'restart'>({
    message: strings.resume_prompt,
    default: 'continue',
    choices: [
      { name: `${strings.resume_option_continue} (${stepLabel(defaultStep)})`, value: 'continue' },
      { name: strings.resume_option_pick_step, value: 'pick' },
      { name: strings.resume_option_restart, value: 'restart' },
    ],
  });

  let picked: number | undefined;
  if (choice === 'pick') {
    picked = await select<number>({
      message: strings.resume_pick_step_prompt,
      default: defaultStep,
      choices: STEPS.map((s) => ({ name: stepLabel(s.num), value: s.num })),
    });
  }
  return resolveResumeDecision(choice, picked, defaultStep);
}
