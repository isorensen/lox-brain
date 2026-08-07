import { describe, it, expect, vi } from 'vitest';
import { runIngest } from '../../src/scripts/ingest-calendar.js';
import { createTokenResolver } from '../../src/ingest/token-resolver.js';
import { buildNoteContent } from '../../src/ingest/note-builder.js';
import type { IngestConfig } from '../../src/ingest/types.js';

const FOLDER = 'Meetings';

const config: IngestConfig = {
  impersonateSubject: 'capture@example.com',
  serviceAccount: 'ingest@example.iam.gserviceaccount.com',
  notesFolder: FOLDER,
  vaultPath: '/vault',
  organizerAllowlist: [],
  noteAttachmentPatterns: ['notes by gemini'],
  calendars: [
    { id: 'cal-a', label: 'Alpha' },
    { id: 'cal-b', label: 'Beta' },
  ],
};

const geminiDoc = { title: 'Notes by Gemini', fileUrl: 'https://docs.example/d/doc-ok' };
const brokenDoc = { title: 'Notes by Gemini', fileUrl: 'https://docs.example/d/doc-denied' };
const slideDeck = { title: 'Quarterly deck.pdf', fileUrl: 'https://docs.example/d/deck' };

function rawEvent(id: string, summary: string, attachments: unknown[] = []) {
  return {
    id,
    summary,
    htmlLink: `https://calendar.example/${id}`,
    start: { dateTime: '2026-07-15T09:00:00-03:00' },
    end: { dateTime: '2026-07-15T10:00:00-03:00' },
    organizer: { email: 'owner@example.com' },
    attendees: [{ email: 'capture@example.com', responseStatus: 'accepted' }],
    attachments,
  };
}

function pathFor(summary: string, label: string): string {
  return `${FOLDER}/2026-07-15 ${summary} - ${label}.md`;
}

/** A vault fake: `files` seeds existing notes, keyed by the path decideNote will ask for. */
function vault(files: Record<string, string> = {}) {
  const writeFile = vi.fn(async (path: string, content: string) => {
    files[path] = content;
  });
  const readFile = vi.fn(async (path: string) => files[path] ?? null);
  return { readFile, writeFile, files };
}

function calendars(byCalendar: Record<string, unknown[]>) {
  return vi.fn(async (calendarId: string) => ({ items: byCalendar[calendarId] ?? [] }));
}

const exportDoc = vi.fn(async (fileId: string) => {
  if (fileId === 'doc-denied') throw new Error('403 caller does not have permission');
  return '### Resumo\nWe agreed on the plan.\n';
});

const resolver = createTokenResolver(config, vi.fn(async () => 'tok'));
const exportDocAs = () => exportDoc;

/** Built by the real generator so it stays recognizable to vault-writer's untouched check. */
const skeleton = (id: string) =>
  buildNoteContent(
    {
      id,
      summary: 'Weekly',
      start: '2026-07-15T09:00:00-03:00',
      end: '2026-07-15T10:00:00-03:00',
      htmlLink: `https://calendar.example/${id}`,
      organizerEmail: 'owner@example.com',
      calendarId: 'cal-a',
      calendarLabel: 'Alpha',
      attendees: [],
      attachments: [],
      attendance: 'accepted',
    },
    null,
  );
const enriched = (id: string) => `Status: #child\n[calendar_event_id:: ${id}]\n`;

