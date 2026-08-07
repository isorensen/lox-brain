import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { calendar as calendarApi } from '@googleapis/calendar';
import { drive as driveApi } from '@googleapis/drive';
import { loadIngestConfig } from '../ingest/config.js';
import { getAccessToken } from '../ingest/auth.js';
import { listEvents } from '../ingest/calendar-source.js';
import { fetchNotes, findNoteAttachments } from '../ingest/gemini-doc.js';
import { decideNote, applyDecision } from '../ingest/vault-writer.js';

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

async function main(): Promise<void> {
  const { from, to, dryRun } = parseArgs(process.argv.slice(2));
  const configPath = join(homedir(), '.lox', 'config.json');
  const config = loadIngestConfig(JSON.parse(await fsReadFile(configPath, 'utf8')));

  const token = await getAccessToken(config.serviceAccount, config.impersonateSubject);
  const cal = calendarApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });
  const drv = driveApi({ version: 'v3', headers: { Authorization: `Bearer ${token}` } });

  const fetchPage = async (calendarId: string, params: Record<string, string>) => {
    const res = await cal.events.list({ calendarId, ...params } as never);
    return { items: res.data.items ?? [], nextPageToken: res.data.nextPageToken ?? undefined };
  };
  const exportDoc = async (fileId: string): Promise<string> => {
    const res = await drv.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
    return String(res.data);
  };

  const readFile = async (rel: string): Promise<string | null> => {
    try {
      return await fsReadFile(join(config.vaultPath, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const writeFile = async (rel: string, content: string): Promise<void> => {
    const abs = join(config.vaultPath, rel);
    await mkdir(dirname(abs), { recursive: true });
    await fsWriteFile(abs, content, 'utf8');
  };

  const tally = { created: 0, complemented: 0, skipped: 0 };
  const inaccessible: string[] = [];

  for (const calendar of config.calendars) {
    const events = await listEvents(fetchPage, calendar, from, to, config.impersonateSubject);
    for (const event of events) {
      const notes = await fetchNotes(exportDoc, event, config.noteAttachmentPatterns);
      if (!notes && findNoteAttachments(event, config.noteAttachmentPatterns).length > 0) {
        inaccessible.push(`${event.start.slice(0, 10)} ${event.summary}`);
      }
      const decision = await decideNote(readFile, event, notes, config.notesFolder);
      if (!dryRun) await applyDecision(writeFile, decision);

      if (decision.action === 'create') tally.created += 1;
      else if (decision.action === 'complement') tally.complemented += 1;
      else tally.skipped += 1;

      console.log(`${dryRun ? '[dry-run] ' : ''}${decision.action.padEnd(11)} ${decision.path}`);
    }
  }

  console.log(
    `\nIngest complete ${from}..${to} — created ${tally.created}, ` +
      `complemented ${tally.complemented}, skipped ${tally.skipped}`,
  );
  if (inaccessible.length > 0) {
    console.log(
      `\n${inaccessible.length} event(s) had a notes attachment we could not read — ` +
        'the capture account is probably not invited to those series:',
    );
    for (const item of inaccessible) console.log(`  - ${item}`);
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
