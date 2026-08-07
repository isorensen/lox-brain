import type { CalendarConfig, NormalizedEvent, EventAttendee } from './types.js';

export interface RawPage {
  items?: unknown[];
  nextPageToken?: string;
}

export type FetchPage = (calendarId: string, params: Record<string, string>) => Promise<RawPage>;

function resolveAttendance(attendees: EventAttendee[], captureAccount: string): string {
  const self = attendees.find((a) => a.email?.toLowerCase() === captureAccount.toLowerCase());
  if (!self) return 'observer';
  return self.responseStatus === 'needsAction' ? 'none' : (self.responseStatus ?? 'none');
}

export async function listEvents(
  fetchPage: FetchPage,
  calendar: CalendarConfig,
  from: string,
  to: string,
  captureAccount: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      timeMin: `${from}T00:00:00Z`,
      timeMax: `${to}T00:00:00Z`,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    };
    if (pageToken) params.pageToken = pageToken;

    const page = await fetchPage(calendar.id, params);
    for (const item of page.items ?? []) {
      const raw = item as Record<string, any>;
      if (raw.status === 'cancelled') continue;

      const attendees: EventAttendee[] = Array.isArray(raw.attendees) ? raw.attendees : [];
      const startDateTime = raw.start?.dateTime;
      // All-day entries have `date` instead of `dateTime`; keep them only when someone was invited.
      if (!startDateTime && attendees.length === 0) continue;

      events.push({
        id: String(raw.id),
        summary: String(raw.summary ?? 'Sem titulo'),
        start: startDateTime ?? `${raw.start?.date}T00:00:00`,
        end: raw.end?.dateTime ?? `${raw.end?.date}T00:00:00`,
        htmlLink: String(raw.htmlLink ?? ''),
        organizerEmail: String(raw.organizer?.email ?? ''),
        calendarId: calendar.id,
        calendarLabel: calendar.label,
        attendees,
        attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
        attendance: resolveAttendance(attendees, captureAccount),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return events;
}
