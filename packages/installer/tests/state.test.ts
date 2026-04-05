import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  saveState,
  loadState,
  clearState,
  getStatePath,
  STATE_SCHEMA_VERSION,
} from '../src/state.js';
import type { InstallerContext } from '../src/steps/types.js';

const FAKE_VERSION = '0.4.6';

function makeCtx(): InstallerContext {
  return {
    config: { mode: 'personal' },
    locale: 'en',
    gcpProjectId: 'demo-project',
    gcpUsername: 'demo',
    vmUser: 'demo_example_com',
    vmHome: '/home/demo_example_com',
  };
}

describe('installer state persistence', () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'lox-state-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmp;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('getStatePath throws when HOME and USERPROFILE are both unset', () => {
    const originalUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    try {
      expect(() => getStatePath()).toThrow(/Cannot determine home directory/);
    } finally {
      if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('getStatePath resolves to ~/.lox/installer-state.json', () => {
    // getStatePath() appends `/.lox/installer-state.json` via template
    // literal (Node accepts forward slashes on Windows too), so the
    // expected path keeps HOME's native separators but uses `/` for the
    // appended tail. Do NOT use path.join here — it would normalize to
    // `\` on Windows and the comparison would fail.
    expect(getStatePath()).toBe(`${tmp}/.lox/installer-state.json`);
  });

  it('saveState creates ~/.lox/ if missing and round-trips with loadState', () => {
    const ctx = makeCtx();
    saveState(ctx, 5, null, FAKE_VERSION);
    const loaded = loadState(FAKE_VERSION);
    expect(loaded).not.toBeNull();
    expect(loaded!.schema_version).toBe(STATE_SCHEMA_VERSION);
    expect(loaded!.last_completed_step).toBe(5);
    expect(loaded!.failed_step).toBeNull();
    expect(loaded!.lox_version).toBe(FAKE_VERSION);
    expect(loaded!.ctx.vmUser).toBe('demo_example_com');
    expect(loaded!.ctx.vmHome).toBe('/home/demo_example_com');
  });

  it('saveState writes with mode 0600', () => {
    if (process.platform === 'win32') return; // mode bits are advisory on Windows
    saveState(makeCtx(), 3, 4, FAKE_VERSION);
    const mode = statSync(getStatePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('saveState re-applies 0600 even when the file already existed with wider perms', () => {
    if (process.platform === 'win32') return;
    // First write creates the file, then loosen perms externally.
    saveState(makeCtx(), 1, null, FAKE_VERSION);
    chmodSync(getStatePath(), 0o644);
    // Second write must tighten it back — writeFileSync ignores mode on overwrite.
    saveState(makeCtx(), 2, null, FAKE_VERSION);
    const mode = statSync(getStatePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('loadState returns null when the file does not exist', () => {
    expect(loadState(FAKE_VERSION)).toBeNull();
  });

  it('loadState returns null for malformed JSON', () => {
    const statePath = getStatePath();
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, '{ not valid json');
    expect(loadState(FAKE_VERSION)).toBeNull();
  });

  it('loadState rejects state from a different lox_version', () => {
    saveState(makeCtx(), 1, null, '0.4.5');
    expect(loadState('0.4.6')).toBeNull();
  });

  it('loadState rejects state with a stale schema_version', () => {
    const statePath = getStatePath();
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      schema_version: 999,
      last_completed_step: 3,
      failed_step: null,
      timestamp: '2026-04-05T00:00:00Z',
      lox_version: FAKE_VERSION,
      ctx: makeCtx(),
    }));
    expect(loadState(FAKE_VERSION)).toBeNull();
  });

  it('loadState rejects state with missing required fields', () => {
    const statePath = getStatePath();
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ schema_version: 1 }));
    expect(loadState(FAKE_VERSION)).toBeNull();
  });

  it('clearState removes the file and is a no-op when already absent', () => {
    saveState(makeCtx(), 1, null, FAKE_VERSION);
    expect(existsSync(getStatePath())).toBe(true);
    clearState();
    expect(existsSync(getStatePath())).toBe(false);
    // Second call is safe.
    expect(() => clearState()).not.toThrow();
  });

  it('saveState records failed_step when a step errored', () => {
    saveState(makeCtx(), 10, 11, FAKE_VERSION);
    const loaded = loadState(FAKE_VERSION);
    expect(loaded!.last_completed_step).toBe(10);
    expect(loaded!.failed_step).toBe(11);
  });

  it('persists vmUser and vmHome so the next run can skip SSH probe', () => {
    saveState(makeCtx(), 11, 12, FAKE_VERSION);
    const loaded = loadState(FAKE_VERSION);
    // These fields carry the fix from #79 across runs so step-mcp
    // does not reprobe identity when resuming.
    expect(loaded!.ctx.vmUser).toBe('demo_example_com');
    expect(loaded!.ctx.vmHome).toBe('/home/demo_example_com');
  });

  it('does not lose config values on round-trip', () => {
    const ctx = makeCtx();
    ctx.config.gcp = { project: 'p', region: 'r', zone: 'z', vm_name: 'v', service_account: 'sa' };
    saveState(ctx, 6, null, FAKE_VERSION);
    const loaded = loadState(FAKE_VERSION);
    expect(loaded!.ctx.config.gcp).toEqual(ctx.config.gcp);
  });

  it('timestamp is a parseable ISO 8601 string', () => {
    saveState(makeCtx(), 1, null, FAKE_VERSION);
    const loaded = loadState(FAKE_VERSION);
    expect(Number.isNaN(Date.parse(loaded!.timestamp))).toBe(false);
  });

  it('written file is valid JSON (readable without loadState)', () => {
    saveState(makeCtx(), 1, null, FAKE_VERSION);
    const raw = readFileSync(getStatePath(), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
