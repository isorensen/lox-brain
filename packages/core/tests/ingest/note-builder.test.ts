import { describe, it, expect } from 'vitest';
import { buildNoteFilename, buildNoteContent } from '../../src/ingest/note-builder.js';
import type { NormalizedEvent, GeminiNotes } from '../../src/ingest/types.js';

const base: NormalizedEvent = {
  id: 'evt-1',
  summary: 'Daily meeting',
  start: '2026-07-15T09:00:00-03:00',
  end: '2026-07-15T09:10:00-03:00',
  htmlLink: 'https://calendar.example/evt-1',
  organizerEmail: 'owner@example.com',
  calendarId: 'cal-a',
  calendarLabel: 'Alpha',
  attendees: [
    { email: 'ana@example.com', displayName: 'Ana Lima', responseStatus: 'accepted', organizer: true },
    { email: 'bo@example.com', displayName: 'Bo Reis', responseStatus: 'declined' },
  ],
  attachments: [],
  attendance: 'observer',
};

const notes: GeminiNotes = {
  summary: 'Team aligned on the release cut.',
  nextSteps: ['[Ana Lima] Freeze the branch by Friday'],
  details: ['Release scope was reduced to two items.'],
  docUrls: ['https://docs.example/d/1'],
};

describe('buildNoteFilename', () => {
  it('appends the calendar label to disambiguate across squads', () => {
    expect(buildNoteFilename(base)).toBe('2026-07-15 Daily meeting - Alpha.md');
  });

  it('omits the suffix when the label is empty', () => {
    expect(buildNoteFilename({ ...base, calendarLabel: '' }))
      .toBe('2026-07-15 Daily meeting.md');
  });

  it('replaces filesystem-forbidden characters', () => {
    const e = { ...base, summary: 'Review: API / Dash', calendarLabel: '' };
    expect(buildNoteFilename(e)).toBe('2026-07-15 Review - API - Dash.md');
  });

  it('preserves accents', () => {
    const e = { ...base, summary: 'Retrospectiva Ágil', calendarLabel: '' };
    expect(buildNoteFilename(e)).toBe('2026-07-15 Retrospectiva Ágil.md');
  });
});

describe('buildNoteContent', () => {
  it('marks the note as #child and includes Gemini sections when notes exist', () => {
    const md = buildNoteContent(base, notes);
    expect(md).toContain('Status: #child');
    expect(md).toContain('[calendar_event_id:: evt-1]');
    expect(md).toContain('[attendance:: observer]');
    expect(md).toContain('Team aligned on the release cut.');
    expect(md).toContain('- [ ] Freeze the branch by Friday');
    expect(md).toContain('[responsible:: Ana Lima]');
  });

  it('marks the note as #baby with a callout when notes are absent', () => {
    const md = buildNoteContent(base, null);
    expect(md).toContain('Status: #baby');
    expect(md).toContain('Sem notas automaticas');
  });

  it('never emits YAML frontmatter', () => {
    expect(buildNoteContent(base, notes).startsWith('---')).toBe(false);
  });

  it('renders attendee response status as icons and links them', () => {
    const md = buildNoteContent(base, null);
    expect(md).toContain('[[Ana Lima]] ✅ (organizador)');
    expect(md).toContain('[[Bo Reis]] ❌');
  });
});
