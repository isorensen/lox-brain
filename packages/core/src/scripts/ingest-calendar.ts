import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { calendar as calendarApi } from '@googleapis/calendar';
import { drive as driveApi } from '@googleapis/drive';
import { loadIngestConfig } from '../ingest/config.js';
import { getAccessToken } from '../ingest/auth.js';
import { listEvents, type FetchPage } from '../ingest/calendar-source.js';
import { fetchNotes, findNoteAttachments, type ExportDoc } from '../ingest/gemini-doc.js';
import { createTokenResolver, type TokenResolver } from '../ingest/token-resolver.js';
import {
  decideNote,
  applyDecision,
  type ReadFile,
  type WriteFile,
} from '../ingest/vault-writer.js';
import type { GeminiNotes, IngestConfig, NoteDecision } from '../ingest/types.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(
  argv: string[],
): { from: string; to: string; dryRun: boolean; onlyWithNotes: boolean } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const day = (flag: string, value: string): string => {
    if (!DAY.test(value)) throw new Error(`${flag} must be a YYYY-MM-DD date, got "${value}"`);
    return value;
  };
  const dryRun = argv.includes('--dry-run');
  const onlyWithNotes = argv.includes('--only-with-notes');
  const rawFrom = get('--from') ?? get('--since');
  if (!rawFrom) {
    throw new Error('provide --from <YYYY-MM-DD> --to <YYYY-MM-DD>, or --since <YYYY-MM-DD>');
  }
  const from = day('--from', rawFrom);

  const rawTo = get('--to');
  let to: string;
  if (rawTo) {
    to = day('--to', rawTo);
  } else {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    to = tomorrow.toISOString().slice(0, 10);
  }
  if (to <= from) throw new Error('--from must be before --to (the window is [from, to))');
  return { from, to, dryRun, onlyWithNotes };
}

export interface IngestDeps {
  fetchPage: FetchPage;
  resolver: TokenResolver;
  /** Doc export bound to a subject, so a past event can be read as its organizer. */
  exportDocAs: (subject: string) => ExportDoc;
  readFile: ReadFile;
  writeFile: WriteFile;
}

export interface IngestResult {
  created: number;
  complemented: number;
  skipped: number;
  /** Events with no Gemini notes that were passed over under --only-with-notes. */
  skippedNoNotes: number;
  /** Events whose notes attachment could not be exported, as "YYYY-MM-DD Summary". */
  inaccessible: string[];
  decisions: NoteDecision[];
}

export async function runIngest(
  deps: IngestDeps,
  config: IngestConfig,
  from: string,
  to: string,
  dryRun: boolean,
  onlyWithNotes = false,
): Promise<IngestResult> {
  const result: IngestResult = {
    created: 0,
    complemented: 0,
    skipped: 0,
    skippedNoNotes: 0,
    inaccessible: [],
    decisions: [],
  };

  for (const calendar of config.calendars) {
    const events = await listEvents(deps.fetchPage, calendar, from, to, config.impersonateSubject);
    for (const event of events) {
      let notes: GeminiNotes | null = null;
      const failures: string[] = [];
      for (const subject of deps.resolver.subjectsFor(event)) {
        const attempt = await fetchNotes(
          deps.exportDocAs(subject),
          event,
          config.noteAttachmentPatterns,
        );
        failures.push(...attempt.errors);
        if (attempt.notes) {
          notes = attempt.notes;
          break;
        }
      }
      if (!notes && findNoteAttachments(event, config.noteAttachmentPatterns).length > 0) {
        const why = [...new Set(failures)].join('; ') || 'no exportable notes Doc';
        result.inaccessible.push(`${event.start.slice(0, 10)} ${event.summary} — ${why}`);
      }

      if (onlyWithNotes && !notes) {
        result.skippedNoNotes += 1;
        continue;
      }

      const decision = await decideNote(deps.readFile, event, notes, config.notesFolder);
      if (!dryRun) await applyDecision(deps.writeFile, decision);

      if (decision.action === 'create') result.created += 1;
      else if (decision.action === 'complement') result.complemented += 1;
      else result.skipped += 1;

      result.decisions.push(decision);
    }
  }

  return result;
}

