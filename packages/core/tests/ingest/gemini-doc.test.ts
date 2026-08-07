import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findNoteAttachments,
  extractFileId,
  parseGeminiDoc,
  fetchNotes,
  describeFetchError,
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
  it('reads the fixture in the format Drive really exports: CRLF and no Markdown', () => {
    expect(fixture).toContain('\r\n');
    expect(fixture).not.toMatch(/^#/m);
  });

  it('takes only the first paragraph of Resumo, not the sub-topics that follow it', () => {
    const { summary } = parseGeminiDoc(fixture);
    expect(summary).toBe('Equipe alinhou o corte da release e reduziu o escopo.');
  });

  it('extracts next steps preserving the responsible marker and stripping the bullet', () => {
    const { nextSteps } = parseGeminiDoc(fixture);
    expect(nextSteps).toEqual([
      '[Ana Lima] Congelar a branch: Fechar a branch de release ate sexta.',
      '[Bo Reis] Revisar os testes de carga antes do corte.',
      '[O grupo] Publicar a nota de versao apos o corte.',
    ]);
  });

  it('extracts every detail bullet', () => {
    expect(parseGeminiDoc(fixture).details).toEqual([
      'Escopo da release: O escopo foi reduzido para dois itens.',
      'Riscos: Dependencia externa ainda sem data confirmada.',
      'Comunicacao: A nota de versao sai junto com o deploy.',
    ]);
  });

  it('never leaks a carriage return into a returned value', () => {
    const { summary, nextSteps, details } = parseGeminiDoc(fixture);
    for (const value of [summary, ...nextSteps, ...details]) {
      expect(value).not.toContain('\r');
    }
  });

  it('leaves the trailing Gemini boilerplate out of the details', () => {
    const { details } = parseGeminiDoc(fixture);
    expect(details.join('\n')).not.toMatch(/Revise as anota|qualidade destas observa/);
  });

  it('matches an unaccented "Proximas etapas" heading', () => {
    const doc = 'Proximas etapas\r\n* [Ana Lima] Abrir o chamado.\r\n';
    expect(parseGeminiDoc(doc).nextSteps).toEqual(['[Ana Lima] Abrir o chamado.']);
  });

  it('parses summary and next steps from a doc that has no Detalhes section', () => {
    const doc = [
      'Resumo',
      'Reuniao curta apenas para alinhar datas.',
      '',
      'Próximas etapas',
      '* [Bo Reis] Confirmar a data com o time.',
      '',
      'Revise as anotações do Gemini para checar se estão corretas.',
    ].join('\r\n');
    const parsed = parseGeminiDoc(doc);

    expect(parsed.summary).toBe('Reuniao curta apenas para alinhar datas.');
    expect(parsed.nextSteps).toEqual(['[Bo Reis] Confirmar a data com o time.']);
    expect(parsed.details).toEqual([]);
  });

  it('returns empty sections for unparseable text without throwing', () => {
    const parsed = parseGeminiDoc('conteudo sem estrutura');
    expect(parsed.summary).toBe('');
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

  it('stringifies a rejection that is not an Error', async () => {
    const exportDoc = vi.fn().mockRejectedValue('quota exceeded');
    const { errors } = await fetchNotes(exportDoc, event, PATTERNS);
    expect(errors).toEqual(['quota exceeded']);
  });

  it('skips a matching attachment whose url is not a Docs url, with no error to report', async () => {
    const e = {
      attachments: [{ title: 'Anotações do Gemini', fileUrl: 'https://example.com/nope' }],
    } as unknown as NormalizedEvent;
    const exportDoc = vi.fn();
    expect(await fetchNotes(exportDoc, e, PATTERNS)).toEqual({ notes: null, errors: [] });
    expect(exportDoc).not.toHaveBeenCalled();
  });

  it('reduces a pretty-printed Google API error envelope to one short line', async () => {
    const envelope = JSON.stringify(
      {
        error: {
          code: 404,
          message: 'File not found: 9zZ1FakeFileIdForTestingPurposesOnlyAbc123.',
          errors: [
            {
              message: 'File not found: 9zZ1FakeFileIdForTestingPurposesOnlyAbc123.',
              domain: 'global',
              reason: 'notFound',
            },
          ],
        },
      },
      null,
      2,
    );
    const exportDoc = vi.fn().mockRejectedValue(new Error(envelope));
    const { errors } = await fetchNotes(exportDoc, event, PATTERNS);
    expect(errors).toHaveLength(1);
    expect(errors[0].split('\n')).toHaveLength(1);
    expect(errors[0].length).toBeLessThan(120);
  });
});

describe('describeFetchError', () => {
  it('reduces a Google API 404 envelope to "<code> <message>" on one line', () => {
    const envelope = JSON.stringify(
      {
        error: {
          code: 404,
          message: 'File not found: 9zZ1FakeFileIdForTestingPurposesOnlyAbc123.',
          errors: [{ message: 'File not found', domain: 'global', reason: 'notFound' }],
        },
      },
      null,
      2,
    );
    const line = describeFetchError(new Error(envelope));
    expect(line).toContain('404');
    expect(line).toContain('File not found');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('accepts an envelope thrown as a plain object, not wrapped in an Error', () => {
    const line = describeFetchError({ code: 403, message: 'Caller does not have permission' });
    expect(line).toBe('403 Caller does not have permission');
  });

  for (const token of ['unauthorized_client', 'invalid_grant', 'SERVICE_DISABLED']) {
    it(`keeps the "${token}" token visible for an OAuth/delegation failure`, () => {
      expect(describeFetchError(new Error(token))).toContain(token);
    });
  }

  it('reduces a plain Error to its single-lined, trimmed message', () => {
    expect(describeFetchError(new Error('403 caller does not have permission'))).toBe(
      '403 caller does not have permission',
    );
  });

  it('collapses a multi-line message to exactly one line', () => {
    const line = describeFetchError(new Error('line one\nline two\nline three'));
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toBe('line one line two line three');
  });

  it('stringifies a non-Error rejection, single-lined', () => {
    expect(describeFetchError('quota exceeded')).toBe('quota exceeded');
  });

  it('truncates an unreasonably long message rather than let it dominate the report', () => {
    const line = describeFetchError(new Error('x'.repeat(500)));
    expect(line.length).toBeLessThan(120);
  });

  it('falls back to the plain message when a brace-prefixed string is not valid JSON', () => {
    expect(describeFetchError(new Error('{ not actually json'))).toBe('{ not actually json');
  });

  it('falls back to the raw text when a nested envelope has no message field', () => {
    const raw = JSON.stringify({ error: { code: 500 } });
    expect(describeFetchError(new Error(raw))).toBe(singleLineForTest(raw));
  });

  it('formats a string status code without altering it', () => {
    expect(
      describeFetchError({ code: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' }),
    ).toBe('RESOURCE_EXHAUSTED Quota exceeded');
  });

  it('omits the prefix when a nested envelope carries no code', () => {
    const raw = JSON.stringify({ error: { message: 'Something broke upstream' } });
    expect(describeFetchError(new Error(raw))).toBe('Something broke upstream');
  });

  it('falls back to the bare token when truncation would cut it off', () => {
    const raw = `${'a'.repeat(90)} invalid_grant`;
    expect(describeFetchError(new Error(raw))).toBe('invalid_grant');
  });
});

function singleLineForTest(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
