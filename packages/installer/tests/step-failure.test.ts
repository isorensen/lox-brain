import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleStepFailure, type StepFailureDeps } from '../src/step-failure.js';
import { offerErrorReport } from '../src/utils/error-report.js';
import { getStatePath } from '../src/state.js';
import type { InstallerContext } from '../src/steps/types.js';

vi.mock('../src/utils/error-report.js', () => ({
  offerErrorReport: vi.fn().mockResolvedValue(undefined),
  extractSubPhase: vi.fn().mockReturnValue(undefined),
  sourceFileForStep: vi.fn().mockReturnValue(undefined),
}));

const DEPS: StepFailureDeps = {
  loxVersion: '9.9.9',
  platform: 'linux',
  arch: 'x64',
  nodeVersion: 'v22.16.0',
};

function makeCtx(): InstallerContext {
  return { config: {}, locale: 'en' };
}

describe('handleStepFailure (#96)', () => {
  let tmp: string;
  let originalHome: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'lox-step-fail-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmp;
    vi.mocked(offerErrorReport).mockClear();
    // process.exit(1) is Promise<never> — throw inside the spy so the await
    // in tests resolves the rejection and assertions can run afterwards.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('__process_exit__');
    }) as never);
    // Silence stderr during tests; we're not asserting on the message print here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('calls offerErrorReport and exits(1) on a non-actionable failure', async () => {
    await expect(
      handleStepFailure('Deploy', 11, 'Something unexpected failed', makeCtx(), false, DEPS),
    ).rejects.toThrow('__process_exit__');
    expect(offerErrorReport).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('SKIPS offerErrorReport on an actionable failure (#96)', async () => {
    // VPN not active, missing prereq, etc. — user can fix and retry.
    // We must not ask them to file a GitHub bug for this.
    await expect(
      handleStepFailure('MCP Server', 12, 'VPN is not active', makeCtx(), true, DEPS),
    ).rejects.toThrow('__process_exit__');
    expect(offerErrorReport).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('still persists state on an actionable failure so resume works', async () => {
    // The user's going to fix the issue and re-run; the resume prompt
    // must offer to continue from this step. State persistence is
    // independent of whether the failure is actionable.
    await expect(
      handleStepFailure('MCP Server', 12, 'VPN is not active', makeCtx(), true, DEPS),
    ).rejects.toThrow('__process_exit__');
    expect(existsSync(getStatePath())).toBe(true);
  });

  it('still persists state on a non-actionable failure', async () => {
    await expect(
      handleStepFailure('Deploy', 11, 'Crashed', makeCtx(), false, DEPS),
    ).rejects.toThrow('__process_exit__');
    expect(existsSync(getStatePath())).toBe(true);
  });

  it('falls back to "Unknown error" when message is undefined', async () => {
    // Fallback to 'Unknown error' when message is undefined — but it's
    // still a reportable crash, not a user-fixable state.
    await expect(
      handleStepFailure('VM Setup', 7, undefined, makeCtx(), false, DEPS),
    ).rejects.toThrow('__process_exit__');
    expect(offerErrorReport).toHaveBeenCalledOnce();
    const call = vi.mocked(offerErrorReport).mock.calls[0]![0];
    expect(call.errorMessage).toBe('Unknown error');
  });
});
