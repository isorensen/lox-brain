import { describe, it, expect, vi } from 'vitest';
import { listEvents } from '../../src/ingest/calendar-source.js';

const cal = { id: 'cal-a', label: 'Alpha' };

function page(items: unknown[], nextPageToken?: string) {
  return { items, nextPageToken };
}

const rawEvent = {
  id: 'evt-1',
  summary: 'Daily meeting',
  htmlLink: 'https://calendar.example/evt-1',
  start: { dateTime: '2026-07-15T09:00:00-03:00' },
  end: { dateTime: '2026-07-15T09:10:00-03:00' },
  organizer: { email: 'owner@example.com' },
  creator: { email: 'creator@example.com' },
  attendees: [{ email: 'ana@example.com', responseStatus: 'accepted' }],
  attachments: [{ title: 'Anotações do Gemini', fileUrl: 'https://docs.example/d/1' }],
};

describe('listEvents', () => {
  it('normalizes an event and attaches the calendar label', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([rawEvent]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.id).toBe('evt-1');
    expect(event.calendarLabel).toBe('Alpha');
    expect(event.attachments[0].fileUrl).toBe('https://docs.example/d/1');
  });

  it('normalizes the organizer and creator as separate identities', async () => {
    // On a shared calendar `organizer` is the calendar itself; only `creator` names a person.
    const ceremony = { ...rawEvent, organizer: { email: 'c_abc123@group.calendar.google.com' } };
    const fetchPage = vi.fn().mockResolvedValue(page([ceremony]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.organizerEmail).toBe('c_abc123@group.calendar.google.com');
    expect(event.creatorEmail).toBe('creator@example.com');
  });

  it('marks attendance as observer when the capture account is not an attendee', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([rawEvent]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('observer');
  });

  it('uses the capture account response status when it is invited', async () => {
    const invited = {
      ...rawEvent,
      attendees: [...rawEvent.attendees, { email: 'capture@example.com', responseStatus: 'declined' }],
    };
    const fetchPage = vi.fn().mockResolvedValue(page([invited]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('declined');
  });

  it('follows pagination until no token remains', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([rawEvent], 'tok'))
      .mockResolvedValueOnce(page([{ ...rawEvent, id: 'evt-2' }]));
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('skips cancelled events and all-day entries without attendees', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      page([
        { ...rawEvent, id: 'c1', status: 'cancelled' },
        { id: 'allday', summary: 'Feriado', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } },
        rawEvent,
      ]),
    );
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(events.map((e) => e.id)).toEqual(['evt-1']);
  });

  it('maps a needsAction response status to none', async () => {
    const invited = {
      ...rawEvent,
      attendees: [...rawEvent.attendees, { email: 'capture@example.com', responseStatus: 'needsAction' }],
    };
    const fetchPage = vi.fn().mockResolvedValue(page([invited]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('none');
  });

  it('defaults attendance to none when the capture account has no response status', async () => {
    const invited = {
      ...rawEvent,
      attendees: [...rawEvent.attendees, { email: 'capture@example.com' }],
    };
    const fetchPage = vi.fn().mockResolvedValue(page([invited]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('none');
  });

  it('treats a page with no items as empty', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: undefined, nextPageToken: undefined });
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(events).toEqual([]);
  });

  it('applies field defaults for a sparsely populated all-day event with attendees', async () => {
    const sparse = {
      id: 'allday-2',
      start: { date: '2026-07-15' },
      end: { date: '2026-07-16' },
      attendees: [{ email: 'ana@example.com', responseStatus: 'accepted' }],
    };
    const fetchPage = vi.fn().mockResolvedValue(page([sparse]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.summary).toBe('Sem titulo');
    expect(event.htmlLink).toBe('');
    expect(event.organizerEmail).toBe('');
    expect(event.creatorEmail).toBe('');
    expect(event.attachments).toEqual([]);
    expect(event.start).toBe('2026-07-15T00:00:00');
    expect(event.end).toBe('2026-07-16T00:00:00');
  });

  it('breaks pagination instead of looping forever when the token does not advance', async () => {
    const CALL_LIMIT = 10;
    let calls = 0;
    const fetchPage = vi.fn(async () => {
      calls += 1;
      if (calls > CALL_LIMIT) throw new Error(`fetchPage exceeded ${CALL_LIMIT} calls — pagination guard regressed`);
      return page([rawEvent], 'stuck-tok');
    });
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    // The stuck token is only detected after the second identical page is fetched,
    // so two calls happen before the guard breaks the loop.
    expect(calls).toBe(2);
    expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-1']);
  });

  it('matches the capture account against attendees case-insensitively', async () => {
    const invited = {
      ...rawEvent,
      attendees: [...rawEvent.attendees, { email: 'Capture@Example.com', responseStatus: 'declined' }],
    };
    const fetchPage = vi.fn().mockResolvedValue(page([invited]));
    const [event] = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(event.attendance).toBe('declined');
  });

  it('retains a timed event with no attendees', async () => {
    const solo = { ...rawEvent, id: 'solo-1', attendees: [] };
    const fetchPage = vi.fn().mockResolvedValue(page([solo]));
    const events = await listEvents(fetchPage, cal, '2026-07-01', '2026-08-01', 'capture@example.com');
    expect(events.map((e) => e.id)).toEqual(['solo-1']);
  });
});
