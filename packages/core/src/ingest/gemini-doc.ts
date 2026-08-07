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

function sectionLines(text: string, heading: RegExp): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function stripBullet(line: string): string {
  return line.replace(/^[-*]\s*/, '').replace(/\\\[/g, '[').replace(/\\\]/g, ']').trim();
}

export function parseGeminiDoc(text: string): Omit<GeminiNotes, 'docUrls'> {
  const summary = sectionLines(text, /^#{1,3}\s*\**Resumo\**/i).join(' ').trim();
  const nextSteps = sectionLines(text, /^#{1,3}\s*\**Pr[óo]ximas etapas\**/i)
    .filter((l) => /^[-*]/.test(l))
    .map(stripBullet);
  const details = sectionLines(text, /^#{1,3}\s*\**Detalhes\**/i)
    .filter((l) => /^[-*]/.test(l))
    .map(stripBullet);
  return { summary, nextSteps, details };
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
