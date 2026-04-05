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
  // Use DOMAIN\USERNAME format so icacls resolves the principal on
  // BOTH domain-joined machines (USERDOMAIN = domain name) and
  // workgroup machines (USERDOMAIN = computer name) (#113).
  //
  // Bare `USERNAME` fails SILENTLY on domain-joined boxes: icacls
  // can't resolve bare `alice` to the full domain account
  // `CORPNET\alice` (different SID), reports "successfully
  // processed 1 file", but the ACE is never written.
  // The user then loses read access to their own SSH key and
  // OpenSSH rejects with `Load key "...": Permission denied`.
  //
  // USERDOMAIN is always set on Windows (standard Microsoft-populated
  // env var) — fall back to bare USERNAME only if it's missing,
  // which is the pre-#113 behavior for non-standard environments.
  const userDomain = process.env.USERDOMAIN?.trim();
  const principal = userDomain ? `${userDomain}\\${username}` : username;
  //
  // Three-step hardening (#101 follow-up):
  //   1. `/inheritance:r` — strip INHERITED ACEs from the parent dir
  //   2. `/remove` the common loose principals as EXPLICIT ACEs — step 1
  //      only touches inherited ones, but CREATOR OWNER / BUILTIN\Users
  //      frequently end up as explicit ACEs on files Windows creates
  //      inside %USERPROFILE%\.ssh. OpenSSH rejects the key file if ANY
  //      of these principals has access, so `/inheritance:r` alone is
  //      not enough (seen on Windows 11, pt-BR locale, Lox v0.6.7).
  //   3. `/grant:r user:F` — grant only the current user Full control.
  //
  // Each call is independent so a failure on one removal (e.g. the
  // principal wasn't present) doesn't abort the rest.
  const loosePrincipals = [
    'CREATOR OWNER',
    'BUILTIN\\Users',
    'Authenticated Users',
    'Everyone',
  ];
  try {
    await shell('icacls', [targetPath, '/inheritance:r']);
  } catch { /* best-effort */ }
  for (const principal of loosePrincipals) {
    try {
      await shell('icacls', [targetPath, '/remove', principal]);
    } catch { /* principal may not be on this ACL */ }
  }
  try {
    await shell('icacls', [targetPath, '/grant:r', `${principal}:(F)`]);
  } catch {
    // Surfaced by the downstream operation if it still fails.
  }
}
