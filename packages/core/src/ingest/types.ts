export interface CalendarConfig {
  id: string;
  /** Filename suffix used to disambiguate ceremonies across squads. Empty = no suffix. */
  label: string;
}

export interface IngestConfig {
  impersonateSubject: string;
  serviceAccount: string;
  notesFolder: string;
  vaultPath: string;
  /** Accounts the backfill may impersonate as event organizers. */
  organizerAllowlist: string[];
  /** Lowercase substrings that identify a Gemini notes attachment. */
  noteAttachmentPatterns: string[];
  calendars: CalendarConfig[];
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
}

export interface EventAttachment {
  title: string;
  fileUrl: string;
}

export interface NormalizedEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  organizerEmail: string;
  calendarId: string;
  calendarLabel: string;
  attendees: EventAttendee[];
  attachments: EventAttachment[];
  /** Response status of the capture account, or 'observer' when not invited. */
  attendance: string;
}

export interface GeminiNotes {
  summary: string;
  nextSteps: string[];
  details: string[];
  docUrls: string[];
}

export type NoteDecision =
  | { action: 'create'; path: string; content: string }
  | { action: 'complement'; path: string; content: string }
  | { action: 'skip'; path: string; reason: string };
