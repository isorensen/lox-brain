import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { calendar as calendarApi } from '@googleapis/calendar';
import { drive as driveApi } from '@googleapis/drive';
import { loadIngestConfig } from '../ingest/config.js';
import { getAccessToken } from '../ingest/auth.js';
import { listEvents, type FetchPage } from '../ingest/calendar-source.js';
import { fetchNotes, findNoteAttachments, type ExportDoc } from '../ingest/gemini-doc.js';
import {
  decideNote,
  applyDecision,
  type ReadFile,
  type WriteFile,
} from '../ingest/vault-writer.js';
import type { IngestConfig, NoteDecision } from '../ingest/types.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv: string[]): { from: string; to: string; dryRun: boolean } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const day = (flag: string, value: string): string => {
    if (!DAY.test(value)) throw new Error(`${flag} must be a YYYY-MM-DD date, got "${value}"`);
    return value;
  };
  const dryRun = argv.includes('--dry-run');
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
  return { from, to, dryRun };
}

export interface IngestDeps {
  fetchPage: FetchPage;
  exportDoc: ExportDoc;
  readFile: ReadFile;
  writeFile: WriteFile;
}

export interface IngestResult {
  created: number;
  complemented: number;
  skipped: number;
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
): Promise<IngestResult> {
  const result: IngestResult = {
    created: 0,
    complemented: 0,
    skipped: 0,
    inaccessible: [],
    decisions: [],
  };

  for (const calendar of config.calendars) {
    const events = await listEvents(deps.fetchPage, calendar, from, to, config.impersonateSubject);
    for (const event of events) {
      const notes = await fetchNotes(deps.exportDoc, event, config.noteAttachmentPatterns);
      if (!notes && findNoteAttachments(event, config.noteAttachmentPatterns).length > 0) {
        result.inaccessible.push(`${event.start.slice(0, 10)} ${event.summary}`);
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

async function main(): Promise<void> {
  const { from, to, dryRun } = parseArgs(process.argv.slice(2));
  const configPath = join(homedir(), '.lox', 'config.json');
  const config = loadIngestConfig(JSON.parse(await fsReadFile(configPath, 'utf8')));

  const token = await getAccessToken(config.serviceAccount, config.impersonateSubject);
  const cal = calendarApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });
  const drv = driveApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });

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
  const exportDoc: ExportDoc = async (fileId) => {
    const res = await drv.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
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
    const abs = join(config.vaultPath, rel);
    await mkdir(dirname(abs), { recursive: true });
    await fsWriteFile(abs, content, 'utf8');
  };

  const result = await runIngest(
    { fetchPage, exportDoc, readFile, writeFile },
    config,
    from,
    to,
    dryRun,
  );

  for (const decision of result.decisions) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${decision.action.padEnd(11)} ${decision.path}`);
  }

  console.log(
    `\nIngest complete ${from}..${to} — created ${result.created}, ` +
      `complemented ${result.complemented}, skipped ${result.skipped}`,
  );
  if (result.inaccessible.length > 0) {
    console.log(
      `\n${result.inaccessible.length} event(s) had a notes attachment we could not read — ` +
        'the capture account is probably not invited to those series:',
    );
    for (const item of result.inaccessible) console.log(`  - ${item}`);
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
