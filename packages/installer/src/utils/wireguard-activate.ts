import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { shell } from './shell.js';
import { probeTcp } from './net-probe.js';

/**
 * Result of attempting to auto-activate the WireGuard client tunnel.
 *
 * Callers present a user-visible message for each variant. The installer
 * NEVER blocks step 8 on a bad result — steps 9-11 don't need the VPN,
 * and step 12's preflight (#93) re-gates. Auto-activation is purely a
 * UX improvement: the happy path skips a manual activation step; the
 * sad path prints the verbatim command for the user to run themselves.
 *
 * NOTE: strings in `renderActivationResult` are English-only for now.
 * Adjacent installer code (e.g. `step-vpn.ts` progress lines) is also
 * English-literal, so this is consistent. TODO: migrate to `t()` once
 * the rest of the installer UI is fully internationalized.
 */
export type ActivationResult =
  /** VPN was already reachable — nothing to do (e.g. user activated via GUI, or previous run left it up). */
  | { kind: 'already-active' }
  /** Command ran AND post-activate probe confirmed reachability. */
  | { kind: 'activated' }
  /** Windows only: installer not running elevated; user must run `command` from an admin PowerShell. */
  | { kind: 'needs-admin'; command: string }
  /** Activation command exited non-zero. `command` is what the user should run manually. */
  | { kind: 'command-failed'; command: string; error: string }
  /** Activation command succeeded but VPN didn't come up within the probe window. */
  | { kind: 'activated-but-unreachable'; command: string };

/** How long to wait (in total) for a probe to succeed after activation. */
const POST_ACTIVATE_PROBE_WINDOW_MS = 10_000;
/** Interval between probe attempts. */
const PROBE_INTERVAL_MS = 1_000;
/** Initial probe before attempting activation — fast check for "already up". */
const INITIAL_PROBE_TIMEOUT_MS = 2_000;

/**
 * Candidate absolute paths for `wireguard.exe` on Windows, in priority
 * order. Winget-installed WireGuard normally lives under Program Files,
 * but the installer's PATH is snapshotted at process start — if the user
 * just installed WireGuard via winget in the same terminal (or if the
 * installer added the entry as a USER PATH but this process inherited
 * only SYSTEM PATH), `wireguard` may not resolve. Probe known install
 * locations as a fallback so activation still works on fresh machines.
 *
 * Exported for tests.
 */
export const WINDOWS_WIREGUARD_CANDIDATES: readonly string[] = [
  'C:\\Program Files\\WireGuard\\wireguard.exe',
  'C:\\Program Files (x86)\\WireGuard\\wireguard.exe',
];

/**
 * Resolve `wireguard.exe` on Windows. Returns:
 * - `'wireguard'` if the bare command is on PATH (probed via `cmd.exe /c where wireguard`)
 * - an absolute path from `WINDOWS_WIREGUARD_CANDIDATES` if it exists on disk
 * - `null` if neither works — caller should surface a `command-failed` result
 *
 * Exported for tests. Caller is responsible for calling this only on win32.
 */
export async function resolveWireguardExe(
  candidates: readonly string[] = WINDOWS_WIREGUARD_CANDIDATES,
  fsExistsSync: (p: string) => boolean = existsSync,
): Promise<string | null> {
  // 1. Try PATH lookup via `where` — cheapest and honors user PATH edits.
  try {
    const { stdout } = await shell('where', ['wireguard'], { timeout: 3_000 });
    if (stdout.trim().length > 0) return 'wireguard';
  } catch {
    // `where` exits 1 when the command isn't found; fall through to disk probe.
  }
  // 2. Probe known install directories.
  for (const p of candidates) {
    if (fsExistsSync(p)) return p;
  }
  return null;
}

/**
 * Detect whether the current process is running elevated on Windows.
 * `net session` requires admin; any non-zero exit (including ENOENT for
 * non-Windows machines) yields false. Exported for tests.
 */
