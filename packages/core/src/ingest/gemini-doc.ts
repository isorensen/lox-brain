import type { EventAttachment, GeminiNotes, NormalizedEvent } from './types.js';

export type ExportDoc = (fileId: string) => Promise<string>;

export function findNoteAttachments(
  event: NormalizedEvent,
  patterns: string[],
): EventAttachment[] {
  return (event.attachments ?? []).filter((a) => {
    const title = (a.title ?? '').toLowerCase();
    return patterns.some((p) => title.includes(p));
  });
}

export function extractFileId(fileUrl: string): string | null {
  return fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
}

type SectionKey = 'summary' | 'nextSteps' | 'details';

/** Drive's text/plain export carries no Markdown: a section title is a bare line whose
 * text is just the section name, and accents come and go between documents. */
const SECTION_HEADINGS = new Map<string, SectionKey>([
  ['resumo', 'summary'],
  ['proximas etapas', 'nextSteps'],
  ['detalhes', 'details'],
]);

function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function headingKey(line: string): SectionKey | undefined {
  return SECTION_HEADINGS.get(foldAccents(line.trim()).toLowerCase());
}

function splitSections(text: string): Map<SectionKey, string[]> {
  const sections = new Map<SectionKey, string[]>();
  let current: string[] | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r/g, '');
    const key = headingKey(line);
    if (key) {
      current = [];
      sections.set(key, current);
      continue;
    }
    current?.push(line);
  }
  return sections;
}

/** The lines after "Resumo" are the one-paragraph summary followed by sub-topics rendered
 * as title/paragraph pairs; only the first paragraph is the summary. */
function firstParagraph(lines: string[]): string {
  const paragraph: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) paragraph.push(trimmed);
    else if (paragraph.length > 0) break;
  }
  return paragraph.join(' ');
}

function stripBullet(line: string): string {
  return line.replace(/^[-*]\s*/, '').replace(/\\\[/g, '[').replace(/\\\]/g, ']').trim();
}

function bullets(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => /^[-*]\s/.test(l)).map(stripBullet);
}

export function parseGeminiDoc(text: string): Omit<GeminiNotes, 'docUrls'> {
  const sections = splitSections(text);
  return {
    summary: firstParagraph(sections.get('summary') ?? []),
    nextSteps: bullets(sections.get('nextSteps') ?? []),
    details: bullets(sections.get('details') ?? []),
  };
}

export interface FetchNotesResult {
  notes: GeminiNotes | null;
  /** Why each unreadable Doc failed, so the run summary can name the cause. */
  errors: string[];
}

/** Delegation errors (unauthorized_client, invalid_grant, SERVICE_DISABLED) mean the
 * capture account's domain-wide delegation is misconfigured, not that it lacks an
 * invite — the run summary tells operators to look for these exact tokens. */
const OAUTH_ERROR_TOKENS = ['unauthorized_client', 'invalid_grant', 'SERVICE_DISABLED'];

const MAX_REPORT_LINE_LENGTH = 100;

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max = MAX_REPORT_LINE_LENGTH): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

interface GoogleApiEnvelope {
  code?: string | number;
  message: string;
}

function extractEnvelope(candidate: unknown): GoogleApiEnvelope | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const obj = candidate as Record<string, unknown>;
  const nested = typeof obj.error === 'object' && obj.error !== null;
  const inner = nested ? (obj.error as Record<string, unknown>) : obj;
  if (typeof inner.message !== 'string') return null;
  // Nesting under "error" is itself the Google API envelope signal; for an unwrapped
  // object, require .code or .errors[] so a plain Error (message + stack) is not misread.
  if (!nested && inner.code === undefined && !Array.isArray(inner.errors)) return null;
  const code = typeof inner.code === 'number' || typeof inner.code === 'string' ? inner.code : undefined;
  return { code, message: inner.message };
}

function parseGoogleApiEnvelope(value: unknown): GoogleApiEnvelope | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      return extractEnvelope(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return extractEnvelope(value);
}

/** Reduces a thrown value to one short, actionable line for the run's end-of-run report. */
export function describeFetchError(err: unknown): string {
  const envelope =
    (err instanceof Error ? parseGoogleApiEnvelope(err.message) : null) ?? parseGoogleApiEnvelope(err);
  if (envelope) {
    const prefix = envelope.code !== undefined ? `${envelope.code} ` : '';
    return truncate(singleLine(`${prefix}${envelope.message}`));
  }

  const raw = err instanceof Error ? err.message : String(err);
  for (const token of OAUTH_ERROR_TOKENS) {
    if (raw.includes(token)) {
      const line = truncate(singleLine(raw));
      return line.includes(token) ? line : token;
    }
  }

  return truncate(singleLine(raw));
}

export async function fetchNotes(
  exportDoc: ExportDoc,
  event: NormalizedEvent,
  patterns: string[],
): Promise<FetchNotesResult> {
  const attachments = findNoteAttachments(event, patterns);
  if (attachments.length === 0) return { notes: null, errors: [] };

  const merged: GeminiNotes = { summary: '', nextSteps: [], details: [], docUrls: [] };
  const errors: string[] = [];
  let anySucceeded = false;

  for (const attachment of attachments) {
    const fileId = extractFileId(attachment.fileUrl);
    if (!fileId) continue;
    try {
      const parsed = parseGeminiDoc(await exportDoc(fileId));
      anySucceeded = true;
      merged.docUrls.push(attachment.fileUrl);
      merged.summary = merged.summary
        ? `${merged.summary} ${parsed.summary}`.trim()
        : parsed.summary;
      merged.nextSteps.push(...parsed.nextSteps);
      merged.details.push(...parsed.details);
    } catch (err) {
      // A Drive 403 and a broken domain-wide delegation both land here, and they
      // call for opposite fixes, so keep the reason rather than the fact alone.
      errors.push(describeFetchError(err));
    }
  }

  return { notes: anySucceeded ? merged : null, errors };
}
