import { describe, it, expect, vi } from 'vitest';
import { decideNote, applyDecision } from '../../src/ingest/vault-writer.js';
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

  it('complements a skeleton once Gemini notes arrive', async () => {
    const read = vi.fn().mockResolvedValue('Status: #baby\n[calendar_event_id:: evt-1]\n');
    const d = await decideNote(read, event, notes, FOLDER);
    expect(d.action).toBe('complement');
    if (d.action === 'complement') expect(d.content).toContain('Status: #child');
  });

  it('skips a skeleton when there are still no notes', async () => {
    const read = vi.fn().mockResolvedValue('Status: #baby\n[calendar_event_id:: evt-1]\n');
    expect((await decideNote(read, event, null, FOLDER)).action).toBe('skip');
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