export async function isWindowsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    await shell('net', ['session'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the platform-appropriate activation command string shown to the
 * user when we can't auto-activate. On Windows we quote the path since
 * `%USERPROFILE%\.config\...` contains a backslash path. Exported for tests.
 */
export function buildActivationCommand(confPath: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `wireguard /installtunnelservice "${confPath}"`;
  }
  return `sudo wg-quick up ${confPath}`;
}

/**
 * Poll `probeTcp` until it succeeds or the window expires. Returns true
 * as soon as the TCP handshake completes; false if the window elapsed.
 *
 * Guarantees at least `PROBE_INTERVAL_MS` pacing between attempts even
 * if probeTcp rejects quickly (ECONNREFUSED can settle in <10ms), which
 * would otherwise spin-loop and burn CPU / fill logs.
 */
async function waitForReachable(host: string, port: number): Promise<boolean> {
  const deadline = Date.now() + POST_ACTIVATE_PROBE_WINDOW_MS;
  while (Date.now() < deadline) {
    const attemptStarted = Date.now();
    if (await probeTcp(host, port, PROBE_INTERVAL_MS)) return true;
    // Pace attempts: if probeTcp returned faster than PROBE_INTERVAL_MS
    // (fast-fail ECONNREFUSED), sleep the remainder before looping.
    const elapsed = Date.now() - attemptStarted;
    const remainingInSlice = PROBE_INTERVAL_MS - elapsed;
    if (remainingInSlice > 0 && Date.now() + remainingInSlice < deadline) {
      await new Promise((r) => setTimeout(r, remainingInSlice));
    }
  }
  return false;
}

/**
 * Run a Windows-specific activation via `wireguard.exe /installtunnelservice`.
 * Requires admin — caller MUST check `isWindowsAdmin()` first.
 */
async function activateWindows(confPath: string): Promise<{ ok: boolean; error?: string }> {
  const exe = await resolveWireguardExe();
  if (exe === null) {
    return {
      ok: false,
      error:
        'WireGuard binary not found. Expected on PATH or under C:\\Program Files\\WireGuard\\wireguard.exe. ' +
        'Install WireGuard (`winget install WireGuard.WireGuard`) and re-run the installer.',
    };
  }
  try {
    await shell(exe, ['/installtunnelservice', confPath], { timeout: 15_000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run `sudo wg-quick up <path>` with inherited stdio so the sudo password
 * prompt is visible to the user. Returns true iff the child exits 0.
 */
function activateUnix(confPath: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Print a hint BEFORE spawning — once sudo takes over the terminal
    // the user sees only "[sudo] password for <user>:" with no context.
    console.log('  Running `sudo wg-quick up` to activate the tunnel (sudo may prompt for your password)...');
    const child = spawn('sudo', ['wg-quick', 'up', confPath], { stdio: 'inherit' });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('exit', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: `sudo wg-quick exited with code ${code}` });
    });
  });
}

/**
 * Attempt to auto-activate the WireGuard client tunnel. Called at the end
 * of step 8 after the client config has been written to disk. Never
 * throws — always returns a classified result the caller can render.
 *
 * Ordering:
 *   1. Fast probe — if VPN is already reachable, return 'already-active'
 *   2. Platform-specific activation command
 *   3. Post-activate probe loop (up to POST_ACTIVATE_PROBE_WINDOW_MS)
 *   4. Return the appropriate result variant
 */
export async function activateWireGuard(
  confPath: string,
  vpnServerIp: string,
): Promise<ActivationResult> {
  // 1. Already active? (idempotent for re-runs + user-imported-via-GUI flow)
  if (await probeTcp(vpnServerIp, 22, INITIAL_PROBE_TIMEOUT_MS)) {
    return { kind: 'already-active' };
  }

  const command = buildActivationCommand(confPath, process.platform);

  // 2. Attempt platform-specific activation
  if (process.platform === 'win32') {
    const admin = await isWindowsAdmin();
    if (!admin) {
      return { kind: 'needs-admin', command };
    }
    const { ok, error } = await activateWindows(confPath);
    if (!ok) {
      return { kind: 'command-failed', command, error: error ?? 'unknown error' };
    }
  } else {
    const { ok, error } = await activateUnix(confPath);
    if (!ok) {
      return { kind: 'command-failed', command, error: error ?? 'unknown error' };
    }
  }

  // 3. Verify the tunnel actually came up
  const reachable = await waitForReachable(vpnServerIp, 22);
  if (!reachable) {
    return { kind: 'activated-but-unreachable', command };
  }
  return { kind: 'activated' };
}

/**
 * Render an `ActivationResult` as a multi-line user-facing message.
 * Exported for tests. Does NOT print — returns lines for the caller
 * to `console.log` with appropriate styling.
 */
export function renderActivationResult(result: ActivationResult, vpnServerIp: string): {
  level: 'success' | 'warning';
  lines: string[];
} {
  switch (result.kind) {
    case 'already-active':
      return {
        level: 'success',
        lines: [`✓ VPN already active (${vpnServerIp}:22 reachable)`],
      };
    case 'activated':
      return {
        level: 'success',
        lines: [`✓ VPN activated (${vpnServerIp}:22 reachable)`],
      };
    case 'needs-admin':
      return {
        level: 'warning',
        lines: [
          '⚠ WireGuard tunnel not activated — the installer is not running as administrator.',
          '  Open a PowerShell as Administrator and run:',
          `    ${result.command}`,
          '  Then re-run the installer (the resume prompt will continue from here).',
        ],
      };
    case 'command-failed':
      return {
        level: 'warning',
        lines: [
          `⚠ Auto-activation failed: ${result.error}`,
          '  Activate the tunnel manually and re-run the installer:',
          `    ${result.command}`,
        ],
      };
    case 'activated-but-unreachable':
      return {
        level: 'warning',
        lines: [
          '⚠ WireGuard command ran, but the VM is still unreachable on the VPN.',
          '  Check the tunnel status (GUI or `wg show`) and verify the server is up.',
          `  Manual fallback: ${result.command}`,
        ],
      };
  }
}
