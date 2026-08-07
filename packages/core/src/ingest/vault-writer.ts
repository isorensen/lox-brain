import type { GeminiNotes, NormalizedEvent, NoteDecision } from './types.js';
import {
  buildNoteFilename,
  buildNoteContent,
  TOPICS_HEADING,
  ACTIONS_HEADING,
  NO_NOTES_CALLOUT,
} from './note-builder.js';

export type ReadFile = (path: string) => Promise<string | null>;
export type WriteFile = (path: string, content: string) => Promise<void>;

function eventIdOf(content: string): string | null {
  return content.match(/\[calendar_event_id::\s*([^\]]+)\]/)?.[1]?.trim() ?? null;
}

function importedDateOf(content: string): string | undefined {
  return content.match(/\[imported::\s*([^\]]+)\]/)?.[1]?.trim();
}

/**
 * True only for a skeleton whose topics section still holds the callout and nothing else.
 * The callout tells the reader to type *below* it, so its mere presence proves nothing —
 * the section has to be otherwise empty for a full-file overwrite to be safe.
 */
function isUntouchedSkeleton(content: string): boolean {
  const start = content.indexOf(TOPICS_HEADING);
  const end = content.indexOf(ACTIONS_HEADING);
  if (start === -1 || end <= start) return false;
  return content.slice(start + TOPICS_HEADING.length, end).trim() === NO_NOTES_CALLOUT;
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
    if (existing && eventIdOf(existing) !== event.id) {
      // The disambiguated path is also taken by a different event; do not guess further.
      return { action: 'skip', path, reason: 'unresolved collision' };
    }
  }

  if (!existing) {
    return { action: 'create', path, content: buildNoteContent(event, notes) };
  }

  const isSkeleton = /^Status: #baby$/m.test(existing);
  if (isSkeleton && !isUntouchedSkeleton(existing)) {
    return { action: 'skip', path, reason: 'skeleton was edited by hand' };
  }
  if (isSkeleton && notes) {
    return {
      action: 'complement',
      path,
      content: buildNoteContent(event, notes, importedDateOf(existing)),
    };
  }
  return { action: 'skip', path, reason: isSkeleton ? 'skeleton, no notes yet' : 'already enriched' };
}

export async function applyDecision(writeFile: WriteFile, decision: NoteDecision): Promise<void> {
  if (decision.action === 'skip') return;
  await writeFile(decision.path, decision.content);
}
