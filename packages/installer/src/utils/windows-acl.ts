import { shell } from './shell.js';

/**
 * On Windows, strip inherited NTFS ACEs from `targetPath` and grant
 * only the current user Full control, via the built-in `icacls` tool.
 * No-op on non-Windows platforms. Best-effort: swallows errors so a
 * partial fix does not block the calling operation.
 *
 * Why this exists:
 * - Files created under `%USERPROFILE%` inherit ACEs from the parent
 *   (e.g. the "Owner Rights" SID S-1-3-4). POSIX `chmod 0600` is a
 *   near-no-op on Windows — it only maps loosely to mode bits and
 *   leaves NTFS ACLs untouched.
 * - OpenSSH rejects config/key files with inherited ACEs (#83).
 * - Temporary files containing secrets (e.g. the OpenAI API key passed
 *   to `gcloud secrets versions add --data-file=<tmp>`) sit in
 *   `%TEMP%` with inherited ACEs until deleted, leaving a short
 *   read window for other users on the same machine (#84).
 */
export async function fixWindowsAcl(targetPath: string): Promise<void> {
  if (process.platform !== 'win32') return;
  // `||` instead of `??` — an empty-string USERNAME must also fall
  // through (some CI / restricted shells set it blank, which would
  // otherwise produce a syntactically invalid `:F` principal).
  const username = (process.env.USERNAME?.trim() || process.env.USER?.trim());
  if (!username) return;
  // NOTE: For domain users, icacls resolves the bare name to the
  // domain account if no local account exists. Explicit DOMAIN\user
  // is unnecessary for the typical single-user install scenario.
  try {
    await shell('icacls', [targetPath, '/inheritance:r', '/grant:r', `${username}:F`]);
  } catch {
    // Surfaced by the downstream operation if it still fails.
  }
}