describe('runIngest', () => {
  it('iterates every configured calendar', async () => {
    const fetchPage = calendars({
      'cal-a': [rawEvent('evt-a', 'Planning')],
      'cal-b': [rawEvent('evt-b', 'Retro')],
    });
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(2);
    expect(result.decisions.map((d) => d.path)).toEqual([
      pathFor('Planning', 'Alpha'),
      pathFor('Retro', 'Beta'),
    ]);
  });

  it('passes the window and the capture account down to the calendar query', async () => {
    const fetchPage = calendars({ 'cal-a': [] });
    const { readFile, writeFile } = vault();

    await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(fetchPage).toHaveBeenCalledWith(
      'cal-a',
      expect.objectContaining({ timeMin: '2026-07-01T00:00:00Z', timeMax: '2026-08-01T00:00:00Z' }),
    );
  });

  it('writes the note when the run is live', async () => {
    const fetchPage = calendars({ 'cal-a': [rawEvent('evt-a', 'Planning')] });
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      pathFor('Planning', 'Alpha'),
      expect.stringContaining('Reuniao: Planning'),
    );
    expect(result.created).toBe(1);
  });

  it('suppresses the write on a dry run but still reports what would happen', async () => {
    const fetchPage = calendars({ 'cal-a': [rawEvent('evt-a', 'Planning')] });
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      true,
    );

    expect(writeFile).not.toHaveBeenCalled();
    expect(result.created).toBe(1);
    expect(result.decisions[0]).toMatchObject({
      action: 'create',
      path: pathFor('Planning', 'Alpha'),
    });
  });

  it('buckets create, complement and skip into the tally', async () => {
    const fetchPage = calendars({
      'cal-a': [
        rawEvent('evt-new', 'Kickoff'),
        rawEvent('evt-old', 'Weekly', [geminiDoc]),
        rawEvent('evt-done', 'Review'),
      ],
    });
    const { readFile, writeFile } = vault({
      [pathFor('Weekly', 'Alpha')]: skeleton('evt-old'),
      [pathFor('Review', 'Alpha')]: enriched('evt-done'),
    });

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(result).toMatchObject({ created: 1, complemented: 1, skipped: 1 });
    expect(result.decisions.map((d) => d.action)).toEqual(['create', 'complement', 'skip']);
    // The skipped note must not be rewritten.
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it('reports an event whose notes Doc cannot be exported, without aborting the run', async () => {
    const fetchPage = calendars({
      'cal-a': [rawEvent('evt-denied', 'Squad sync', [brokenDoc]), rawEvent('evt-after', 'Later')],
    });
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(result.inaccessible).toEqual([
      '2026-07-15 Squad sync — 403 caller does not have permission',
    ]);
    // It still becomes a skeleton note, and the following event is still processed.
    expect(result.created).toBe(2);
    expect(writeFile).toHaveBeenCalledWith(
      pathFor('Squad sync', 'Alpha'),
      expect.stringContaining('Status: #baby'),
    );
  });

  it('names a delegation failure differently from a Drive permission failure', async () => {
    // Production mints the token inside the export closure, so a broken domain-wide
    // delegation surfaces through the same catch as a Drive 403.
    const broken = createTokenResolver(
      config,
      vi.fn(async () => {
        throw new Error('unauthorized_client: Client is unauthorized to retrieve access tokens');
      }),
    );
    const mintingExportDocAs = (subject: string) => async (fileId: string) => {
      await broken.tokenFor(subject);
      return exportDoc(fileId);
    };

    const authVault = vault();
    const authRun = await runIngest(
      {
        fetchPage: calendars({ 'cal-a': [rawEvent('evt-1', 'Weekly', [geminiDoc])] }),
        resolver: broken,
        exportDocAs: mintingExportDocAs,
        readFile: authVault.readFile,
        writeFile: authVault.writeFile,
      },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    const driveVault = vault();
    const driveRun = await runIngest(
      {
        fetchPage: calendars({ 'cal-a': [rawEvent('evt-1', 'Weekly', [brokenDoc])] }),
        resolver,
        exportDocAs,
        readFile: driveVault.readFile,
        writeFile: driveVault.writeFile,
      },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(authRun.inaccessible[0]).toContain('unauthorized_client');
    expect(driveRun.inaccessible[0]).toContain('403 caller does not have permission');
    expect(authRun.inaccessible[0]).not.toEqual(driveRun.inaccessible[0]);
  });

  it('reports a notes attachment that is not a Docs url, without inventing a cause', async () => {
    const notADoc = { title: 'Notes by Gemini', fileUrl: 'https://example.com/attachment' };
    const fetchPage = calendars({ 'cal-a': [rawEvent('evt-odd', 'Weekly', [notADoc])] });
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(result.inaccessible).toEqual(['2026-07-15 Weekly — no exportable notes Doc']);
  });

  it('does not report an event whose only attachment is not a notes Doc', async () => {
    const fetchPage = calendars({ 'cal-a': [rawEvent('evt-deck', 'All hands', [slideDeck])] });
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(result.inaccessible).toEqual([]);
    expect(result.created).toBe(1);
  });

  it('returns an empty result when no calendar has events in the window', async () => {
    const fetchPage = calendars({});
    const { readFile, writeFile } = vault();

    const result = await runIngest(
      { fetchPage, resolver, exportDocAs, readFile, writeFile },
      config,
      '2026-07-01',
      '2026-08-01',
      false,
    );

    expect(result).toEqual({
      created: 0,
      complemented: 0,
      skipped: 0,
      inaccessible: [],
      decisions: [],
    });
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('runIngest organizer fallback', () => {
  /** A historical Doc: only the organizer was an invitee, so only they can export it. */
  function historicalDrive() {
    const asked: string[] = [];
    const exportDocAs = (subject: string) => async (): Promise<string> => {
      asked.push(subject);
      if (subject !== 'owner@example.com') throw new Error('403 caller does not have permission');
      return '### Resumo\nWe agreed on the plan.\n';
    };
    return { asked, exportDocAs };
  }

  function backfillRun(organizerAllowlist: string[]) {
    const backfill: IngestConfig = { ...config, organizerAllowlist };
    const { asked, exportDocAs } = historicalDrive();
    const fetchPage = calendars({ 'cal-a': [rawEvent('evt-old', 'Weekly', [geminiDoc])] });
    const { readFile, writeFile } = vault();
    const resolve = createTokenResolver(backfill, vi.fn(async () => 'tok'));

    const run = runIngest(
      { fetchPage, resolver: resolve, exportDocAs, readFile, writeFile },
      backfill,
      '2026-07-01',
      '2026-08-01',
      false,
    );
    return { run, asked, writeFile };
  }

  it('recovers the notes by impersonating an allowlisted organizer', async () => {
    const { run, asked, writeFile } = backfillRun(['owner@example.com']);
    const result = await run;

    expect(asked).toEqual(['capture@example.com', 'owner@example.com']);
    expect(result.inaccessible).toEqual([]);
    expect(writeFile).toHaveBeenCalledWith(
      pathFor('Weekly', 'Alpha'),
      expect.stringContaining('Status: #child'),
    );
  });

  it('never impersonates an organizer outside the allowlist', async () => {
    const { run, asked, writeFile } = backfillRun([]);
    const result = await run;

    expect(asked).toEqual(['capture@example.com']);
    expect(result.inaccessible).toEqual([
      '2026-07-15 Weekly — 403 caller does not have permission',
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      pathFor('Weekly', 'Alpha'),
      expect.stringContaining('Status: #baby'),
    );
  });
});
