import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultResumeStep,
  renderResumeSummary,
  resolveResumeDecision,
  stepLabel,
} from '../../src/ui/resume-prompt.js';
import { setLocale } from '../../src/i18n/index.js';
import type { InstallerState } from '../../src/state.js';

// i18n is a module singleton — pin the locale so assertions on English
// strings are stable even when other test files ran pt-br first.
beforeEach(() => setLocale('en'));

function makeState(partial: Partial<InstallerState>): InstallerState {
  return {
    schema_version: 1,
    last_completed_step: 0,
    failed_step: null,
    timestamp: '2026-04-05T12:00:00.000Z',
    lox_version: '0.4.6',
    ctx: { config: {}, locale: 'en' },
    ...partial,
  };
}

describe('defaultResumeStep', () => {
  it('picks the failed step when one is recorded', () => {
    expect(defaultResumeStep(makeState({ last_completed_step: 10, failed_step: 11 }))).toBe(11);
  });

  it('picks last_completed + 1 when there is no failed step', () => {
    expect(defaultResumeStep(makeState({ last_completed_step: 5, failed_step: null }))).toBe(6);
  });

  it('clamps to 1 when state has no completed steps', () => {
    expect(defaultResumeStep(makeState({ last_completed_step: 0, failed_step: null }))).toBe(1);
  });

  it('clamps to the last step when state goes past the end', () => {
    expect(defaultResumeStep(makeState({ last_completed_step: 99, failed_step: null }))).toBe(12);
  });

  it('prefers failed_step over last_completed + 1 even when they differ', () => {
    // Failed step 3 after completing 7 (unusual, but possible if the user
    // picked an earlier step on a previous resume and it then failed).
    expect(defaultResumeStep(makeState({ last_completed_step: 7, failed_step: 3 }))).toBe(3);
  });
});

describe('renderResumeSummary', () => {
  it('includes the timestamp and last completed step', () => {
    const out = renderResumeSummary(makeState({ last_completed_step: 4 })).join('\n');
    expect(out).toContain('2026-04-05T12:00:00.000Z');
    expect(out).toContain('Step 4');
  });

  it('shows a dash when no step has been completed', () => {
    const out = renderResumeSummary(makeState({ last_completed_step: 0 })).join('\n');
    // En-dash character used for empty state.
    expect(out).toContain('—');
  });

  it('surfaces the failed step when one is recorded', () => {
    const out = renderResumeSummary(makeState({ last_completed_step: 10, failed_step: 11 })).join('\n');
    expect(out).toContain('Step 11');
  });

  it('includes the lox_version so the user sees when state is cross-release', () => {
    // After #92 state is no longer version-gated; surfacing the version
    // in the summary lets the user notice 0.5.0 state loaded into 0.6.x.
    const out = renderResumeSummary(makeState({ lox_version: '0.5.0' })).join('\n');
    expect(out).toContain('Lox v0.5.0');
  });

  it('omits the "failed at" line when there is no failure', () => {
    const out = renderResumeSummary(makeState({ last_completed_step: 5, failed_step: null })).join('\n');
    // English label — the test runs with default locale 'en'.
    expect(out).not.toMatch(/Failed at step/);
  });
});

describe('stepLabel', () => {
  it('formats known step numbers as "Step N (Name)"', () => {
    expect(stepLabel(1)).toBe('Step 1 (Prerequisites)');
    expect(stepLabel(11)).toBe('Step 11 (Deploy)');
    expect(stepLabel(12)).toBe('Step 12 (MCP Server)');
  });

  it('falls back to just the number for unknown indices', () => {
    expect(stepLabel(99)).toBe('Step 99');
    expect(stepLabel(0)).toBe('Step 0');
  });
});

describe('resolveResumeDecision', () => {
  it('returns "restart" when choice is restart (ignores picked/default)', () => {
    expect(resolveResumeDecision('restart', 5, 7)).toBe('restart');
    expect(resolveResumeDecision('restart', undefined, 1)).toBe('restart');
  });

  it('returns the default step when choice is continue', () => {
    expect(resolveResumeDecision('continue', undefined, 6)).toBe(6);
    // Even if picked was supplied, continue wins — it is the explicit choice.
    expect(resolveResumeDecision('continue', 3, 6)).toBe(6);
  });

  it('returns the picked step when choice is pick', () => {
    expect(resolveResumeDecision('pick', 4, 7)).toBe(4);
  });

  it('throws when choice is "pick" but no step was picked', () => {
    expect(() => resolveResumeDecision('pick', undefined, 7)).toThrow(
      /picked step is required/,
    );
  });
});