/**
 * Prove the vault is writable before spending any API call on a run whose every write would
 * fail — and whose decision log would be lost with the throw. A recursive mkdir is not enough
 * on its own: it resolves for a directory that already exists, so it would pass on every run
 * but the first, and it would silently create a vault that is merely unmounted.
 */
export async function assertVaultWritable(config: IngestConfig): Promise<void> {
  await stat(config.vaultPath);
  const folder = join(config.vaultPath, config.notesFolder);
  await mkdir(folder, { recursive: true });
  // Dotfile so the vault watcher ignores it; pid-suffixed so a backfill overlapping the
  // timer cannot unlink the other run's probe.
  const probe = join(folder, `.lox-write-probe-${process.pid}`);
  await fsWriteFile(probe, '', 'utf8');
  await unlink(probe);
}

async function main(): Promise<void> {
  const { from, to, dryRun, onlyWithNotes } = parseArgs(process.argv.slice(2));
  const configPath = join(homedir(), '.lox', 'config.json');
  const config = loadIngestConfig(JSON.parse(await fsReadFile(configPath, 'utf8')));

  await assertVaultWritable(config);

  const resolver = createTokenResolver(config, (subject) =>
    getAccessToken(config.serviceAccount, subject),
  );

  // Calendar read access comes from the calendar's own sharing, not from meeting
  // attendance, so the capture account is enough here.
  const token = await resolver.tokenFor(config.impersonateSubject);
  const cal = calendarApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });

  const fetchPage: FetchPage = async (calendarId, params) => {
    const res = await cal.events.list({
      calendarId,
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      orderBy: params.orderBy,
      singleEvents: params.singleEvents === 'true',
      maxResults: Number(params.maxResults),
      pageToken: params.pageToken,
    });
    return { items: res.data.items ?? [], nextPageToken: res.data.nextPageToken ?? undefined };
  };
  const exportDocAs =
    (subject: string): ExportDoc =>
    async (fileId) => {
      const drv = driveApi({
        version: 'v3',
        headers: { Authorization: `Bearer ${await resolver.tokenFor(subject)}` },
      });
      const res = await drv.files.export(
        { fileId, mimeType: 'text/plain' },
        { responseType: 'text' },
      );
      return String(res.data);
    };

  const readFile: ReadFile = async (rel) => {
    try {
      return await fsReadFile(join(config.vaultPath, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const writeFile: WriteFile = async (rel, content) => {
    await fsWriteFile(join(config.vaultPath, rel), content, 'utf8');
  };

  const result = await runIngest(
    { fetchPage, resolver, exportDocAs, readFile, writeFile },
    config,
    from,
    to,
    dryRun,
    onlyWithNotes,
  );

  for (const decision of result.decisions) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${decision.action.padEnd(11)} ${decision.path}`);
  }

  console.log(
    `\nIngest complete ${from}..${to} — created ${result.created}, ` +
      `complemented ${result.complemented}, skipped ${result.skipped}` +
      (onlyWithNotes ? `, skipped-no-notes ${result.skippedNoNotes}` : ''),
  );
  if (result.inaccessible.length > 0) {
    console.log(`\n${result.inaccessible.length} event(s) had a notes attachment we could not read:`);
    for (const item of result.inaccessible) console.log(`  - ${item}`);
    console.log(
      '\nA permission error (403/404) usually means the impersonated account was not ' +
        'invited to that series. An auth error (unauthorized_client, invalid_grant, ' +
        'SERVICE_DISABLED) means the delegation setup is wrong — see docs/calendar-ingest.md.',
    );
  }
}

// Only run when invoked directly, so tests can import parseArgs.
if (
  process.argv[1]?.endsWith('ingest-calendar.ts') ||
  process.argv[1]?.endsWith('ingest-calendar.js')
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
