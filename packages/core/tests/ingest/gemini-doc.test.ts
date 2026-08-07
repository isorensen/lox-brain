import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findNoteAttachments,
  extractFileId,
  parseGeminiDoc,
  fetchNotes,
} from '../../src/ingest/gemini-doc.js';
import type { NormalizedEvent } from '../../src/ingest/types.js';

const PATTERNS = ['anotações do gemini', 'notes by gemini'];
const fixture = readFileSync(join(__dirname, '../fixtures/gemini-notes-ptbr.txt'), 'utf8');

const event = {
  id: 'evt-1',
  attachments: [
    { title: 'Planilha de Acompanhamento', fileUrl: 'https://docs.example/spreadsheets/d/x/edit' },
    { title: 'Anotações do Gemini', fileUrl: 'https://docs.example/document/d/doc1/edit' },
  ],
} as unknown as NormalizedEvent;

describe('findNoteAttachments', () => {
  it('matches by case-insensitive substring, not exact title', () => {
    const e = {
      attachments: [
        { title: 'Sprint Review - 2025/07/01 16:27 GMT-03:00 - Anotações do Gemini', fileUrl: 'u1' },
      ],
    } as unknown as NormalizedEvent;
    expect(findNoteAttachments(e, PATTERNS)).toHaveLength(1);
  });

  it('matches the English variant', () => {
    const e = { attachments: [{ title: 'Notes by Gemini', fileUrl: 'u1' }] } as unknown as NormalizedEvent;
    expect(findNoteAttachments(e, PATTERNS)).toHaveLength(1);
  });

  it('ignores unrelated attachments', () => {
    expect(findNoteAttachments(event, PATTERNS)).toHaveLength(1);
  });

  it('returns every notes doc when an event carries several', () => {
    const e = {
      attachments: [
        { title: 'Anotações do Gemini', fileUrl: 'u1' },
        { title: 'Anotações do Gemini', fileUrl: 'u2' },
      ],
    } as unknown as NormalizedEvent;
    expect(findNoteAttachments(e, PATTERNS)).toHaveLength(2);
  });
});

describe('extractFileId', () => {
  it('pulls the id out of a Docs URL', () => {
    expect(extractFileId('https://docs.example/document/d/abc123/edit?usp=x')).toBe('abc123');
  });

  it('returns null for an unrecognized URL', () => {
    expect(extractFileId('https://example.com/nope')).toBeNull();
  });
});

describe('parseGeminiDoc', () => {
  it('extracts the summary', () => {
    expect(parseGeminiDoc(fixture).summary).toContain('Equipe alinhou o corte da release');
  });

  it('extracts next steps preserving the responsible marker', () => {
    const { nextSteps } = parseGeminiDoc(fixture);
    expect(nextSteps).toHaveLength(2);
    expect(nextSteps[0]).toMatch(/^\[Ana Lima\]/);
  });

  it('extracts detail bullets', () => {
    expect(parseGeminiDoc(fixture).details.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty sections for unparseable text without throwing', () => {
    const parsed = parseGeminiDoc('conteudo sem estrutura');
    expect(parsed.nextSteps).toEqual([]);
    expect(parsed.details).toEqual([]);
  });
});

describe('fetchNotes', () => {
  const twoDocs = {
    attachments: [
      { title: 'Anotações do Gemini', fileUrl: 'https://docs.example/document/d/d1/edit' },
      { title: 'Anotações do Gemini', fileUrl: 'https://docs.example/document/d/d2/edit' },
    ],
  } as unknown as NormalizedEvent;

  it('returns null when the event has no notes attachment', async () => {
    const e = { attachments: [] } as unknown as NormalizedEvent;
    expect(await fetchNotes(vi.fn(), e, PATTERNS)).toEqual({ notes: null, errors: [] });
  });

  it('concatenates details from multiple docs and keeps every url', async () => {
    const exportDoc = vi.fn().mockResolvedValue(fixture);
    const { notes } = await fetchNotes(exportDoc, twoDocs, PATTERNS);
    expect(exportDoc).toHaveBeenCalledTimes(2);
    expect(notes?.docUrls).toHaveLength(2);
    expect(notes?.details.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the readable doc when a sibling doc on the same event fails', async () => {
    const exportDoc = vi
      .fn()
      .mockRejectedValueOnce(new Error('403 caller does not have permission'))
      .mockResolvedValueOnce(fixture);
    const { notes, errors } = await fetchNotes(exportDoc, twoDocs, PATTERNS);

    expect(notes).not.toBeNull();
    expect(notes?.summary).toContain('Equipe alinhou o corte da release');
    expect(notes?.docUrls).toEqual(['https://docs.example/document/d/d2/edit']);
    expect(errors).toEqual(['403 caller does not have permission']);
  });

  it('returns null when every export fails, so the caller writes a skeleton', async () => {
    const exportDoc = vi.fn().mockRejectedValue(new Error('403'));
    expect(await fetchNotes(exportDoc, event, PATTERNS)).toEqual({ notes: null, errors: ['403'] });
  });

  it('reports the failure reason so auth breakage is not read as a missing invite', async () => {
    const exportDoc = vi.fn().mockRejectedValue(new Error('unauthorized_client'));
    const { errors } = await fetchNotes(exportDoc, event, PATTERNS);
    expect(errors).toEqual(['unauthorized_client']);
  });
});
