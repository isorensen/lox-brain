import { describe, it, expect } from 'vitest';
import { loadIngestConfig } from '../../src/ingest/config.js';

const valid = {
  calendar_ingest: {
    impersonate_subject: 'capture@example.com',
    service_account: 'sa@proj.iam.gserviceaccount.com',
    notes_folder: '7 - Meeting Notes',
    vault_path: '/tmp/vault',
    organizer_allowlist: ['owner@example.com'],
    note_attachment_patterns: ['anotações do gemini', 'notes by gemini'],
    calendars: [
      { id: 'cal-a', label: 'Alpha' },
      { id: 'cal-b', label: '' },
    ],
  },
};

describe('loadIngestConfig', () => {
  it('parses a valid config', () => {
    const cfg = loadIngestConfig(valid);
    expect(cfg.calendars).toHaveLength(2);
    expect(cfg.calendars[1].label).toBe('');
    expect(cfg.impersonateSubject).toBe('capture@example.com');
  });

  it('defaults attachment patterns when omitted', () => {
    const raw = structuredClone(valid);
    delete (raw.calendar_ingest as Record<string, unknown>).note_attachment_patterns;
    expect(loadIngestConfig(raw).noteAttachmentPatterns).toContain('anotações do gemini');
  });

  it('throws when the calendar_ingest section is missing', () => {
    expect(() => loadIngestConfig({})).toThrow(/calendar_ingest/);
  });

  it('throws when a calendar has no id', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.calendars = [{ id: '', label: 'x' }];
    expect(() => loadIngestConfig(raw)).toThrow(/calendar id/i);
  });

  it('throws when impersonate_subject is missing', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.impersonate_subject = '';
    expect(() => loadIngestConfig(raw)).toThrow(/impersonate_subject/);
  });

  it('defaults notes_folder when omitted', () => {
    const raw = structuredClone(valid);
    delete (raw.calendar_ingest as Record<string, unknown>).notes_folder;
    expect(loadIngestConfig(raw).notesFolder).toBe('7 - Meeting Notes');
  });

  it('defaults organizer_allowlist to an empty array when omitted', () => {
    const raw = structuredClone(valid);
    delete (raw.calendar_ingest as Record<string, unknown>).organizer_allowlist;
    expect(loadIngestConfig(raw).organizerAllowlist).toEqual([]);
  });

  it('defaults calendar label to an empty string when omitted', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.calendars = [{ id: 'cal-a' } as unknown as { id: string; label: string }];
    expect(loadIngestConfig(raw).calendars[0].label).toBe('');
  });

  it('throws when the calendars array is empty', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.calendars = [];
    expect(() => loadIngestConfig(raw)).toThrow(/calendars must not be empty/i);
  });

  it('throws when service_account is missing', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.service_account = '';
    expect(() => loadIngestConfig(raw)).toThrow(/service_account/);
  });

  it('throws when vault_path is missing', () => {
    const raw = structuredClone(valid);
    raw.calendar_ingest.vault_path = '';
    expect(() => loadIngestConfig(raw)).toThrow(/vault_path/);
  });
});
