import chalk from 'chalk';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { shell } from './shell.js';
import { fixWindowsAcl } from './windows-acl.js';
import { t } from '../i18n/index.js';

/** GCP Secret Manager secret ID used by this installer. */
export const OPENAI_SECRET_NAME = 'openai-api-key';

/**
 * Validate that a string looks like an OpenAI API key. Accepts:
 *   - sk-<48+ chars>           (legacy format)
 *   - sk-proj-<48+ chars>      (project-scoped keys)
 *   - sk-svcacct-<48+ chars>   (service account keys)
 *   - sk-admin-<48+ chars>     (admin keys)
 *
 * OpenAI has changed key formats several times, so we do a lightweight
 * sanity check (prefix + minimum length) rather than a strict regex
 * that would break on the next rotation. Returns a human-readable
 * reason string if the key is clearly invalid, or null if it looks OK.
 */
export function validateOpenAiKeyFormat(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return 'key is empty';
  if (!trimmed.startsWith('sk-')) return 'key must start with "sk-"';
  if (trimmed.length < 40) return `key is too short (${trimmed.length} chars, expected 40+)`;
  if (/\s/.test(trimmed)) return 'key contains whitespace';
  return null;
}

/**
 * Check whether the `openai-api-key` secret already exists in Secret
 * Manager for the given project. Returns true if present, false if not,
 * and throws on any other gcloud error so the caller can surface it.
 */
export async function openAiSecretExists(projectId: string): Promise<boolean> {
  try {
    await shell('gcloud', [
      'secrets', 'describe', OPENAI_SECRET_NAME,
      '--project', projectId,
      '--format', 'value(name)',
    ]);
    return true;
  } catch (err: unknown) {
    // gcloud's `secrets describe` exits 1 and emits "NOT_FOUND" on stderr
    // when the secret does not exist — that is the documented CLI
    // contract, so we parse the message rather than the exit code.
    // Surface any other failure so the user sees auth / network / project
    // errors promptly (PERMISSION_DENIED, PROJECT_NOT_FOUND, etc.).
    const msg = err instanceof Error ? err.message : String(err);
    if (/NOT_FOUND/i.test(msg)) return false;
    throw err;
  }
}

/**
 * Fetch the latest version of the `openai-api-key` secret. Throws if the
 * secret does not exist or access is denied.
 */
export async function fetchOpenAiKey(projectId: string): Promise<string> {
  const { stdout } = await shell('gcloud', [
    'secrets', 'versions', 'access', 'latest',
    '--secret', OPENAI_SECRET_NAME,
    '--project', projectId,
  ]);
  return stdout.trim();
}

/**
 * Upload a key as a new version of the `openai-api-key` secret. Creates
 * the secret if it does not exist. The key is written to a temp file
 * with mode 0600 because `gcloud secrets versions add` reads from
 * --data-file (passing via --data-file=- + stdin would require shell
 * piping, which we explicitly avoid on Windows).
 */
export async function uploadOpenAiKey(projectId: string, key: string): Promise<void> {
  // Create the secret if it doesn't exist (best-effort — may already exist).
  try {
    await shell('gcloud', [
      'secrets', 'create', OPENAI_SECRET_NAME,
      '--replication-policy=automatic',
      '--project', projectId,
    ]);
  } catch {
    // Secret may already exist — fall through to add a version.
  }

  const tmpFile = join(tmpdir(), `lox-openai-${crypto.randomBytes(8).toString('hex')}`);
  writeFileSync(tmpFile, key, { mode: 0o600 });
  // Windows: writeFileSync's `mode` does not tighten NTFS ACLs, so the
  // temp file inherits %TEMP% permissions and can briefly be read by
  // other users on the same machine. Strip inheritance now (best-effort,
  // but the tmp file is deleted in finally within ~1s regardless).
  await fixWindowsAcl(tmpFile);
  try {
    await shell('gcloud', [
      'secrets', 'versions', 'add', OPENAI_SECRET_NAME,
      `--data-file=${tmpFile}`,
      '--project', projectId,
    ]);
  } finally {
    unlinkSync(tmpFile);
  }
}

/** Result of the interactive prompt flow. `null` = user chose to skip. */
export type OpenAiKeyResult = { key: string; source: 'new' | 'reused' } | { key: null; source: 'skipped' };

/**
 * Interactive prompt flow for resolving an OpenAI API key:
 *   1. If the secret already exists, offer to reuse / replace / skip.
 *   2. Otherwise, explain + show the dashboard link + prompt with
 *      masked input, then validate format, then upload to Secret Manager.
 *
 * Returns the resolved key (and source tag) or `{ key: null }` if the
 * user skipped. The caller is responsible for embedding the key into
 * `/etc/lox/secrets.env` on the VM.
 */
export async function promptForOpenAiKey(projectId: string): Promise<OpenAiKeyResult> {
  const { password, select } = await import('@inquirer/prompts');
  const strings = t();

  const exists = await openAiSecretExists(projectId);

  if (exists) {
    const choice = await select<'reuse' | 'replace' | 'skip'>({
      message: strings.openai_existing_prompt,
      default: 'reuse',
      choices: [
        { name: strings.openai_option_reuse, value: 'reuse' },
        { name: strings.openai_option_replace, value: 'replace' },
        { name: strings.openai_option_skip, value: 'skip' },
      ],
    });
    if (choice === 'skip') return { key: null, source: 'skipped' };
    if (choice === 'reuse') {
      const key = await fetchOpenAiKey(projectId);
      return { key, source: 'reused' };
    }
    // fall through to 'replace' → re-prompt new key
  } else {
    console.log(chalk.bold(`\n  ${strings.openai_explain_title}`));
    console.log(`  ${strings.openai_explain_body}`);
    console.log(chalk.cyan('  https://platform.openai.com/api-keys\n'));
  }

  // Prompt + validate loop. After 5 consecutive invalid attempts, ASK
  // whether to keep trying or skip — do not silently force-skip, the
  // user may just be pasting from a clipboard manager that appends
  // whitespace or a UI that adds quotes.
  const { confirm } = await import('@inquirer/prompts');
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rawKey: string = await password({
      message: strings.openai_paste_prompt,
      mask: '*',
    });
    const trimmedKey = rawKey.trim();
    const reason = validateOpenAiKeyFormat(trimmedKey);
    if (reason === null) {
      await uploadOpenAiKey(projectId, trimmedKey);
      return { key: trimmedKey, source: 'new' };
    }
    console.log(chalk.yellow(`  ⚠ ${strings.openai_invalid_format}: ${reason}`));
    attempt++;
    if (attempt >= 5) {
      const keepTrying = await confirm({
        message: strings.openai_keep_trying_prompt,
        default: true,
      });
      if (!keepTrying) {
        console.log(chalk.yellow(`  ${strings.openai_skipping_after_retries}`));
        return { key: null, source: 'skipped' };
      }
      attempt = 0;
    }
  }
}
