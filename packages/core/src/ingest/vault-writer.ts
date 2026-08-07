import type { GeminiNotes, NormalizedEvent, NoteDecision } from './types.js';
import { buildNoteFilename, buildNoteContent } from './note-builder.js';

export type ReadFile = (path: string) => Promise<string | null>;
export type WriteFile = (path: string, content: string) => Promise<void>;

function eventIdOf(content: string): string | null {
  return content.match(/\[calendar_event_id::\s*([^\]]+)\]/)?.[1]?.trim() ?? null;
}

export async function decideNote(
  readFile: ReadFile,
  event: NormalizedEvent,
  notes: GeminiNotes | null,
  notesFolder: string,
): Promise<NoteDecision> {
  const filename = buildNoteFilename(event);
  let path = `${notesFolder}/${filename}`;
  let existing = await readFile(path);

  if (existing && eventIdOf(existing) !== event.id) {
    // Two different events canonicalize to the same filename; disambiguate by start time.
    const time = event.start.slice(11, 16).replace(':', '-');
    path = `${notesFolder}/${filename.replace(/\.md$/, ` (${time}).md`)}`;
    existing = await readFile(path);
  }

  if (!existing) {
    return { action: 'create', path, content: buildNoteContent(event, notes) };
  }

  const isSkeleton = existing.includes('Status: #baby');
  if (isSkeleton && notes) {
    return { action: 'complement', path, content: buildNoteContent(event, notes) };
  }
  return { action: 'skip', path, reason: isSkeleton ? 'skeleton, no notes yet' : 'already enriched' };
}

export async function applyDecision(writeFile: WriteFile, decision: NoteDecision): Promise<void> {
  if (decision.action === 'skip') return;
  await writeFile(decision.path, decision.content);
}
