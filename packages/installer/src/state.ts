import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import type { InstallerContext } from './steps/types.js';

/**
 * Persisted installer state, used to resume a partial installation.
 *
 * Saved after each successful step and after a step failure. Cleared when
 * post-install completes successfully. Intentionally separate from the
 * final `~/.lox/config.json` because it may exist mid-install (before
 * config.json is written) and contains installer-only fields.
 *
 * Schema version is bumped whenever the shape changes so old state files
 * from a previous Lox version are rejected instead of silently misread.
 */
export interface InstallerState {
  schema_version: number;
  /** Last step whose `StepResult.success === true`. 0 means only language ran. */
  last_completed_step: number;
  /** Step that raised or returned success=false. null if the last run succeeded. */
  failed_step: number | null;
  /** ISO 8601 timestamp of when this state was written. */
  timestamp: string;
  /** Lox version that produced this state — state is rejected on version mismatch. */
  lox_version: string;
  /** Serialized installer context, minus any transient fields. */
  ctx: InstallerContext;
}

export const STATE_SCHEMA_VERSION = 1;

export function getStatePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error('Cannot determine home directory: HOME and USERPROFILE are both unset');
  }
  return `${home}/.lox/installer-state.json`;
}

/**
 * Persist installer state atomically. Creates `~/.lox/` if missing. File
 * mode is 0600 so DB passwords or other ctx fields aren't world-readable.
 */
export function saveState(
  ctx: InstallerContext,
  lastCompletedStep: number,
  failedStep: number | null,
  loxVersion: string,
): void {
  const statePath = getStatePath();
  const stateDir = path.dirname(statePath);
  // `recursive: true` is a no-op when the dir exists, so no existsSync
  // probe is needed (avoids a TOCTOU race). Mode 0700 so a snooping user
  // cannot even enumerate the file's presence.
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const state: InstallerState = {
    schema_version: STATE_SCHEMA_VERSION,
    last_completed_step: lastCompletedStep,
    failed_step: failedStep,
    timestamp: new Date().toISOString(),
    lox_version: loxVersion,
    ctx,
  };
  // Write + chmod separately — writeFileSync's `mode` is only applied on
  // file creation, not on overwrite, so an existing 0644 file would stay
  // world-readable on re-save.
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  try { chmodSync(statePath, 0o600); } catch { /* best-effort on Windows */ }
}

/**
 * Load and validate installer state. Returns null if the file is missing,
 * unreadable, malformed, or belongs to a different schema/version.
 */
export function loadState(expectedLoxVersion: string): InstallerState | null {
  const statePath = getStatePath();
  if (!existsSync(statePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(statePath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isInstallerState(parsed)) return null;
  if (parsed.schema_version !== STATE_SCHEMA_VERSION) return null;
  if (parsed.lox_version !== expectedLoxVersion) return null;
  return parsed;
}

/** Delete the state file. Safe to call when the file does not exist. */
export function clearState(): void {
  const statePath = getStatePath();
  if (existsSync(statePath)) {
    try { unlinkSync(statePath); } catch { /* best-effort */ }
  }
}

function isInstallerState(value: unknown): value is InstallerState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schema_version === 'number'
    && typeof v.last_completed_step === 'number'
    && (v.failed_step === null || typeof v.failed_step === 'number')
    && typeof v.timestamp === 'string'
    && typeof v.lox_version === 'string'
    && typeof v.ctx === 'object'
    && v.ctx !== null
  );
}
