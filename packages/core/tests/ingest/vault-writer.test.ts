import { describe, it, expect, vi } from 'vitest';
import { decideNote, applyDecision } from '../../src/ingest/vault-writer.js';
import { buildNoteContent } from '../../src/ingest/note-builder.js';
import type { NormalizedEvent, GeminiNotes } from '../../src/ingest/types.js';

const event: NormalizedEvent = {
  id: 'evt-1',
  summary: 'Daily meeting',
  start: '2026-07-15T09:00:00-03:00',
  end: '2026-07-15T09:10:00-03:00',
  htmlLink: 'https://calendar.example/evt-1',
  organizerEmail: 'owner@example.com',
  calendarId: 'cal-a',
  calendarLabel: 'Alpha',
  attendees: [],
  attachments: [],
  attendance: 'observer',
};

const notes: GeminiNotes = { summary: 'ok', nextSteps: [], details: ['d'], docUrls: ['u'] };
const FOLDER = '7 - Meeting Notes';

/**
 * What the pipeline itself writes for an event with no Gemini notes yet — built by the real
 * generator, so the guard cannot drift away from the template it is supposed to recognize.
 */
const skeleton = (id: string, imported = '2026-07-15') =>
  buildNoteContent({ ...event, id }, null, imported);

describe('decideNote', () => {
  it('creates when no note exists at the canonical path', async () => {
    const read = vi.fn().mockResolvedValue(null);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('create');
    expect(d.path).toBe('7 - Meeting Notes/2026-07-15 Daily meeting - Alpha.md');
  });

  it('skips when an enriched note for the same event already exists', async () => {
    const read = vi.fn().mockResolvedValue('Status: #child\n[calendar_event_id:: evt-1]\n');
    expect((await decideNote(read, event, notes, FOLDER)).action).toBe('skip');
  });

  // Round trip: real generator output fed straight back into the guard. This is what pins
  // note-builder's template to vault-writer's notion of "untouched".
  it('complements a skeleton the generator itself produced, once Gemini notes arrive', async () => {
    const read = vi.fn().mockResolvedValue(buildNoteContent(event, null));
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('complement');
    if (d.action === 'complement') expect(d.content).toContain('Status: #child');
  });

  it('keeps the original import date when complementing', async () => {
    const read = vi.fn().mockResolvedValue(skeleton('evt-1', '2025-11-02'));
    const d = await decideNote(read, event, notes, FOLDER);
    if (d.action === 'complement') expect(d.content).toContain('[imported:: 2025-11-02]');
    else expect.fail(`expected complement, got ${d.action}`);
  });

  it('skips a skeleton the user typed into below the callout, as the callout instructs', async () => {
    const edited = skeleton('evt-1').replace(
      'manualmente abaixo.\n',
      'manualmente abaixo.\n\nDecidimos adiar o corte da release para a proxima sprint.\n',
    );
    expect(edited).toContain('Sem notas automaticas');

    const read = vi.fn().mockResolvedValue(edited);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('skeleton was edited by hand');

    const write = vi.fn();
    await applyDecision(write, d);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips a skeleton whose callout the user replaced with their own notes', async () => {
    const edited = skeleton('evt-1').replace(
      /> \[!NOTE\][\s\S]*?abaixo\./,
      'Decidimos adiar o corte da release para a proxima sprint.',
    );
    const read = vi.fn().mockResolvedValue(edited);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('skeleton was edited by hand');
  });

  it('skips a #baby note that has no topics section at all', async () => {
    const read = vi.fn().mockResolvedValue('Status: #baby\n[calendar_event_id:: evt-1]\n');
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('skeleton was edited by hand');
  });

  it('does not treat a Gemini body mentioning the status marker as a skeleton', async () => {
    const enriched = [
      'Status: #child',
      '[calendar_event_id:: evt-1]',
      '- Combinamos escrever "Status: #baby" nas notas de reuniao novas.',
    ].join('\n');
    const read = vi.fn().mockResolvedValue(enriched);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('already enriched');
  });

  it('skips a skeleton when there are still no notes', async () => {
    const read = vi.fn().mockResolvedValue(skeleton('evt-1'));
    const d = await decideNote(read, event, null, FOLDER);
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('skeleton, no notes yet');
  });

  it('disambiguates with a time suffix when a different event owns the path', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('Status: #child\n[calendar_event_id:: other]\n')
      .mockResolvedValueOnce(null);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('create');
    expect(d.path).toContain('(09-00)');
  });

  it('skips with an unresolved collision reason when the time-suffixed path is also taken by another event', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('Status: #child\n[calendar_event_id:: other-1]\n')
      .mockResolvedValueOnce('Status: #baby\n[calendar_event_id:: other-2]\n');
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('skip');
    if (d.action === 'skip') expect(d.reason).toBe('unresolved collision');

    const write = vi.fn();
    await applyDecision(write, d);
    expect(write).not.toHaveBeenCalled();
  });

  it('disambiguates when the canonical path holds a hand-authored note with no calendar_event_id', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('# Hand-authored note with no dataview fields\n')
      .mockResolvedValueOnce(null);
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('create');
    expect(d.path).toContain('(09-00)');
  });
});

describe('applyDecision', () => {
  it('writes for create and complement', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    await applyDecision(write, { action: 'create', path: 'p', content: 'c' });
    expect(write).toHaveBeenCalledWith('p', 'c');
  });

  it('does not write for skip', async () => {
    const write = vi.fn();
    await applyDecision(write, { action: 'skip', path: 'p', reason: 'exists' });
    expect(write).not.toHaveBeenCalled();
  });
});
