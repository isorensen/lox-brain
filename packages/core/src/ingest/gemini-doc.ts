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
      // call for opposite fixes, so keep the message rather than the fact alone.
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { notes: anySucceeded ? merged : null, errors };
}
