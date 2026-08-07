import type { IngestConfig } from './types.js';

const DEFAULT_PATTERNS = ['anotações do gemini', 'anotacoes do gemini', 'notes by gemini'];

function str(section: Record<string, unknown>, key: string, required = true): string {
  const value = section[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (required) throw new Error(`calendar_ingest.${key} is required`);
  return '';
}

export function loadIngestConfig(raw: unknown): IngestConfig {
  const root = (raw ?? {}) as Record<string, unknown>;
  const section = root.calendar_ingest as Record<string, unknown> | undefined;
  if (!section) throw new Error('calendar_ingest section is missing from config');

  const calendarsRaw = Array.isArray(section.calendars) ? section.calendars : [];
  if (calendarsRaw.length === 0) throw new Error('calendar_ingest.calendars must not be empty');

  const calendars = calendarsRaw.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) throw new Error('every calendar entry needs a non-empty calendar id');
    return { id, label: typeof item.label === 'string' ? item.label : '' };
  });

  const patterns = Array.isArray(section.note_attachment_patterns)
    ? (section.note_attachment_patterns as string[])
    : DEFAULT_PATTERNS;

  return {
    impersonateSubject: str(section, 'impersonate_subject'),
    serviceAccount: str(section, 'service_account'),
    notesFolder: str(section, 'notes_folder', false) || '7 - Meeting Notes',
    vaultPath: str(section, 'vault_path'),
    organizerAllowlist: Array.isArray(section.organizer_allowlist)
      ? (section.organizer_allowlist as string[])
      : [],
    noteAttachmentPatterns: patterns.map((p) => p.toLowerCase()),
    calendars,
  };
}
