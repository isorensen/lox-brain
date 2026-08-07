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

  it('falls back to a placeholder title when summary is empty', () => {
    expect(buildNoteFilename({ ...base, summary: '' }))
      .toBe('2026-07-15 Sem titulo - Alpha.md');
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

  it('stamps today as the import date, or the caller-supplied one', () => {
    expect(buildNoteContent(base, notes)).toContain(
      `[imported:: ${new Date().toISOString().slice(0, 10)}]`,
    );
    expect(buildNoteContent(base, notes, '2025-11-02')).toContain('[imported:: 2025-11-02]');
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

  it('renders a placeholder when there are no attendees', () => {
    const md = buildNoteContent({ ...base, attendees: [] }, null);
    expect(md).toContain('_Sem participantes registrados._');
  });

  it('derives a display name from the email local-part when displayName is missing', () => {
    const e = {
      ...base,
      attendees: [{ email: 'carlos.gomes@example.com', responseStatus: 'accepted' }],
    };
    const md = buildNoteContent(e, null);
    expect(md).toContain('[[carlos gomes]] ✅');
  });

  it('falls back to the pending icon when responseStatus is missing, and uses the question mark for tentative', () => {
    const e = {
      ...base,
      attendees: [
        { email: 'xena@example.com', displayName: 'Xena Silva', responseStatus: 'tentative' },
        { email: 'yara@example.com', displayName: 'Yara Melo' },
      ],
    };
    const md = buildNoteContent(e, null);
    expect(md).toContain('[[Xena Silva]] ❓');
    expect(md).toContain('[[Yara Melo]] ⏳');
  });

  it('renders a next step verbatim, with no responsible field, when it has no [Name] marker', () => {
    const notesNoMarker: GeminiNotes = {
      summary: 'x',
      nextSteps: ['Just do it'],
      details: [],
      docUrls: [],
    };
    const md = buildNoteContent(base, notesNoMarker);
    expect(md).toContain('- [ ] Just do it');
    expect(md).not.toContain('[responsible::');
  });

  it('omits the squad tag when the calendar label is empty', () => {
    const md = buildNoteContent({ ...base, calendarLabel: '' }, null);
    const tagsLine = md.split('\n').find((line) => line.startsWith('Tags:'));
    expect(tagsLine).toBe('Tags: [[meeting]]');
  });
});
